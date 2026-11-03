import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";
import { supabase } from "@/lib/supabase";
import { buildUpdatePrompt } from "@/lib/update-prompt";
import { computeDeadlines, UPDATABLE_FIELDS, type EventData } from "@/lib/event-diff";
import {
  applyEventUpdate,
  getSession,
  recordSubmission,
  type SessionRow,
} from "@/lib/event-updates";
import { UPDATE_OPENER } from "@/lib/update-mode-shared";

const anthropic = new Anthropic();

interface ChatMessage {
  role: string;
  content: string;
}

// Completion is driven by this tool call, not by a literal marker the model has
// to remember to type after free-form prose. When the model invokes it, the SDK
// hands us the validated, fully-assembled input — there is no string to split or
// JSON to hand-parse, so the session can no longer hang on a forgotten/garbled
// marker.
const submitEventDataTool: Anthropic.Tool = {
  name: "submit_event_data",
  description:
    "Finalize the planning session. Call this exactly once, after the client has confirmed they have no more changes and you have written your closing message, to submit all collected event details. Calling this tool is what completes the booking and hands the details off to our team. Do not call it before the client confirms they are done.",
  input_schema: {
    type: "object",
    additionalProperties: true,
    properties: {
      client_name: { type: "string" },
      email: { type: "string" },
      event_type: { type: "string" },
      event_name: { type: ["string", "null"] },
      event_date: { type: "string" },
      venue_type: { type: "string", description: "venue or private_residence" },
      bar_service_start: { type: "string" },
      bar_service_end: { type: "string" },
      event_address: { type: "string" },
      indoor_outdoor: { type: "string" },
      bar_on_site: { type: "string" },
      bar_details: { type: "string" },
      parking_info: { type: "string" },
      guest_count: { type: "number" },
      drinking_pace: { type: "string" },
      theme: { type: "string" },
      event_colors: { type: "string" },
      allergies: { type: "array", items: { type: "string" } },
      day_of_contact_name: { type: "string" },
      day_of_contact_phone: { type: "string" },
      package: { type: "string" },
      signature_drinks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: true,
          properties: {
            name: { type: "string" },
            base_spirit: { type: "string" },
            flavor_profile: { type: "string" },
            description: { type: "string" },
            ingredients: {
              type: "array",
              items: { type: "string" },
              description:
                'Each ingredient MUST include the oz amount, e.g. "2 oz vodka", "0.75 oz lime juice", except "Top with" items.',
            },
            method: { type: "string" },
            garnish: { type: "string" },
            is_mocktail: { type: "boolean" },
            is_custom: { type: "boolean" },
          },
        },
      },
      extra_bottles: { type: "string" },
      beer_and_wine_details: { type: ["string", "null"] },
      beer: { type: "boolean" },
      wine: { type: "boolean" },
      client_providing_beer_wine: { type: "boolean" },
      special_requests: { type: "string" },
      menu_colors: { type: ["string", "null"] },
      menu_reference_photos: { type: ["boolean", "null"] },
      dual_bar_setup: { type: "boolean" },
      dive_menu_requested: { type: "boolean", default: false },
    },
    required: ["client_name", "package"],
  },
};

// Update mode tool: a partial event with only the changed fields, plus
// manager_request for things a manager has to handle.
const submitProperties = submitEventDataTool.input_schema.properties as Record<string, unknown>;
const updateEventDataTool: Anthropic.Tool = {
  name: "update_event_data",
  description:
    "Record a change to this already submitted event. Call it only after the client confirmed the change. Include ONLY the fields that changed. When any drink changes, send the complete signature_drinks array. Use manager_request for requests a manager must handle: extending hours, drinks beyond the package count, switching packages, or changing the event date.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      ...Object.fromEntries(
        UPDATABLE_FIELDS.map((field) => [field, submitProperties[field] ?? { type: "string" }])
      ),
      manager_request: {
        type: "string",
        description: "Exactly what the client asked for that a manager must handle. Quote no prices.",
      },
    },
  },
};

async function upsertConversationLog(
  sessionId: string,
  clientName: string | null,
  email: string | null,
  messages: ChatMessage[]
) {
  const { data: existing, error: selectError } = await supabase
    .from("conversation_logs")
    .select("id")
    .eq("session_id", sessionId)
    .maybeSingle();

  if (selectError) {
    console.error("conversation_logs select error:", selectError);
    return;
  }

  const nowIso = new Date().toISOString();

  if (existing) {
    const { error } = await supabase
      .from("conversation_logs")
      .update({ messages, updated_at: nowIso })
      .eq("session_id", sessionId);
    if (error) console.error("conversation_logs update error:", error);
  } else {
    const { error } = await supabase.from("conversation_logs").insert({
      session_id: sessionId,
      client_name: clientName,
      email,
      messages,
    });
    if (error) console.error("conversation_logs insert error:", error);
  }
}

function buildTranscript(messages: ChatMessage[]): string {
  return messages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");
}

