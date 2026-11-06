import Anthropic from "@anthropic-ai/sdk";
import { buildIntakePrompt } from "@/lib/system-prompt";
import { supabase } from "@/lib/supabase";
import { buildUpdatePrompt } from "@/lib/update-prompt";
import {
  approvalReason,
  changeBlocks,
  computeDeadlines,
  isChangeOrderRow,
  UPDATABLE_FIELDS,
  type EventData,
} from "@/lib/event-diff";
import {
  applyEventUpdate,
  type ApplyResult,
  getSession,
  recordSubmission,
  type SessionRow,
} from "@/lib/event-updates";
import { UPDATE_OPENER } from "@/lib/update-mode-shared";
import { deliverEventUpdates } from "@/lib/update-delivery";
import { DEFAULT_DEPOSIT, money, paymentPhrase } from "@/lib/change-order";

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
      payment_preference: {
        type: "string",
        description: 'How the client wants the remaining balance handled, from the PAYMENT STEP. One of: "Auto charge now", "Auto charge on <date>", "Auto charge on due date", "Payment link", "Payment plan: <split>". Empty if they did not answer.',
      },
      change_approval_needed: {
        type: "string",
        enum: ["Yes", "No"],
        description: "Yes if anything was passed along to the management team under the CONDUCT RULE.",
      },
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
    "Record a change to this already submitted event. Call it only after the client confirmed the change. Include ONLY the fields that changed. When any drink changes, send the complete signature_drinks array. Anything the client tells you that no other field covers (for example 'I will provide the cups') goes in special_requests as the complete existing text plus the new note. Date, service times or hours, guest count, package, address, and bartenders are change orders: send the new values in their fields, the system prices them and holds them until the client signs. Use manager_request only for drinks beyond the package count. Set change_approval_needed when you passed something along to management under the CONDUCT RULE.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      ...Object.fromEntries(
        UPDATABLE_FIELDS.map((field) => [field, submitProperties[field] ?? { type: "string" }])
      ),
      event_date: { type: "string", description: "New event date, written like the current one." },
      hours_booked: { type: "number", description: "New number of service hours, when the client changes the length of service." },
      bartenders: { type: "number", description: "New number of bartenders, only when the client asks for a different count." },
      package: { type: "string", description: "New package name, exactly as listed in PACKAGES." },
      payment_preference: {
        type: "string",
        description: 'How the client wants the remaining balance handled. One of: "Auto charge now", "Auto charge on <date>", "Auto charge on due date", "Payment link", "Payment plan: <split>".',
      },
      manager_request: {
        type: "string",
        description: "Drinks beyond the package count, exactly as the client asked. Quote no prices.",
      },
      change_approval_needed: {
        type: "boolean",
        description: "True when this call records something passed along to management under the CONDUCT RULE (in special_requests).",
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

/**
 * What update_event_data actually recorded, handed back to the model so its
 * confirmation repeats exactly what was saved and never claims more.
 */
function updateToolResult(result: ApplyResult | null): string {
  if (!result) {
    return "TOOL RESULT: NOTHING was recorded, this event could not be updated right now. Tell the client honestly that the change did not go through and a manager will follow up. Do not say it was saved.";
  }
  if (result.rows.length === 0) {
    return "TOOL RESULT: NOTHING was recorded because every value sent already matches what is on file. Tell the client it is already on file. Do not say you updated or saved anything.";
  }
  const parts = result.rows.map((r) => {
    const details = changeBlocks(r.changes).join("\n\n");
    if (isChangeOrderRow(r)) {
      if (!r.change_order) return `CHANGE ORDER CANCELED, the client is back to the booked details, nothing to sign:\n${details}`;
      return `CHANGE ORDER SAVED, NOT APPLIED until the client signs it:\n${details}`;
    }
    return r.applied
      ? `SAVED, the event is now version ${r.version}:\n${details}`
      : `NOT SAVED YET, sent to a manager for approval (${approvalReason(r)}):\n${details}`;
  });
  if (result.changeOrderSent && result.pendingChange) {
    const p = result.pendingChange;
    const phrase = paymentPhrase(result.paymentPreference);
    parts.push(
      [
        `CHANGE ORDER PRICING (the whole pending change order): ${p.price_text}`,
        `pending_change_amount: ${p.amount === null ? "unknown, a manager will confirm the price" : `${p.amount} (${p.amount < 0 ? "credit of " : ""}${money(p.amount)})`}`,
        `payment_preference: ${result.paymentPreference ? `${result.paymentPreference} (say "${phrase}")` : "blank"}`,
      ].join("\n")
    );
  }
  return `TOOL RESULT:\n\n${parts.join("\n\n")}`;
}

function updateModeResponse(session: SessionRow, messages: ChatMessage[]) {
  const eventData = session.event_data as EventData;
  const deadlines = computeDeadlines(eventData.event_date ?? session.event_date);
  const system = buildUpdatePrompt(eventData, session.version, deadlines, {
    pendingChange: session.pending_change ?? null,
    booked: session.booked_price ?? null,
  });
  const history: Anthropic.MessageParam[] = messages.map((m: ChatMessage) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const stream = anthropic.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system,
    tools: [updateEventDataTool],
    messages: history,
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
          const {
            manager_request: managerRequest,
            change_approval_needed: changeApprovalNeeded,
            ...partial
          } = toolUse.input as Record<string, unknown>;
          const result = await applyEventUpdate(session.id, partial, {
            managerRequest: typeof managerRequest === "string" ? managerRequest : null,
            changeApprovalNeeded: changeApprovalNeeded === true,
          });

          if (result && result.rows.length > 0) {
            // Send the GHL note and update webhook before telling the client the
            // update is saved, the same way intake awaits its completion side effects.
            await deliverEventUpdates(session.id, result.rows);

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

          // Second turn: the model sees what was actually recorded and confirms
          // exactly that, so nothing is announced before the tool returns.
          const followUp = anthropic.messages.stream({
            model: "claude-sonnet-4-6",
            max_tokens: 1024,
            system,
            tools: [updateEventDataTool],
            tool_choice: { type: "none" },
            messages: [
              ...history,
              { role: "assistant", content: finalMessage.content },
              {
                role: "user",
                content: [{ type: "tool_result", tool_use_id: toolUse.id, content: updateToolResult(result) }],
              },
            ],
          });
          let separated = !fullText.trim();
          let confirmation = "";
          for await (const event of followUp) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              const chunk = separated ? event.delta.text : `\n\n${event.delta.text}`;
              separated = true;
              confirmation += chunk;
              fullText += chunk;
              send(controller, { text: chunk });
            }
          }

          if (!confirmation.trim()) {
            const text = !result
              ? "Sorry, that change did not go through. A manager will follow up with you."
              : result.rows.length === 0
                ? "That is already on file. Anything else you would like to change?"
                : result.changeOrderSent && result.pendingChange
                  ? "Saved. We will text and email you a short change order to sign. The new details take effect once you sign."
                  : result.rows.some((r) => r.applied)
                  ? "That change is saved. Anything else you would like to change?"
                  : "I have sent that to a manager who will reach out to you shortly. Anything else you would like to change?";
            const chunk = fullText.trim() ? `\n\n${text}` : text;
            fullText += chunk;
            send(controller, { text: chunk });
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
  let session: SessionRow | null = null;
  if (sessionId) {
    session = await getSession(sessionId);
    if (session?.status === "submitted" && session.event_data) {
      return updateModeResponse(session, messages);
    }
  }

  // The payment step quotes the remaining balance: booked total minus the deposit.
  const booked = session?.booked_price ?? null;
  const stream = anthropic.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 8192,
    system: buildIntakePrompt(
      booked ? { total: booked.total ?? null, deposit: booked.deposit_paid ?? DEFAULT_DEPOSIT } : null
    ),
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
