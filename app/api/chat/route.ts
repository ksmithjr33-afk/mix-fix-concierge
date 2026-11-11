import Anthropic from "@anthropic-ai/sdk";
import { buildIntakePrompt } from "@/lib/system-prompt";
import { supabase } from "@/lib/supabase";
import { buildUpdatePrompt } from "@/lib/update-prompt";
import {
  approvalReason,
  changeBlocks,
  computeDeadlines,
  DRINKS_LOCKED_MESSAGE,
  PRICED_FIELDS,
  recapLines,
  UPDATABLE_FIELDS,
  type EventData,
} from "@/lib/event-diff";
import {
  applyEventUpdate,
  type ApplyResult,
  changesSince,
  getSession,
  quoteEventUpdate,
  type QuoteResult,
  recordSubmission,
  type SessionRow,
} from "@/lib/event-updates";
import { UPDATE_OPENER } from "@/lib/update-mode-shared";
import { deliverEventUpdates } from "@/lib/update-delivery";
import { allowedMenus, createMenuFilter, type MenuKey } from "@/lib/menu-markers";
import { applyDiveSetMenu, DIVE_MENU_SET_MESSAGE } from "@/lib/dive-menu";
import { DEFAULT_DEPOSIT, impliedLine, money, paymentPhrase, type PriceChange } from "@/lib/price-change";
import { LIST_CHANGE_HELD_MESSAGE } from "@/lib/client-list";
import { eventTimeZone } from "@/lib/team/markets";

const anthropic = new Anthropic();

interface ChatMessage {
  role: string;
  content: string;
  menus?: MenuKey[]; // menu images shown with this message, never sent to the model
}

/** The stored assistant message, with the menu images it showed so a reload brings them back. */
function assistantMessage(content: string, menus: MenuKey[]): ChatMessage {
  return { role: "assistant", content, ...(menus.length > 0 ? { menus } : {}) };
}