// Fire the completion side effects server-side so they no longer depend on the
// client tab staying open. save-event marks the conversation completed + inserts
// the event row; webhook sends the GHL webhook and creates the contact note.
async function fireCompletion(
  origin: string,
  eventData: unknown,
  transcript: string,
  clientEmail: string | null,
  sessionId: string
) {
  const saveEvent = fetch(`${origin}/api/save-event`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventData,
      conversationTranscript: transcript,
      sessionId,
    }),
  });

  const webhook = fetch(`${origin}/api/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      eventData,
      conversationTranscript: transcript,
      clientEmail,
    }),
  });

  const [saveResult, webhookResult] = await Promise.allSettled([
    saveEvent,
    webhook,
  ]);

  if (saveResult.status === "rejected") {
    console.error("save-event call failed:", saveResult.reason);
  } else if (!saveResult.value.ok) {
    console.error("save-event responded with status", saveResult.value.status);
  }

  if (webhookResult.status === "rejected") {
    console.error("webhook call failed:", webhookResult.reason);
  } else if (!webhookResult.value.ok) {
    console.error("webhook responded with status", webhookResult.value.status);
  }
}

async function saveUpdateMessages(sessionId: string, messages: ChatMessage[]) {
  // Keep the intake transcript intact, update mode chat goes in its own column.
  const visible = messages[0]?.content === UPDATE_OPENER ? messages.slice(1) : messages;
  const { error } = await supabase
    .from("conversation_logs")
    .update({ update_messages: visible })
    .eq("session_id", sessionId);
  if (error) console.error("conversation_logs update_messages error:", error);
}

// Send the GHL update note and webhook before telling the client the update is
// saved, the same way intake awaits its completion side effects.
async function fireUpdateWebhook(origin: string, sessionId: string, updateIds: string[]) {
  try {
    const res = await fetch(`${origin}/api/update-webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, updateIds }),
    });
    if (!res.ok) console.error("update-webhook responded with status", res.status);
  } catch (err) {
    console.error("update-webhook call failed:", err);
  }
}

function updateModeResponse(request: Request, session: SessionRow, messages: ChatMessage[]) {
  const eventData = session.event_data as EventData;
  const deadlines = computeDeadlines(eventData.event_date ?? session.event_date);

  const stream = anthropic.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system: buildUpdatePrompt(eventData, session.version, deadlines),
    tools: [updateEventDataTool],
    messages: messages.map((m: ChatMessage) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  });

  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController, payload: unknown) =>
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

  const readable = new ReadableStream({
    async start(controller) {
      let fullText = "";
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            fullText += event.delta.text;
            send(controller, { text: event.delta.text });
          }
        }

        const finalMessage = await stream.finalMessage();
        const toolUse = finalMessage.content.find(
          (block): block is Anthropic.ToolUseBlock =>
            block.type === "tool_use" && block.name === "update_event_data"
        );

        if (toolUse) {
          const { manager_request: managerRequest, ...partial } = toolUse.input as Record<string, unknown>;
          const result = await applyEventUpdate(session.id, partial, {
            managerRequest: typeof managerRequest === "string" ? managerRequest : null,
          });

          if (result && result.rows.length > 0) {
            if (!fullText.trim()) {
              const text = result.rows.some((r) => r.applied)
                ? "All set, that change is saved. Anything else you would like to change?"
                : "I have sent that to a manager who will reach out to you shortly. Anything else you would like to change?";
              fullText = text;
              send(controller, { text });
            }

            await fireUpdateWebhook(
              new URL(request.url).origin,
              session.id,
              result.rows.map((r) => r.id)
            );

            send(controller, {
              event: "updated",
              eventData: result.eventData,
              version: result.version,
              updatedAt: result.updatedAt,
              updates: result.rows.map((r) => ({
                version: r.version,
                applied: r.applied,
                within_deadline: r.within_deadline,
                summary: r.summary,
              })),
            });
          }
        }

        await saveUpdateMessages(session.id, [
          ...messages,
          { role: "assistant", content: fullText.trim() },
        ]);

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        send(controller, { error: message });
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

export async function POST(request: Request) {
  const { messages, sessionId, clientName, email } = await request.json();

  // Sessions that already submitted their event get update mode instead of intake.
  if (sessionId) {
    const session = await getSession(sessionId);
    if (session?.status === "submitted" && session.event_data) {
      return updateModeResponse(request, session, messages);
    }
  }

  const stream = anthropic.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    tools: [submitEventDataTool],
    messages: messages.map((m: ChatMessage) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  });

  const encoder = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      let fullText = "";
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            fullText += event.delta.text;
            const data = JSON.stringify({ text: event.delta.text });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          }
        }

        // Inspect the assembled message for the completion tool call.
        const finalMessage = await stream.finalMessage();
        const toolUse = finalMessage.content.find(
          (block): block is Anthropic.ToolUseBlock =>
            block.type === "tool_use" && block.name === "submit_event_data"
        );

        const closingText = fullText.trim();

        if (sessionId) {
          const updatedMessages: ChatMessage[] = [
            ...messages,
            { role: "assistant", content: closingText },
          ];

          await upsertConversationLog(
            sessionId,
            clientName ?? null,
            email ?? null,
            updatedMessages
          ).catch((err) =>
            console.error("Failed to save conversation log:", err)
          );

          if (toolUse) {
            const eventData = toolUse.input;
            const transcript = buildTranscript(updatedMessages);
            const origin = new URL(request.url).origin;

            // Save the full payload on the session row as version 1 so the
            // session link opens in update mode from now on.
            await recordSubmission(sessionId, eventData as EventData).catch((err) =>
              console.error("Failed to record submission:", err)
            );

            // Fire (and await) the completion side effects BEFORE telling the
            // client we are done, so they run regardless of whether the tab
            // stays open.
            await fireCompletion(
              origin,
              eventData,
              transcript,
              email ?? null,
              sessionId
            );

            const completePayload = JSON.stringify({
              event: "complete",
              eventData,
            });
            controller.enqueue(
              encoder.encode(`data: ${completePayload}\n\n`)
            );
          }
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`)
        );
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
