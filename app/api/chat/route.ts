import Anthropic from "@anthropic-ai/sdk";
import { buildIntakePrompt } from "@/lib/system-prompt";
import { bookingPackageSection } from "@/lib/package-prompt";
import { applyIntakeBarback, intakeBarbackQuote, splitBarback } from "@/lib/intake-barback";
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
  bookedEventFrom,
  changesSince,
  getSession,
  quoteEventUpdate,
  type QuoteResult,
  type SessionRow,
} from "@/lib/event-updates";
import { UPDATE_OPENER } from "@/lib/update-mode-shared";
import { deliverEventUpdates } from "@/lib/update-delivery";
import { allowedMenus, createMenuFilter, type MenuKey } from "@/lib/menu-markers";
import { applyDiveSetMenu, DIVE_CARD_MAX, DIVE_MENU_SET_MESSAGE } from "@/lib/dive-menu";
import { DEFAULT_DEPOSIT, impliedLine, money, paymentPhrase, toCount, type PriceChange } from "@/lib/price-change";
import { CHANGE_REQUEST_MESSAGE } from "@/lib/client-list";
import { announceRequest } from "@/lib/change-requests";
import { clientAsks, clientEventData, updateToolInput, withClientVoice } from "@/lib/team-notes";
import { packageDrinkCount } from "@/lib/event-diff";
import { eventTimeZone } from "@/lib/team/markets";
import { quoteGuestCountTool, submitEventDataTool } from "@/lib/intake-tools";
import { guestCountFlag, guestQuoteToolResult, quoteGuestCount, submitWithGuestCount } from "@/lib/intake-guests";
import { createFillerFilter, pendingLines, PRICE_PENDING_CLIENT_MESSAGE, quotedAmount, unpriced, type PricePendingInfo } from "@/lib/price-pending";
import { recordClientQuoted, textPricePending } from "@/lib/price-pending-db";
import { bookedFacts, contextFields, factsAsSession } from "@/lib/booked-facts";
import { present } from "@/lib/blank";
import { formatClock, parseClock } from "@/lib/team/time";
import {
  checkDrinks,
  CLOSING_PATTERN,
  closedEarlier,
  createClaimFilter,
  FORCE_SUBMIT_INSTRUCTION,
  GENERIC_NEXT,
  hasQuestion,
  honoreeFit,
  nextPlanStep,
  openingSummarySection,
  regenerateInstruction,
  resultLine,
  SAVE_FAILED_LINE,
  type DrinkCheck,
  type KnownBooking,
  type PlanContext,
  type SaveOutcome,
} from "@/lib/intake-plan";
import { alertDrinks, alertSaveFailed } from "@/lib/intake-alerts-db";
import { bookingFill } from "@/lib/booking-webhook";
import { currentPopularDrinks } from "@/lib/popular-drinks-db";
import { popularForPrompt } from "@/lib/popular-drinks";
import { createInviteFilter, inviteToAdd, inviteUsed } from "@/lib/menu-invite";
import { partnerChatFor, type PartnerChat } from "@/lib/partners/chat-bridge";
import {
  APPROVAL_FAILED_TOOL_RESULT,
  bookingQuestionsSection,
  hideMoney,
  mergeChatTurns,
  plannerIntakeSection,
  planningRoleToolResult,
  savePlanningRoleTool,
  plannerUpdateSection,
  sentForApprovalToolResult,
  takeBookingAnswers,
  withBookingFields,
  type MessageAuthor,
} from "@/lib/partners/chat";
import { askForApproval, changedPriced, splitPriced } from "@/lib/partners/approvals";
import { applyBookingAnswers, plannerChanged, requestGuestCountApproval, savePlanningRole } from "@/lib/partners/planning";
import { honoreeRefusal, isHonoree, planningRoleOf, surpriseActive, surpriseOf } from "@/lib/partners/surprise";
import { normalizePhone } from "@/lib/team/codes";
import { sentForApprovalLine } from "@/lib/partners/rules";
import { savePartnerChat } from "@/lib/partners/event-page";
import { clientLinkBlocked } from "@/lib/partners/client-view";
import type { EventSession } from "@/lib/partners/db";

const anthropic = new Anthropic();

