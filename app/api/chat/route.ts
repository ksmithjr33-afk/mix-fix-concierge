import Anthropic from "@anthropic-ai/sdk";
import { buildIntakePrompt } from "@/lib/system-prompt";
import { supabase } from "@/lib/supabase";
import { buildUpdatePrompt } from "@/lib/update-prompt";
import {
  approvalReason,
  changeBlocks,
  computeDeadlines,
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
  saveFinalSubmission,
  type SessionRow,
} from "@/lib/event-updates";
import { UPDATE_OPENER } from "@/lib/update-mode-shared";
import { deliverEventUpdates } from "@/lib/update-delivery";
import { allowedMenus, createMenuFilter, type MenuKey } from "@/lib/menu-markers";
import { applyDiveSetMenu, DIVE_MENU_SET_MESSAGE } from "@/lib/dive-menu";
import { DEFAULT_DEPOSIT, impliedLine, money, paymentPhrase, type PriceChange } from "@/lib/price-change";
import { CHANGE_REQUEST_MESSAGE } from "@/lib/client-list";
import { announceRequest } from "@/lib/change-requests";
import { eventTimeZone } from "@/lib/team/markets";
import { submitEventDataTool } from "@/lib/intake-tools";
import { createFillerFilter, pendingLines, PRICE_PENDING_CLIENT_MESSAGE, quotedAmount, unpriced, type PricePendingInfo } from "@/lib/price-pending";
import { recordClientQuoted, textPricePending } from "@/lib/price-pending-db";

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
function quoteToolResult(quote: QuoteResult | null, pending: PricePendingInfo | null = null): string {
  if (!quote) return "TOOL RESULT: This event could not be priced right now. Tell the client our team will confirm the price, and do not quote anything.";
  const parts: string[] = [];
  if (quote.diveMenuSet) parts.push(`DRINK MENU SET, Dive Bar has a set menu and drinks cannot be changed. Say exactly: "${DIVE_MENU_SET_MESSAGE}"`);
  if (quote.listHold) {
    parts.push(`REQUEST FOR APPROVAL, within 6 days of the event. This change would change the client's shopping list, so after they say yes it is sent to our team for approval instead of saving. Tell them that when you ask, and after update_event_data say exactly: "${CHANGE_REQUEST_MESSAGE}"`);
  }
  if (!quote.price && pending) {
    parts.push(`ALREADY SAVED, PRICE PENDING: this is already saved and waiting for our management team to set the new total (${pendingLines(pending).join("; ")}). Acknowledge it in a few words, do not mention the price again, do not ask them to confirm it, and ask if there is anything else they would like to change.`);
  } else if (!quote.price) {
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
  }
  if (result.requestFailed) {
    parts.push("NOTHING SAVED AND NOT SENT: this change is within 6 days of the event and could not be sent to our team for approval right now. Tell the client honestly it did not go through and our team will follow up. Do not say it was saved or sent.");
  }
  if (result.held) {
    parts.push(`NOT SAVED, SENT TO OUR TEAM FOR APPROVAL: within 6 days of the event this change is a request that our team approves or declines first. It is NOT confirmed. Never say it was saved, updated, changed, or done. Say exactly: "${CHANGE_REQUEST_MESSAGE}" Anything listed below as SAVED AND APPLIED NOW was saved separately and can be confirmed.`);
  }
  if (result.rows.length === 0 && !result.requestFailed && !result.diveMenuSet && !result.held) {
    if (result.pricePending) {
      return `TOOL RESULT: ALREADY SAVED, PRICE PENDING: this is already saved and waiting for our management team to set the new total. Acknowledge it in a few words, do not mention the price again, do not ask them to confirm it, and ask if there is anything else they would like to change.`;
    }
    return "TOOL RESULT: NOTHING was recorded because every value sent already matches what is on file. Tell the client it is already on file. Do not say you updated or saved anything.";
  }
  if (result.pricePending?.fresh) {
    parts.push(
      `SAVED, PRICE PENDING: the change below is saved exactly as the client asked, but our pricing engine cannot price it, so our management team will set the new total and reach out. Say exactly, once: "${PRICE_PENDING_CLIENT_MESSAGE}" Then ask if there is anything else they would like to change. Never state, estimate, or confirm any total or difference, even one the client mentions, and never ask them to confirm this change again.`
    );
  }
  for (const r of result.rows) {
    const details = changeBlocks(r.changes).join("\n\n");
    parts.push(
      r.applied
        ? `SAVED AND APPLIED NOW, the event is now version ${r.version}:\n${details}`
        : `NOT SAVED, sent to a manager (${approvalReason(r)}):\n${details}`
    );
  }
  if (result.priceChange && !result.pricePending) {
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
  const systemText = buildUpdatePrompt(eventData, session.version, deadlines, {
    booked: session.booked_price ?? null,
    recap: since ? { lines: recapLines(since.changes), totalBefore: since.totalBefore, totalAfter: since.totalAfter } : null,
    pricePending: session.price_pending ? (session.price_pending_info ?? null) : null,
  });
  // A price the client mentions while one is pending goes on the admins' summary.
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const mentioned = quotedAmount(lastUser);
  if (session.price_pending && mentioned) await recordClientQuoted(session, mentioned);
  // For a change saved without a price: what the client says they were quoted in this chat, latest first.
  const clientQuoted = [...messages].reverse().filter((m) => m.role === "user").map((m) => quotedAmount(m.content)).find(Boolean) ?? null;
  // Cached: the tools and this prompt are the same on every turn of the chat
  // and on the follow up turn, so later requests reuse them instead of
  // resending ~all of it. Same words to the model, only faster and cheaper.
  const system: Anthropic.TextBlockParam[] = [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }];
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
      // "Let me get a price" and the like never reach the client: the price is never in that sentence.
      let filler = createFillerFilter((t) => menuFilter.push(t));
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            filler.push(event.delta.text);
          }
        }
        filler.finish();
        menuFilter.flush();

        const finalMessage = await stream.finalMessage();
        const toolUses = finalMessage.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
        );

        // What follows any save: the page refresh, a change request's text, the
        // price pending admin text, and the GHL update.
        const afterApply = async (result: ApplyResult | null) => {
          if (!result) return;
          if (result.held) {
            send(controller, { event: "held" });
            // GHL gets change_request_pending and the admins get one text (8 AM after quiet hours).
            if (result.held.fresh) await announceRequest(result.held.id);
          }
          if (result.rows.length === 0) return;
          // Refresh the event details on the page as soon as the save lands.
          send(controller, {
            event: "updated",
            eventData: result.eventData,
            version: result.version,
            updatedAt: result.updatedAt,
            updates: result.rows.map((r) => ({ version: r.version, applied: r.applied, summary: r.summary })),
          });
          // Saved without a price: the admins get one text right away.
          if (result.pricePending?.fresh) {
            const fresh = await getSession(session.id);
            await textPricePending(fresh ?? session, result.pricePending.info);
          }
          // Send the GHL note and update webhook before the bot confirms the change.
          // Assigned staff get a text with their event page link; it never blocks the update.
          await deliverEventUpdates(session.id, result.rows, { staffOrigin: origin });
        };

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
              // The engine cannot price it: save it now as the client asked (no retry,
              // no second confirmation), mark the price pending, and text the admins.
              // A change that goes to our team as a request inside six days stays a request.
              if (lastQuote && unpriced(lastQuote.price) && !lastQuote.listHold && !lastQuote.diveMenuSet) {
                const saved = await applyEventUpdate(session.id, input, { clientQuoted }).catch((err) => {
                  console.error("price pending save failed:", err);
                  return null;
                });
                lastApply = saved;
                lastQuote = undefined;
                await afterApply(saved);
                toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: updateToolResult(saved) });
                continue;
              }
              toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: quoteToolResult(lastQuote, session.price_pending ? (session.price_pending_info ?? null) : null) });
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
              clientQuoted,
            });
            lastApply = result;
            await afterApply(result);
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
          filler = createFillerFilter((t) => menuFilter.push(t));
          for await (const event of followUp) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              filler.push(separated ? event.delta.text : `\n\n${event.delta.text}`);
              separated = true;
            }
          }
          filler.finish();
          menuFilter.flush();

          if (!fullText.slice(beforeConfirmation).trim()) {
            let text: string;
            if (lastApply === undefined) {
              text = lastQuote?.price
                ? `${lastQuote.price.price_text} Should I make that change?`
                : lastQuote?.diveMenuSet
                  ? DIVE_MENU_SET_MESSAGE
                  : "Anything else you would like to change?";
            } else if (!lastApply) {
              text = "Sorry, that change did not go through. Our team will follow up with you.";
            } else if (lastApply.pricePending?.fresh) {
              text = `${PRICE_PENDING_CLIENT_MESSAGE} Anything else you would like to change?`;
            } else if (lastApply.pricePending && lastApply.rows.length === 0) {
              text = "That is already saved. Anything else you would like to change?";
            } else if (lastApply.needsQuote) {
              text = `${lastApply.needsQuote.price_text} Should I make that change?`;
            } else if (lastApply.requestFailed && lastApply.rows.length === 0) {
              text = "Sorry, that change did not go through. Our team will follow up with you.";
            } else if (lastApply.held && lastApply.rows.length === 0) {
              text = `${CHANGE_REQUEST_MESSAGE} Anything else you would like to change?`;
            } else if (lastApply.rows.length === 0) {
              text = lastApply.diveMenuSet ? DIVE_MENU_SET_MESSAGE : "That is already on file. Anything else you would like to change?";
            } else {
              const saved = lastApply.rows.some((r) => r.applied)
                ? lastApply.held
                  ? "Your other changes are saved."
                  : "That change is saved."
                : "I have sent that to a manager who will reach out to you shortly.";
              text = [lastApply.diveMenuSet ? DIVE_MENU_SET_MESSAGE : "", lastApply.held ? CHANGE_REQUEST_MESSAGE : "", saved, "Anything else you would like to change?"]
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
    // Cached (with the tool before it): the ~18k token prompt is the same on
    // every turn, so later turns read it from the cache. Same words to the model.
    system: [
      {
        type: "text",
        text: buildIntakePrompt(booked ? { total: booked.total ?? null, deposit: booked.deposit_paid ?? DEFAULT_DEPOSIT } : null),
        cache_control: { type: "ephemeral" },
      },
    ],
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
            // A failure is retried once, logged as [FINAL SAVE FAILED], and
            // listed for admins; it never stops the webhook or the client's finish.
            await saveFinalSubmission(sessionId, eventData as EventData);

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