/** The package from the hidden booking context, for chats without a session row. */
function packageFromContext(messages: ChatMessage[]): string | null {
  const first = messages[0]?.content ?? "";
  return first.startsWith("CONTEXT") ? first.match(/Package: ([^,]+)/)?.[1]?.trim() ?? null : null;
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
    "Save a change to this already submitted event. It applies right away. Call it only after the client clearly said yes. Include ONLY the fields that changed. When any drink changes, send the complete signature_drinks array. Anything the client tells you that no other field covers (for example 'I will provide the cups') goes in special_requests as the complete existing text plus the new note. A change to guest count, service times or hours, bartenders, or package must be quoted with quote_price_change first, and quoted_new_total must be the new total you quoted. Use manager_request only for drinks beyond the package count. Set change_approval_needed when you passed something along to management under the CONDUCT RULE.",
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
      quoted_new_total: {
        type: "number",
        description: "The new total from quote_price_change that you stated and the client said yes to. Required when guest count, times, hours, bartenders, or package change.",
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

// Prices a proposed change without saving it, so the bot can state the
// difference and new total and get a yes before calling update_event_data.
const quotePriceChangeTool: Anthropic.Tool = {
  name: "quote_price_change",
  description:
    "Price a proposed change to guest count, service times or hours, bartenders, or package with our pricing engine. Saves nothing. Call it before confirming any such change, with ONLY the new values, then state the difference and new total from the result and ask the client for a clear yes.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: Object.fromEntries(
      PRICED_FIELDS.map((field) => [field, (updateEventDataTool.input_schema.properties as Record<string, unknown>)[field]])
    ),
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
      sessionId,
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

/** The money lines the bot reads from a price change. */
function priceLines(p: PriceChange): string[] {
  return [
    `price: ${p.price_text}`,
    `difference: ${p.amount === null ? "unknown, our team will confirm the price" : p.amount === 0 ? "0, no change in price" : `${p.amount} (${p.amount < 0 ? "credit of " : ""}${money(p.amount)})`}`,
    `new_total: ${p.new_total === null ? "unknown" : `${p.new_total} (${money(p.new_total)})`}`,
    `implied_changes: ${p.implied?.length ? p.implied.map(impliedLine).join("; ") : "none"}`,
  ];
}

/** What quote_price_change priced, handed back so the bot states it and asks for a yes. */
function quoteToolResult(quote: QuoteResult | null): string {
  if (!quote) return "TOOL RESULT: This event could not be priced right now. Tell the client our team will confirm the price, and do not quote anything.";
  const parts: string[] = [];
  if (quote.diveMenuSet) parts.push(`DRINK MENU SET, Dive Bar has a set menu and drinks cannot be changed. Say exactly: "${DIVE_MENU_SET_MESSAGE}"`);
  else if (quote.refusedDrinks) parts.push(`DRINK MENU LOCKED, within 6 days of the event. Say exactly: "${DRINKS_LOCKED_MESSAGE}"`);
  if (quote.listHold) {
    parts.push(`SHOPPING LIST LOCKED, within 6 days of the event. This change would change the client's shopping list, so after they say yes it goes to our team for approval instead of saving. Tell them that when you ask, and after update_event_data say exactly: "${LIST_CHANGE_HELD_MESSAGE}"`);
  }
  if (!quote.price) {
    parts.push("NOTHING TO PRICE: these values are already on file or do not change the price. Do not quote a price.");
  } else {
    parts.push(
      [
        "QUOTE, NOTHING SAVED YET. State the change, the difference, and the new total in one yes or no question. When the client clearly says yes, call update_event_data with the same values and quoted_new_total set to new_total.",
        ...priceLines(quote.price),
      ].join("\n")
    );
  }
  return `TOOL RESULT:\n\n${parts.join("\n\n")}`;
}

/**
 * What update_event_data actually recorded, handed back to the model so its
 * confirmation repeats exactly what was saved and never claims more.
 */
function updateToolResult(result: ApplyResult | null): string {
  if (!result) {
    return "TOOL RESULT: NOTHING was recorded, this event could not be updated right now. Tell the client honestly that the change did not go through and our team will follow up. Do not say it was saved.";
  }
  const parts: string[] = [];
  if (result.needsQuote) {
    parts.push(
      [
        "NOTHING SAVED: this change affects the price and the client has not said yes to this price yet. State the change, the difference, and the new total below in one yes or no question. When they clearly say yes, call update_event_data again with quoted_new_total set to new_total.",
        ...priceLines(result.needsQuote),
      ].join("\n")
    );
    return `TOOL RESULT:\n\n${parts.join("\n\n")}`;
  }
  if (result.diveMenuSet) {
    parts.push(`DRINK CHANGE NOT SAVED, Dive Bar has a set menu. Say exactly: "${DIVE_MENU_SET_MESSAGE}"`);
  } else if (result.refusedDrinks) {
    parts.push(`DRINK CHANGE NOT SAVED, the drink menu is locked within 6 days of the event. Say exactly: "${DRINKS_LOCKED_MESSAGE}"`);
  }
  if (result.held) {
    parts.push(`NOT SAVED YET, HELD FOR APPROVAL: within 6 days of the event this change would change the client's shopping list, so our team approves or declines it first. Do not say it was saved. Say exactly: "${LIST_CHANGE_HELD_MESSAGE}"`);
  }
  if (result.rows.length === 0 && !result.refusedDrinks && !result.diveMenuSet && !result.held) {
    return "TOOL RESULT: NOTHING was recorded because every value sent already matches what is on file. Tell the client it is already on file. Do not say you updated or saved anything.";
  }
  for (const r of result.rows) {
    const details = changeBlocks(r.changes).join("\n\n");
    parts.push(
      r.applied
        ? `SAVED AND APPLIED NOW, the event is now version ${r.version}:\n${details}`
        : `NOT SAVED, sent to a manager (${approvalReason(r)}):\n${details}`
    );
  }
  if (result.priceChange) {
    const phrase = paymentPhrase(result.paymentPreference);
    parts.push(
      [
        "PRICE CHANGE SAVED:",
        ...priceLines(result.priceChange),
        `payment_preference: ${result.paymentPreference ? `${result.paymentPreference} (say "${phrase}")` : "blank"}`,
      ].join("\n")
    );
  }
  return `TOOL RESULT:\n\n${parts.join("\n\n")}`;
}

async function updateModeResponse(session: SessionRow, messages: ChatMessage[], chatStartVersion: number, origin: string) {
  const eventData = session.event_data as EventData;
  const deadlines = computeDeadlines(eventData.event_date ?? session.event_date, undefined, eventTimeZone(session));
  // Every change saved since this chat opened, for the final recap.
  const since = await changesSince(session.id, chatStartVersion).catch(() => null);
  const system = buildUpdatePrompt(eventData, session.version, deadlines, {
    booked: session.booked_price ?? null,
    recap: since ? { lines: recapLines(since.changes), totalBefore: since.totalBefore, totalAfter: since.totalAfter } : null,
  });
  const tools = [quotePriceChangeTool, updateEventDataTool];
  const history: Anthropic.MessageParam[] = messages.map((m: ChatMessage) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const stream = anthropic.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    system,
    tools,
    messages: history,
  });

  const encoder = new TextEncoder();
  const send = (controller: ReadableStreamDefaultController, payload: unknown) =>
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));

  const readable = new ReadableStream({
    async start(controller) {
      let fullText = "";
      const menuFilter = createMenuFilter(
        allowedMenus(eventData.package ?? session.package_type, eventData.dive_menu_requested === true),
        (text) => {
          fullText += text;
          send(controller, { text });
        },
        (menu) => send(controller, { event: "menu", menu })
      );
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            menuFilter.push(event.delta.text);
          }
        }
        menuFilter.flush();

        const finalMessage = await stream.finalMessage();
        const toolUses = finalMessage.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
        );

        if (toolUses.length > 0) {
          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          let lastApply: ApplyResult | null | undefined;
          let lastQuote: QuoteResult | null | undefined;
          for (const toolUse of toolUses) {
            const input = toolUse.input as Record<string, unknown>;
            if (toolUse.name === "quote_price_change") {
              lastQuote = await quoteEventUpdate(session.id, input).catch((err) => {
                console.error("quote_price_change failed:", err);
                return null;
              });
              toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: quoteToolResult(lastQuote) });
              continue;
            }
            const {
              manager_request: managerRequest,
              change_approval_needed: changeApprovalNeeded,
              quoted_new_total: quotedNewTotal,
              ...partial
            } = input;
            const result = await applyEventUpdate(session.id, partial, {
              managerRequest: typeof managerRequest === "string" ? managerRequest : null,
              changeApprovalNeeded: changeApprovalNeeded === true,
              requireQuote: true,
              quotedNewTotal,
            });
            lastApply = result;
            if (result?.held) send(controller, { event: "held" });

            if (result && result.rows.length > 0) {
              // Refresh the event details on the page as soon as the save lands.
              send(controller, {
                event: "updated",
                eventData: result.eventData,
                version: result.version,
                updatedAt: result.updatedAt,
                updates: result.rows.map((r) => ({
                  version: r.version,
                  applied: r.applied,
                  summary: r.summary,
                })),
              });
              // Send the GHL note and update webhook before the bot confirms the change.
              // Assigned staff get a text with their event page link; it never blocks the update.
              await deliverEventUpdates(session.id, result.rows, { staffOrigin: origin });
            }
            toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: updateToolResult(result) });
          }

          // Second turn: the model sees what was priced or recorded and says
          // exactly that, so nothing is announced before the tool returns.
          const followUp = anthropic.messages.stream({
            model: "claude-sonnet-4-6",
            max_tokens: 1024,
            system,
            tools,
            tool_choice: { type: "none" },
            messages: [
              ...history,
              { role: "assistant", content: finalMessage.content },
              { role: "user", content: toolResults },
            ],
          });
          let separated = !fullText.trim();
          const beforeConfirmation = fullText.length;
          for await (const event of followUp) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              menuFilter.push(separated ? event.delta.text : `\n\n${event.delta.text}`);
              separated = true;
            }
          }
          menuFilter.flush();

          if (!fullText.slice(beforeConfirmation).trim()) {
            let text: string;
            if (lastApply === undefined) {
              text = lastQuote?.price
                ? `${lastQuote.price.price_text} Should I make that change?`
                : lastQuote?.diveMenuSet
                  ? DIVE_MENU_SET_MESSAGE
                  : lastQuote?.refusedDrinks
                  ? DRINKS_LOCKED_MESSAGE
                  : "Anything else you would like to change?";
            } else if (!lastApply) {
              text = "Sorry, that change did not go through. Our team will follow up with you.";
            } else if (lastApply.needsQuote) {
              text = `${lastApply.needsQuote.price_text} Should I make that change?`;
            } else if (lastApply.held && lastApply.rows.length === 0) {
              text = `${LIST_CHANGE_HELD_MESSAGE} Anything else you would like to change?`;
            } else if (lastApply.rows.length === 0) {
              text = lastApply.diveMenuSet ? DIVE_MENU_SET_MESSAGE : lastApply.refusedDrinks ? DRINKS_LOCKED_MESSAGE : "That is already on file. Anything else you would like to change?";
            } else {
              const saved = lastApply.rows.some((r) => r.applied)
                ? "That change is saved."
                : "I have sent that to a manager who will reach out to you shortly.";
              text = [lastApply.diveMenuSet ? DIVE_MENU_SET_MESSAGE : lastApply.refusedDrinks ? DRINKS_LOCKED_MESSAGE : "", saved, "Anything else you would like to change?"]
                .filter(Boolean)
                .join(" ");
            }
            const chunk = fullText.trim() ? `\n\n${text}` : text;
            fullText += chunk;
            send(controller, { text: chunk });
          }
        }

        menuFilter.finish();

        await saveUpdateMessages(session.id, [...messages, assistantMessage(fullText.trim(), menuFilter.menus())]);

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
  const { messages, sessionId, clientName, email, chatStartVersion } = await request.json();

  // Sessions that already submitted their event get update mode instead of intake.
  let session: SessionRow | null = null;
  if (sessionId) {
    session = await getSession(sessionId);
    if (session?.status === "submitted" && session.event_data) {
      const start = typeof chatStartVersion === "number" ? chatStartVersion : session.version;
      return updateModeResponse(session, messages, start, new URL(request.url).origin);
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
      const menuFilter = createMenuFilter(
        allowedMenus(session?.package_type ?? packageFromContext(messages)),
        (text) => {
          fullText += text;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
        },
        (menu) => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ event: "menu", menu })}\n\n`))
      );
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            menuFilter.push(event.delta.text);
          }
        }
        menuFilter.finish();

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
            assistantMessage(closingText, menuFilter.menus()),
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
            // Dive Bar: record the five set menu drinks as the event's menu.
            const eventData = applyDiveSetMenu(toolUse.input as Record<string, unknown>);
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