interface ChatMessage {
  role: string;
  content: string;
  menus?: MenuKey[]; // menu images shown with this message, never sent to the model
  by?: MessageAuthor; // who wrote a user message: a planner, or (untagged) the client
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
    "Save a change to this already submitted event. It applies right away. Call it only after the client clearly said yes. Include ONLY the fields that changed. When any drink changes, send the complete signature_drinks array. Anything the client tells you that no other field covers goes in special_requests, written to the client ('You will provide your own cups.'), following the special_requests rule in the prompt. Anything for our team only goes in team_note. A change to guest count, service times or hours, bartenders, package, or the barback must be quoted with quote_price_change first, and quoted_new_total must be the new total you quoted. Use manager_request only for drinks beyond the package count. Set change_approval_needed when you passed something along to management under the CONDUCT RULE.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      ...Object.fromEntries(
        UPDATABLE_FIELDS.filter((field) => field !== "team_notes").map((field) => [field, submitProperties[field] ?? { type: "string" }])
      ),
      team_note: {
        type: "string",
        description: "One new note for our team only (a follow up, what the client says they were promised, an instruction to staff). It is added to the team notes; the client never sees it. See SPECIAL REQUESTS AND TEAM NOTES.",
      },
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
    "Price a proposed change to guest count, service times or hours, bartenders, package, or the Full Bar wedding barback with our pricing engine. Saves nothing. Call it before confirming any such change, with ONLY the new values, then state the difference and new total from the result and ask the client for a clear yes.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: Object.fromEntries(
      PRICED_FIELDS.map((field) => [field, (updateEventDataTool.input_schema.properties as Record<string, unknown>)[field]])
    ),
  },
};

/**
 * Save the planning chat. The client and a planner can be in it at the same
 * time, each sending back their own view of the chat, so the stored messages
 * are read again right before every save and only the new turns are appended
 * (mergeChatTurns). The save only lands if nobody saved in between (the
 * updated_at it read); otherwise it reads again and merges again. No turn is
 * ever dropped.
 */
async function upsertConversationLog(
  sessionId: string,
  clientName: string | null,
  email: string | null,
  messages: ChatMessage[]
) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data: existing, error: selectError } = await supabase
      .from("conversation_logs")
      .select("id, messages, updated_at")
      .eq("session_id", sessionId)
      .maybeSingle();

    if (selectError) {
      console.error("conversation_logs select error:", selectError);
      return;
    }

    const nowIso = new Date().toISOString();

    if (existing) {
      const row = existing as { messages?: ChatMessage[]; updated_at?: string | null };
      const merged = mergeChatTurns(row.messages, messages);
      let q = supabase.from("conversation_logs").update({ messages: merged, updated_at: nowIso }).eq("session_id", sessionId);
      q = row.updated_at ? q.eq("updated_at", row.updated_at) : q.is("updated_at", null);
      const { data: saved, error } = await q.select("id");
      if (error) {
        console.error("conversation_logs update error:", error);
        return;
      }
      if (saved && (saved as unknown[]).length > 0) return;
      continue; // someone else saved in between: read again and merge again
    }
    const { error } = await supabase.from("conversation_logs").insert({
      session_id: sessionId,
      client_name: clientName,
      email,
      messages,
      updated_at: nowIso,
    });
    if (!error) return;
    // The other person's first save landed first: merge into it.
    console.error("conversation_logs insert error, merging instead:", error);
  }
  console.error(`conversation_logs: ${sessionId} could not be saved after retries`);
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
  parts.push(...diveCardLines(quote));
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

/** Dive Bar menu card picks the server dropped, for the bot to say so. */
function diveCardLines(r: { diveCardRefused: string[]; diveCardOverMax: string[] }): string[] {
  const out: string[] = [];
  if (r.diveCardRefused.length > 0) {
    out.push(`NOT ON THE MENU CARD: ${r.diveCardRefused.join(", ")}. A Dive Bar menu card holds only the classics Dive Bar allows, never a specialty cocktail, a mocktail, a custom drink, or a drink Dive Bar leaves out. Tell the client that is a Full Bar feature, and offer to switch the package to Full Bar (a package change is a PRICE CHANGE: quote it with quote_price_change first). Never call it a signature or specialty cocktail.`);
  }
  if (r.diveCardOverMax.length > 0) {
    out.push(`NOT ON THE MENU CARD: ${r.diveCardOverMax.join(", ")}. A Dive Bar menu card holds at most ${DIVE_CARD_MAX} classics. Tell the client the card is full at ${DIVE_CARD_MAX} and they can swap one instead.`);
  }
  return out;
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
  parts.push(...diveCardLines(result));
  if (result.requestFailed) {
    parts.push("NOTHING SAVED AND NOT SENT: this change is within 6 days of the event and could not be sent to our team for approval right now. Tell the client honestly it did not go through and our team will follow up. Do not say it was saved or sent.");
  }
  if (result.held) {
    parts.push(`NOT SAVED, SENT TO OUR TEAM FOR APPROVAL: within 6 days of the event this change is a request that our team approves or declines first. It is NOT confirmed. Never say it was saved, updated, changed, or done. Say exactly: "${CHANGE_REQUEST_MESSAGE}" Anything listed below as SAVED AND APPLIED NOW was saved separately and can be confirmed.`);
  }
  const cardDropped = result.diveCardRefused.length > 0 || result.diveCardOverMax.length > 0;
  if (result.rows.length === 0 && !result.requestFailed && !result.diveMenuSet && !result.held && !cardDropped) {
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

async function updateModeResponse(session: SessionRow, messages: ChatMessage[], chatStartVersion: number, origin: string, partner: PartnerChat | null = null) {
  const eventData = session.event_data as EventData;
  // A planner who does not hold the booking never hears a price and never accepts one: priced changes go to the holder.
  const approvalOnly = !!partner && !partner.ctx.holdsBooking;
  const deadlines = computeDeadlines(eventData.event_date ?? session.event_date, undefined, eventTimeZone(session));
  // Every change saved since this chat opened, for the final recap.
  const since = await changesSince(session.id, chatStartVersion).catch(() => null);
  const systemText = buildUpdatePrompt(eventData, session.version, deadlines, {
    booked: approvalOnly ? null : (session.booked_price ?? null),
    planner: partner ? plannerUpdateSection(partner.ctx) : undefined,
    recap: since ? { lines: recapLines(since.changes), totalBefore: since.totalBefore, totalAfter: since.totalAfter } : null,
    pricePending: session.price_pending ? (session.price_pending_info ?? null) : null,
    packageSection: bookingPackageSection(session, String(eventData.package ?? ""), messages, approvalOnly ? "approval" : "update"),
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
    content: partner && !partner.money.total ? hideMoney(m.content) : m.content,
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
          // The browser never gets team notes or the extra drinks waiting for an answer.
          send(controller, {
            event: "updated",
            eventData: clientEventData(result.eventData),
            asks: clientAsks(result.eventData, packageDrinkCount(result.eventData.package)),
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
          // A planner's change: logged under their name, and the client (or the Lead) gets a summary.
          if (partner && result.rows.some((r) => r.applied)) {
            await plannerChanged(partner.access, { submitted: false, summary: result.rows.filter((r) => r.applied).flatMap((r) => recapLines(r.changes)).join("; ") });
          }
        };

        if (toolUses.length > 0) {
          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          let lastApply: ApplyResult | null | undefined;
          let lastQuote: QuoteResult | null | undefined;
          let approvalLine = ""; // a planner's priced change sent to the booking holder
          for (const toolUse of toolUses) {
            // Only the client's own Yes on their page adds extra drinks with a price, never the concierge.
            const input = updateToolInput(eventData, toolUse.input as Record<string, unknown>);
            if (toolUse.name === "quote_price_change" && approvalOnly && partner) {
              // Quoted the same way, but it goes to the booking holder instead of to this planner.
              const priced = changedPriced(eventData, splitPriced(input).priced);
              const asked = Object.keys(priced).length > 0 ? await askForApproval(session, priced, partner.access.actor) : ({ kind: "no_price" } as const);
              if (asked.kind === "no_price") {
                // No change in price: they already said yes, so it saves the normal way.
                const saved = await applyEventUpdate(session.id, input, {}).catch(() => null);
                lastApply = saved;
                await afterApply(saved);
                toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: updateToolResult(saved) });
              } else {
                lastApply = undefined;
                lastQuote = undefined;
                approvalLine = asked.kind === "sent" ? sentForApprovalLine(asked.holderFirstName) : "";
                toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: asked.kind === "sent" ? sentForApprovalToolResult(approvalLine) : APPROVAL_FAILED_TOOL_RESULT });
              }
              continue;
            }
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
              ...asSent
            } = input;
            let partial: Record<string, unknown> = asSent;
            if (approvalOnly && partner) {
              // Never applied for this planner: a priced change (it goes to the holder) or a payment choice.
              const { priced, rest } = splitPriced(asSent);
              delete rest.payment_preference;
              const changed = changedPriced(eventData, priced);
              partial = rest;
              if (Object.keys(changed).length > 0) {
                const asked = await askForApproval(session, changed, partner.access.actor);
                if (asked.kind === "no_price") partial = { ...rest, ...changed };
                else approvalLine = asked.kind === "sent" ? sentForApprovalLine(asked.holderFirstName) : "";
              }
              if (Object.keys(partial).length === 0) {
                toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: approvalLine ? sentForApprovalToolResult(approvalLine) : APPROVAL_FAILED_TOOL_RESULT });
                continue;
              }
            }
            // A surprise event: the guest of honor's number is never the day of contact.
            let honoreeLine = "";
            if (surpriseActive(session as EventSession) && isHonoree(session as EventSession, { phone: partial.day_of_contact_phone })) {
              honoreeLine = honoreeRefusal("day of contact");
              partial = Object.fromEntries(Object.entries(partial).filter(([k]) => k !== "day_of_contact_phone"));
              if (Object.keys(partial).length === 0) {
                toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: `TOOL RESULT: NOT SAVED. Say exactly: "${honoreeLine}" Then ask for a different day of contact number.` });
                continue;
              }
            }
            const result = await applyEventUpdate(session.id, partial, {
              managerRequest: typeof managerRequest === "string" ? managerRequest : null,
              changeApprovalNeeded: changeApprovalNeeded === true,
              requireQuote: true,
              quotedNewTotal,
              clientQuoted,
            });
            lastApply = result;
            await afterApply(result);
            let recorded = updateToolResult(result);
            if (honoreeLine) recorded += `\n\nNOT SAVED: the day of contact number. Say exactly: "${honoreeLine}"`;
            toolResults.push({ type: "tool_result", tool_use_id: toolUse.id, content: approvalLine ? `${recorded}\n\nALSO SENT FOR APPROVAL, NOT SAVED: the part of this change that affects the price. Say exactly: "${approvalLine}"` : recorded });
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
            if (approvalLine && lastApply === undefined) {
              text = `${approvalLine} Anything else you would like to change?`;
            } else if (lastApply === undefined) {
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
            } else if (lastApply.rows.length === 0 && (lastApply.diveCardRefused.length > 0 || lastApply.diveCardOverMax.length > 0)) {
              text = lastApply.diveCardRefused.length > 0
                ? "That is a Full Bar feature. Your menu card can have classics only. Anything else you would like to change?"
                : `Your menu card can hold up to ${DIVE_CARD_MAX} classics. Anything else you would like to change?`;
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

        if (partner && partner.access.actor.partnerId) {
          // Each planner's update chat is their own, never the client's (which can show prices).
          await savePartnerChat(session.id, partner.access.actor.partnerId, [...messages, assistantMessage(fullText.trim(), menuFilter.menus())]);
        } else {
          await saveUpdateMessages(session.id, [...messages, assistantMessage(fullText.trim(), menuFilter.menus())]);
        }

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

/**
 * The opening question, the surprise question, and the planner question, each
 * asked once. A question is skipped once it is answered (saved on the session
 * by save_planning_role or at submit) or when the booking already tells us:
 * a planner holds it, a host is named, or it is already a surprise. Before the
 * surprise migration the answers cannot be saved mid chat, so the chat itself
 * is what keeps it to once.
 */
function whoIsPlanning(s: EventSession, bookedType: string | null): { text: string; canSave: boolean } {
  const ready = "is_surprise" in s; // the surprise migration ran
  const holderPlanner = s.booking_holder === "planner";
  const plannerAsked = s.planner_asked === true;
  // The surprise question is only for SURPRISE_EVENT_TYPES. The booking's type first; with none, the chat waits until the client says.
  const eventType = bookingEventType(s) || bookedType;
  // The role question only makes sense when the event has a guest of honor (a birthday, a wedding, ...).
  // A generic booking type (Social Gathering) waits until the client says what they are celebrating.
  const fit = honoreeFit(eventType);
  const roleFit = fit === "ask" ? ("ask" as const) : ("unknown" as const);
  if (!ready) {
    const ask = !holderPlanner && !plannerAsked;
    return { text: bookingQuestionsSection({ askRole: ask && fit !== "skip", askPlanner: ask, eventType, roleFit }), canSave: false };
  }
  const surprise = surpriseOf(s);
  const known = planningRoleOf(s) ?? (holderPlanner ? "planner" : s.host_name ? "someone_else" : surprise.on ? "someone_else" : null);
  const askRole = !known && !plannerAsked && fit !== "skip";
  const askSurprise = !surprise.answered && (askRole || known === "someone_else" || known === "planner");
  const askPlanner = !holderPlanner && !plannerAsked && known !== "planner";
  return { text: bookingQuestionsSection({ askRole, askSurprise, askPlanner, role: known, canSave: true, eventType, roleFit }), canSave: true };
}

/** The booking's event type: the session's event_type, then event_data.event_type. */
function bookingEventType(s: EventSession): string | null {
  const t = (v: unknown) => present(v);
  return t((s as { event_type?: unknown }).event_type) ?? t(s.event_data?.event_type);
}

/** On a surprise event, the concierge never suggests contacting the guest of honor. */
function surpriseReminder(s: EventSession, askPrivate: boolean): string {
  if (!surpriseActive(s)) return "";
  const first = surpriseOf(s).firstName || "the guest of honor";
  const ask = askPrivate ? ` If you have not asked yet, ask once, exactly: "What is the best private number to reach you about this event?" and send it as private_phone in submit_event_data.` : "";
  return `SURPRISE EVENT: this is a surprise for ${first}. Never suggest contacting ${first}, never ask for their phone or email, and never offer them access.${ask}`;
}

/** What the booking already told us, for the opening summary and the plan. Missing values ("null") stay missing. */
function knownBooking(session: SessionRow | null, facts: ReturnType<typeof bookedFacts>, messages: ChatMessage[]): KnownBooking {
  const first = messages[0];
  const ctx = first?.role === "user" && typeof first.content === "string" ? contextFields(first.content) : {};
  const s = (session ?? {}) as Record<string, unknown>;
  const start = facts.startTime ? parseClock(facts.startTime) : null;
  return {
    name: present(s.name) ?? present(ctx["Client name"]),
    eventDate: present(s.event_date) ?? present(ctx["Event date"]),
    packageType: present(s.package_type) ?? present(ctx["Package"]),
    guests: facts.guests ?? null,
    hours: facts.hours,
    startTime: facts.startTime,
    endTime: start !== null && facts.hours ? formatClock(start + Math.round(facts.hours * 60)) : null,
    bartenders: facts.bartenders,
    eventType: facts.eventType ?? present(s.event_name),
    city: present(s.event_city),
    state: present(s.event_state),
  };
}

export async function POST(request: Request) {
  const { messages: rawMessages, sessionId, clientName, email, chatStartVersion } = await request.json();
  // An empty reply stored earlier (a turn that wrote nothing) is never sent back to the model.
  const messages: ChatMessage[] = (Array.isArray(rawMessages) ? rawMessages : []).filter((m: ChatMessage) => typeof m?.content === "string" && m.content.trim() !== "");
  // A planner, checked by /api/partners/chat and attached in process. Null for every browser request here.
  const partner = partnerChatFor(request);
  const approvalOnly = !!partner && !partner.ctx.holdsBooking;

  // Sessions that already submitted their event get update mode instead of intake.
  let session: SessionRow | null = null;
  if (sessionId) {
    session = await getSession(sessionId);
    // A removed or deactivated planner's old booking link changes nothing.
    if (!partner && session && (await clientLinkBlocked(session as EventSession).catch(() => false))) {
      return Response.json({ error: "This link is no longer active." }, { status: 403 });
    }
    if (session?.status === "submitted" && session.event_data) {
      const start = typeof chatStartVersion === "number" ? chatStartVersion : session.version;
      return updateModeResponse(session, messages, start, new URL(request.url).origin, partner);
    }
  }

  // The payment step quotes the remaining balance: booked total minus the deposit.
  const booked = session?.booked_price ?? null;
  // What the booking already gave (start time, bartenders, event type) is never asked again.
  const facts = bookedFacts(session as unknown as Record<string, unknown> | null, messages);
  const known = knownBooking(session, facts, messages);
  // The most popular lists the concierge answers "what is popular?" from (cached 10 minutes).
  const popular = await currentPopularDrinks().catch((err) => {
    console.error("popular drinks failed:", err);
    return null;
  });
  // A booked guest count is confirmed, not asked, and a different number is
  // priced with quote_guest_count. Only with a session row to price from.
  // A planner who cannot approve price changes never gets it: a different count goes to the holder.
  const guestTool = session !== null && !!facts.guests && !approvalOnly;
  const people = partner ? plannerIntakeSection(partner.ctx) : session ? whoIsPlanning(session as EventSession, facts.eventType) : { text: "", canSave: false };
  // Cached (with the tools before it): the ~18k token prompt is the same on
  // every turn, so later turns read it from the cache. Same words to the model.
  const system: Anthropic.TextBlockParam[] = [
    {
      type: "text",
      text: buildIntakePrompt(booked && !approvalOnly ? { total: booked.total ?? null, deposit: booked.deposit_paid ?? DEFAULT_DEPOSIT } : null, new Date(), {
        booked: guestTool || approvalOnly ? facts : { ...facts, guests: null },
        popular: popular ? popularForPrompt(popular) : null,
        // Who is planning: a planner, or the client asked once (only for a session we can record the answer on).
        people: [typeof people === "string" ? people : people.text, session ? surpriseReminder(session as EventSession, !partner) : ""].filter(Boolean).join("\n"),
        noPayment: approvalOnly,
        opening: openingSummarySection(known),
        packageSection: session
          ? bookingPackageSection({ ...session, event_data: session.event_data ?? bookedEventFrom(session) }, String(session.package_type ?? ""), messages, approvalOnly ? "approval" : "intake", approvalOnly ? null : intakeBarbackQuote(session))
          : "",
      }),
      cache_control: { type: "ephemeral" },
    },
  ];
  const submitTool = session ? withBookingFields(submitEventDataTool) : submitEventDataTool;
  // save_planning_role: the opening and surprise answers are saved the moment they are given (after the surprise migration).
  const roleTool = typeof people !== "string" && people.canSave;
  const tools = [...(guestTool ? [quoteGuestCountTool] : []), ...(roleTool ? [savePlanningRoleTool] : []), submitTool];
  const history: Anthropic.MessageParam[] = messages.map((m: ChatMessage) => ({
    role: m.role as "user" | "assistant",
    content: partner && !partner.money.total ? hideMoney(m.content) : m.content,
  }));
  // What the code knows about the plan, to work out the next unanswered item.
  const planContext: PlanContext = {
    packageType: known.packageType,
    booking: known,
    planningRole: session ? planningRoleOf(session as EventSession) : null,
    plannerAsked: (session as EventSession | null)?.planner_asked === true || (session as EventSession | null)?.booking_holder === "planner",
    noPayment: approvalOnly,
  };
  // The chat already sent the closing line but nothing was submitted (the model skipped the tool):
  // this turn submits right away instead of chatting on, so the client is never told "submitted" falsely.
  const submitFirst = !!sessionId && !!session && closedEarlier(messages);

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
      // Our own words (the result of the final save, a missing question): straight to the client.
      const say = (t: string) => {
        const chunk = fullText.trim() ? `\n\n${t}` : t;
        fullText += chunk;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`));
      };
      // The recommendation invite: once, with the first menu, never repeated.
      const used = inviteUsed(messages);
      const invite = createInviteFilter(used, (t) => menuFilter.push(t));
      // With the guest count tool, "Let me get a price" never reaches the client: the price is never in that sentence.
      let filler = guestTool ? createFillerFilter((t) => invite.push(t)) : null;
      // The model never says the plan was submitted: only the real result does (resultLine).
      let claims = createClaimFilter((t) => (filler ? filler.push(t) : invite.push(t)));
      const push = (t: string) => claims.push(t);
      const flushModelText = () => {
        claims.finish();
        filler?.finish();
        invite.finish();
      };
      /** A second model turn whose words follow the first reply, through the same filters. */
      const streamMore = async (extra: Anthropic.MessageParam[], opts: { useFiller?: boolean } = {}) => {
        const more = anthropic.messages.stream({ model: "claude-sonnet-4-6", max_tokens: 1024, system, tools, tool_choice: { type: "none" }, messages: [...history, ...extra] });
        let separated = !fullText.trim();
        if (opts.useFiller) filler = createFillerFilter((t) => invite.push(t));
        claims = createClaimFilter((t) => (filler && opts.useFiller ? filler.push(t) : invite.push(t)));
        for await (const event of more) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            claims.push(separated ? event.delta.text : `\n\n${event.delta.text}`);
            separated = true;
          }
        }
        flushModelText();
      };
      /** The model's reply so far, as an assistant turn (never empty). */
      const replySoFar = (content: Anthropic.MessageParam["content"] | null): Anthropic.MessageParam[] =>
        content && (typeof content !== "string" || content.trim()) ? [{ role: "assistant", content }] : [];
      /** Ask the model for the submit_event_data call it skipped. */
      const forceSubmit = async (): Promise<Anthropic.ToolUseBlock | null> => {
        try {
          const forced = anthropic.messages.stream({
            model: "claude-sonnet-4-6",
            max_tokens: 8192,
            system,
            tools,
            tool_choice: { type: "tool", name: "submit_event_data" },
            messages: [...history, ...replySoFar(fullText.trim()), { role: "user", content: FORCE_SUBMIT_INSTRUCTION }],
          });
          for await (const _event of forced) {
            /* the tool input only, no words for the client */
          }
          const msg = await forced.finalMessage();
          return msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === "submit_event_data") ?? null;
        } catch (err) {
          console.error(`[FINAL SAVE] session=${sessionId}: the forced submit_event_data call failed:`, err);
          return null;
        }
      };

      try {
        let toolUse: Anthropic.ToolUseBlock | undefined;
        let quoteUse: Anthropic.ToolUseBlock | undefined;
        let closedNow = false;

        if (submitFirst) {
          // The closing already went out without a save: submit now, nothing else.
          toolUse = (await forceSubmit()) ?? undefined;
          closedNow = true;
        } else {
          const stream = anthropic.messages.stream({ model: "claude-sonnet-4-6", max_tokens: 8192, system, tools, messages: history });
          for await (const event of stream) {
            if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              push(event.delta.text);
            }
          }
          flushModelText();

          // Inspect the assembled message for the completion tool call.
          const finalMessage = await stream.finalMessage();
          toolUse = finalMessage.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === "submit_event_data");
          quoteUse = finalMessage.content.find((block): block is Anthropic.ToolUseBlock => block.type === "tool_use" && block.name === "quote_guest_count");
          // Who is planning, saved the moment it is answered, so it is never asked again.
          const roleResults: Anthropic.ToolResultBlockParam[] = [];
          let roleRefused = false;
          for (const block of finalMessage.content) {
            if (block.type !== "tool_use" || block.name !== "save_planning_role" || !sessionId) continue;
            const r = await savePlanningRole(sessionId, block.input as Record<string, unknown>);
            if (r.refused) roleRefused = true;
            roleResults.push({ type: "tool_result", tool_use_id: block.id, content: planningRoleToolResult(r) });
          }
          // A save with a refused number, or a reply that stopped at the save without the next
          // question (the model waits for the TOOL RESULT): a second turn that continues from it.
          if (roleResults.length > 0 && !quoteUse && !toolUse && (roleRefused || !hasQuestion(fullText))) {
            await streamMore([{ role: "assistant", content: finalMessage.content }, { role: "user", content: roleResults }]);
          }

          // A different guest count: price it, then a second turn where the bot
          // says what the TOOL RESULT says, the same way update mode quotes.
          if (quoteUse && !toolUse && session) {
            const asked = toCount((quoteUse.input as Record<string, unknown>).guest_count);
            const quote = asked ? quoteGuestCount(session, asked) : null;
            await streamMore(
              [
                { role: "assistant", content: finalMessage.content },
                { role: "user", content: [{ type: "tool_result", tool_use_id: quoteUse.id, content: guestQuoteToolResult(quote, asked) }, ...roleResults] },
              ],
              { useFiller: true }
            );
          }

          // The closing line without the submit_event_data call: never left hanging, the save is made now.
          closedNow = CLOSING_PATTERN.test(fullText);
          if (closedNow && !toolUse && sessionId && session) {
            console.warn(`[FINAL SAVE] session=${sessionId}: the closing went out without submit_event_data; asking for it now.`);
            toolUse = (await forceSubmit()) ?? undefined;
          }

          // Every reply before the wrap up ends with the next question: a reply with none is continued
          // with the next unanswered item, worked out from what is saved and what the chat covered.
          if (!toolUse && !closedNow && !hasQuestion(fullText)) {
            const next = nextPlanStep(planContext, [...messages, { role: "assistant", content: fullText }]);
            const instruction = regenerateInstruction(next);
            const extra: Anthropic.MessageParam[] = fullText.trim()
              ? [{ role: "assistant", content: fullText.trim() }, { role: "user", content: instruction }]
              : [{ role: "user", content: instruction }];
            await streamMore(extra).catch((err) => console.error("[next question] regenerate failed:", err));
            if (!hasQuestion(fullText)) say(next?.question ?? GENERIC_NEXT);
            console.warn(`[next question] session=${sessionId ?? "none"}: a reply had no question; asked ${next?.id ?? "the generic line"}.`);
          }
        }

        menuFilter.finish();
        const addInvite = inviteToAdd(used, menuFilter.menus().length, fullText);
        if (addInvite) {
          fullText += addInvite;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: addInvite })}\n\n`));
        }

        // The chat as the team sees it in the transcript: before our result line.
        const transcriptMessages: ChatMessage[] = [...messages, ...(fullText.trim() ? [assistantMessage(fullText.trim(), menuFilter.menus())] : [])];
        let completeData: unknown = null;

        if (sessionId && session && closedNow && !toolUse) {
          // The model would not make the call: nothing was saved, and the client hears that honestly.
          say(SAVE_FAILED_LINE);
          await alertSaveFailed(sessionId, session, {});
        } else if (sessionId && toolUse) {
          let outcome: SaveOutcome = "failed";
          let drinks: DrinkCheck | null = null;
          let attempted: Record<string, unknown> = {};
          try {
            // What the booking gave fills what the concierge left blank (it never
            // asks for a booked start time), so the events row, the GHL webhook,
            // and the session all get bar_service_start and bar_service_end.
            const { guest_count_quoted_total: quotedTotal, ...submitted } = toolUse.input as Record<string, unknown>;
            // Who is planning (and a planner's guest count ask) never goes in the event itself.
            const { answers: bookingAnswers, rest: answered } = takeBookingAnswers(submitted);
            // Skipped drink details still submit, marked Drinks not finalized; an extra drink nobody said yes to is held back.
            drinks = checkDrinks(answered, session?.package_type ?? answered.package);
            // Written to the client since 2026-11-21: these special requests may show on their page.
            const input = withClientVoice(drinks.data);
            attempted = input;
            // A surprise: the booker's private number is the client phone. The guest of honor's number is never saved as the client phone or the day of contact.
            const sx = ((await getSession(sessionId)) ?? session) as EventSession | null;
            const privatePhone = normalizePhone(bookingAnswers.privatePhone);
            const isSurprise = bookingAnswers.surprise?.on === true || (sx ? surpriseOf(sx).on : false);
            if (privatePhone && isSurprise && !partner && !(sx && isHonoree(sx, { phone: privatePhone }))) input.client_phone = privatePhone;
            if (sx && isHonoree(sx, { phone: input.day_of_contact_phone })) {
              console.warn(`[surprise] ${sessionId}: the guest of honor's number was not saved as the day of contact`);
              delete input.day_of_contact_phone;
            }
            const filled = { ...input, ...bookingFill(input, factsAsSession(facts)) };
            // Dive Bar: record the five set menu drinks, or the classics on the menu card the client asked for.
            // The barback asked for (Full Bar weddings) is applied after the save as a priced update.
            const split = splitBarback(approvalOnly ? null : session, applyDiveSetMenu(filled) as EventData);
            const eventData = split.data;
            const transcript = buildTranscript(transcriptMessages);
            const origin = new URL(request.url).origin;

            // Save the full payload on the session row as version 1 so the
            // session link opens in update mode from now on.
            // A failure is retried once, logged as [FINAL SAVE FAILED], and
            // listed for admins; it never stops the webhook.
            // A guest count different from the booked one is applied as version 2
            // (priced, or price pending), the way update mode applies it.
            const sub = await submitWithGuestCount(sessionId, session, eventData as EventData, quotedTotal);
            outcome = sub.saved;
            const finalData = { ...eventData, guest_count: sub.guestCount, ...(sub.bartenders !== undefined ? { bartenders: sub.bartenders } : {}) };

            // Fire (and await) the completion side effects BEFORE telling the
            // client the result, so they run regardless of whether the tab stays open.
            await fireCompletion(origin, finalData, transcript, email ?? null, sessionId);

            // The guest count update: one admin text when it could not be priced,
            // then the GHL update with the change order, after the completion webhook.
            if (sub.apply) {
              const fresh = await getSession(sessionId);
              if (sub.apply.pricePending?.fresh) await textPricePending(fresh ?? session!, sub.apply.pricePending.info);
              if (sub.apply.rows.length > 0) await deliverEventUpdates(sessionId, sub.apply.rows, { staffOrigin: origin });
            }
            if (split.barback && sub.saved !== "failed") {
              const bb = await applyIntakeBarback(sessionId, split.barback);
              if (bb?.pricePending?.fresh) await textPricePending((await getSession(sessionId)) ?? session!, bb.pricePending.info);
              if (bb && bb.rows.length > 0) await deliverEventUpdates(sessionId, bb.rows, { staffOrigin: origin });
            }
            // The safety net: a guest count that differs from the booking with no price change applied or pending.
            const after = await getSession(sessionId);
            const flag = after ? guestCountFlag(after) : null;
            if (flag) console.error(`[GUEST COUNT FLAG] session=${sessionId}: ${flag.text}`);

            // Planners: a client's answers about who is planning, or a planner's submission noticed and logged.
            if (partner) {
              await plannerChanged(partner.access, { submitted: true, summary: "" });
              if (approvalOnly && bookingAnswers.requestedGuests) await requestGuestCountApproval(partner.access, bookingAnswers.requestedGuests);
            } else {
              await applyBookingAnswers(sessionId, bookingAnswers);
            }
            if (outcome !== "failed") completeData = finalData;
          } catch (err) {
            console.error(`[FINAL SAVE FAILED] session=${sessionId}: submission threw:`, err);
            outcome = "failed";
          }

          // The client hears the real result, in our words, never the model's.
          say(resultLine(outcome, !!drinks?.notFinalized));
          if (outcome === "failed") await alertSaveFailed(sessionId, session, attempted);
          else if (drinks) await alertDrinks(sessionId, session, attempted, drinks);
        }

        if (sessionId) {
          await upsertConversationLog(sessionId, clientName ?? null, email ?? null, [...messages, assistantMessage(fullText.trim(), menuFilter.menus())]).catch((err) =>
            console.error("Failed to save conversation log:", err)
          );
        }
        if (completeData) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ event: "complete", eventData: clientEventData(completeData as Record<string, unknown>) })}\n\n`));
        }

        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error(`[chat] session=${sessionId ?? "none"}: turn failed:`, error);
        // Never an empty reply: the client is told plainly to send it again.
        if (!fullText.trim()) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: "Sorry, something went wrong on our end. Could you send that again?" })}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`));
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
