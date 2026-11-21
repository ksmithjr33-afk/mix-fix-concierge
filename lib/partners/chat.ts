// The planning chat and update mode when a planner (or a client being asked
// about planners) is on the other end. Pure: prompt sections, the booking
// answers the concierge sends with submit_event_data, and the "who said it"
// marks on each message.

import type Anthropic from "@anthropic-ai/sdk";
import { firstWord } from "@/lib/partners/rules";
import { HONOREE_EVENT_TYPES } from "@/lib/intake-plan";

/** Who wrote a chat message. Untagged user messages are the client's. */
export interface MessageAuthor {
  kind: "client" | "planner";
  name: string;
  partnerId?: string;
}

export interface TaggedMessage {
  role: string;
  content: string;
  menus?: unknown;
  by?: MessageAuthor;
}

/**
 * The client's browser sends the whole chat back each turn without the author
 * marks. Keep the marks already stored, matched by position and text, so a
 * planner's answers stay marked as theirs after the client keeps going.
 */
export function keepAuthors<T extends TaggedMessage>(stored: TaggedMessage[] | null | undefined, incoming: T[]): T[] {
  const prev = Array.isArray(stored) ? stored : [];
  return incoming.map((m, i) => {
    const old = prev[i];
    if (m.role === "user" && !m.by && old?.by && old.role === "user" && old.content === m.content) return { ...m, by: old.by };
    return m;
  });
}

/** Dollar amounts hidden, for a planner or host who does not see money. */
export function hideMoney(text: string): string {
  return text.replace(/\$\s?\d[\d,]*(\.\d+)?/g, "[price hidden]");
}

/** The booking questions' fields on submit_event_data. Taken off before the event is saved. */
export const BOOKING_ANSWER_FIELDS = [
  "booking_role",
  "host_name",
  "host_phone",
  "host_email",
  "planner_name",
  "planner_phone",
  "planner_company",
  "requested_guest_count",
  "is_surprise",
  "honoree_name",
  "private_phone",
] as const;

const ROLE_ENUM = ["guest_of_honor", "someone_else", "planner"];

export const bookingAnswerProperties: Record<string, unknown> = {
  booking_role: {
    type: "string",
    enum: ROLE_ENUM,
    description: 'The answer to "Are you the guest of honor, hosting this for someone else, or a planner booking for a client?". guest_of_honor also covers someone hosting their own event. Only when you asked it.',
  },
  host_name: { type: "string", description: "Hosting for someone else, or a planner booking for a client: the full name of the person the event is for." },
  host_phone: { type: "string", description: "A planner booking for a client, not a surprise: the host's mobile number, only if the planner wants the host to have access. Never for someone hosting for someone else." },
  host_email: { type: "string", description: "The host's email, only if a planner gave it. Never for someone hosting for someone else." },
  planner_name: { type: "string", description: "A client planning for themselves who is working with a planner: the planner's name." },
  planner_phone: { type: "string", description: "That planner's mobile number." },
  planner_company: { type: "string", description: "That planner's company, if given." },
  requested_guest_count: { type: "number", description: "Only for a planner who cannot approve price changes: a guest count they asked for that differs from the booked one." },
  is_surprise: { type: "boolean", description: 'The answer to "Is this a surprise for them?", only when you asked it.' },
  honoree_name: { type: "string", description: "A surprise: the guest of honor's name (the person the event is for)." },
  private_phone: { type: "string", description: 'A surprise: their answer to "What is the best private number to reach you about this event?".' },
};

export interface BookingAnswers {
  role: "self" | "someone_else" | "planner" | null;
  host: { name: string; phone: string; email: string } | null;
  planner: { name: string; phone: string; company: string } | null;
  requestedGuests: number | null;
  surprise?: { on: boolean; honoreeName: string } | null;
  privatePhone?: string;
}

const s = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** Split the booking answers off the submitted event. */
export function takeBookingAnswers(input: Record<string, unknown>): { answers: BookingAnswers; rest: Record<string, unknown> } {
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) if (!(BOOKING_ANSWER_FIELDS as readonly string[]).includes(k)) rest[k] = v;
  const r = input.booking_role;
  const role = r === "planner" ? "planner" : r === "someone_else" ? "someone_else" : r === "self" || r === "guest_of_honor" ? "self" : null;
  const hostName = s(input.host_name);
  const plannerPhone = s(input.planner_phone);
  const req = Number(input.requested_guest_count);
  const surprise = (role === "someone_else" || role === "planner") && typeof input.is_surprise === "boolean" ? { on: input.is_surprise, honoreeName: s(input.honoree_name) || hostName } : null;
  // Hosting for someone else: the person the event is for is saved by name only. A surprise host never gets a phone or email.
  const hostContact = role === "planner" && !surprise?.on;
  return {
    answers: {
      role,
      host: (role === "planner" || role === "someone_else") && hostName ? { name: hostName, phone: hostContact ? s(input.host_phone) : "", email: hostContact ? s(input.host_email) : "" } : null,
      planner: role !== "planner" && plannerPhone ? { name: s(input.planner_name), phone: plannerPhone, company: s(input.planner_company) } : null,
      requestedGuests: Number.isFinite(req) && req > 0 ? Math.round(req) : null,
      surprise,
      privatePhone: s(input.private_phone), // used only on a surprise event (the chat route checks)
    },
    rest,
  };
}

/** submit_event_data with the booking answer fields added. */
export function withBookingFields(tool: Anthropic.Tool): Anthropic.Tool {
  const schema = tool.input_schema as { properties?: Record<string, unknown> };
  return { ...tool, input_schema: { ...tool.input_schema, properties: { ...(schema.properties ?? {}), ...bookingAnswerProperties } } as Anthropic.Tool["input_schema"] };
}

/**
 * Saves the answers to the opening question and the surprise question the
 * moment they are given, so neither is ever asked again, even after a reload.
 */
export const savePlanningRoleTool: Anthropic.Tool = {
  name: "save_planning_role",
  description:
    "Save who is planning, the moment they answer. Call it right after they answer the opening question (with role, and host_name once you have it), right after they answer the surprise question (with is_surprise and honoree_name), and right after they give their private number (with private_phone). Send only what they just told you. In the same turn, write your reply and end it with the next planning question, so the client always has something to answer.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      role: { type: "string", enum: ROLE_ENUM, description: "guest_of_honor (also someone hosting their own event), someone_else (hosting for someone else, not a planner), or planner." },
      host_name: { type: "string", description: "The full name of the person the event is for, when it is not them." },
      is_surprise: { type: "boolean", description: 'The answer to "Is this a surprise for them?".' },
      honoree_name: { type: "string", description: "The guest of honor's name, when it is a surprise." },
      private_phone: { type: "string", description: "The best private number to reach them about this event." },
    },
  },
};

/**
 * The event types the concierge asks "Is this a surprise for them?" on. Add a
 * type here (with its short forms) to ask on it too. Matched loosely, ignoring
 * case, spaces, and punctuation: "Birthday Party", "40th birthday", and "bday"
 * all count as a birthday.
 */
export const SURPRISE_EVENT_TYPES: readonly { type: string; alsoCalled: readonly string[] }[] = [{ type: "birthday", alsoCalled: ["bday"] }];

const squash = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");

/** True when this event type gets the surprise question (see SURPRISE_EVENT_TYPES). */
export function isSurpriseEventType(eventType: unknown): boolean {
  const t = typeof eventType === "string" ? squash(eventType) : "";
  if (!t) return false;
  return SURPRISE_EVENT_TYPES.some((e) => [e.type, ...e.alsoCalled].some((w) => t.includes(squash(w))));
}

/** ask: a surprise type; skip: any other type; unknown: the booking does not say yet. */
export type SurpriseFit = "ask" | "skip" | "unknown";
export function surpriseFit(eventType: unknown): SurpriseFit {
  const t = typeof eventType === "string" ? eventType.trim() : "";
  if (!t) return "unknown";
  return isSurpriseEventType(t) ? "ask" : "skip";
}

/** "a birthday", or "a birthday or a graduation" once more types are added. */
function surpriseTypesWords(): string {
  return SURPRISE_EVENT_TYPES.map((e) => `a ${e.type}`).join(" or ");
}

export const ROLE_QUESTION = "Are you the guest of honor, hosting this for someone else, or a planner booking for a client?";
export const SURPRISE_QUESTION = "Is this a surprise for them?";
export const PRIVATE_NUMBER_QUESTION = "What is the best private number to reach you about this event?";

/**
 * Client chats: the opening question, once, right after the greeting and
 * before any event questions; for someone hosting for someone else or a
 * planner, one follow up right away about a surprise; then, for a client not
 * booking as a planner, once whether they are working with a planner.
 * askRole false once it is answered or the booking already tells us; role is
 * the saved answer when there is one; askSurprise false once answered.
 */
export function bookingQuestionsSection(o: {
  askRole: boolean;
  askPlanner: boolean;
  askSurprise?: boolean;
  role?: "guest_of_honor" | "someone_else" | "planner" | null;
  canSave?: boolean;
  eventType?: string | null;
  // Does this event have a guest of honor (lib/intake-plan.ts honoreeFit)? unknown: wait until they say what they are celebrating.
  roleFit?: "ask" | "unknown";
}): string {
  // Eligible: someone hosting for someone else or a planner (or not known yet), and not answered yet.
  const eligible = o.askSurprise ?? o.askRole;
  const fit = surpriseFit(o.eventType);
  if (!o.askRole && !o.askPlanner && !eligible) return "";
  const save = o.canSave ? " Call save_planning_role with" : " Remember";
  const lines: string[] = ["WHO IS PLANNING:"];
  if (o.askRole) {
    const honoree = HONOREE_EVENT_TYPES.map((e) => e.type).join(", ");
    const when =
      o.roleFit === "unknown"
        ? `Know what kind of event it is first: if you do not know yet, ask what they are celebrating (after the OPENING SUMMARY check, if there is one). Only if it is an event with a guest of honor (${honoree}) ask exactly: "${ROLE_QUESTION}" right after they tell you. For any other kind of event (a holiday party, a corporate event, a gathering with friends) never ask it and never call save_planning_role: just ask the working with a planner question once, later, as described below.`
        : `Right after your greeting (and after the OPENING SUMMARY check, if there is one), before any other event question, ask exactly: "${ROLE_QUESTION}"`;
    lines.push(
      `${when} Ask it only once in the whole chat, and never again once they answered.${save} role as soon as they answer, and in that same reply ask the next planning question.`,
      'If they are the guest of honor, or hosting their own event: role "guest_of_honor". Continue as usual, and send booking_role "guest_of_honor" in submit_event_data.',
      `If they are hosting for someone else and are not a planner: role "someone_else". Ask who the event is for (that person's full name) and nothing else about them: never ask for that person's phone or email.${o.canSave ? " Call save_planning_role with host_name." : ""} Send booking_role "someone_else" and host_name in submit_event_data.`,
      'If they are a planner: role "planner". Ask who the event is for (the host\'s full name). From then on speak to them as the planner and talk about the event as the host\'s event (for example "Jordan\'s wedding"). Send booking_role "planner" and host_name in submit_event_data. Do not ask the working with a planner question.'
    );
  }
  const yesSteps = `${o.canSave ? " call save_planning_role with is_surprise true and honoree_name," : ""} tell them we will never contact the guest of honor (by first name) about this event, then ask exactly: "${PRIVATE_NUMBER_QUESTION}"${o.canSave ? " Call save_planning_role with private_phone." : ""} Send is_surprise true, honoree_name, and private_phone in submit_event_data. Never ask for the guest of honor's phone or email, never offer them access, and never suggest anyone contact them.`;
  const plannerMayAsk = o.role === "planner" || o.askRole;
  const hostAccess = "ask once whether they would like the host to have access to view the plans, and if yes, the host's mobile number, sent as host_phone.";
  const volunteered = `If, on any kind of event, they tell you on their own that it is a surprise (and they are not the guest of honor):${yesSteps}`;
  if (eligible && fit !== "skip") {
    const only = 'Only for "someone_else" or "planner", and never for the guest of honor';
    const types = surpriseTypesWords();
    const who =
      fit === "unknown"
        ? `${only}. Never ask it before you know what kind of event it is. Wait until they have told you what kind of event it is; if it is ${types} (any ${SURPRISE_EVENT_TYPES[0].type}, for example a 40th ${SURPRISE_EVENT_TYPES[0].type} or a party for one), then, once you also have the name of the person the event is for, ask it at that point. For any other kind of event never ask it`
        : o.role === "someone_else"
          ? "Right after your greeting (they are hosting for someone else)"
          : o.role === "planner"
            ? "Right after your greeting (they are a planner booking for a client)"
            : `${only}: right after you have the name of the person the event is for`;
    lines.push(
      `SURPRISE: ${who}, ask exactly: "${SURPRISE_QUESTION}" Ask it only once, and never again once answered.${save} is_surprise as soon as they answer.`,
      `If yes:${yesSteps}`,
      `If no: send is_surprise false.${plannerMayAsk ? ` A planner who said no: then ${hostAccess}` : ""}`
    );
    if (fit === "unknown") {
      lines.push(volunteered);
      if (plannerMayAsk) lines.push(`A planner on any other kind of event (the surprise question is not asked): ${hostAccess} Skip this if they said it is a surprise.`);
    }
  } else if (eligible) {
    // Any other event type: never asked, but a surprise the client mentions is still saved.
    lines.push(`SURPRISE: this is not ${surpriseTypesWords()}, so never ask whether it is a surprise.`, volunteered);
    if (plannerMayAsk) lines.push(`A planner (unless they said it is a surprise): ${hostAccess}`);
    if (o.role === "planner") lines.push("They are a planner booking for a client. Speak to them as the planner, and do not ask the working with a planner question.");
  } else if (o.role === "planner") {
    lines.push("They are a planner booking for a client. Speak to them as the planner, and do not ask the working with a planner question.");
  }
  if (o.askPlanner) {
    lines.push(
      'For a client not booking as a planner: once, after the Phase 1 basics, ask: "Are you working with an event planner? If so, I can give them access to help with your bar planning." If yes, ask for the planner\'s name and mobile number (and company, if they want to share it), and send planner_name, planner_phone, and planner_company. If no, move on and never ask again.'
    );
  }
  lines.push("These answers never change any price and never replace a booked detail.");
  return lines.join("\n");
}

/** What save_planning_role hands back to the model. */
export function planningRoleToolResult(o: { saved: boolean; refused?: string }): string {
  if (o.refused) return `TOOL RESULT: NOT SAVED. Say exactly: "${o.refused}" Then ask for a different number.`;
  return o.saved
    ? "TOOL RESULT: SAVED. Never ask that question again. Continue with the next question."
    : "TOOL RESULT: Noted. Never ask that question again. Continue with the next question.";
}

/**
 * Two people in the planning chat at once (the client and a planner): each
 * sends back their own view of the chat plus their new turn. Keep every
 * stored turn as it is (with its author mark), and append only the turns in
 * incoming that are not already stored, in order. A turn is matched by role
 * and text; the turns after the shared start are matched in order, so a stale
 * view never duplicates a turn and never drops the other person's.
 */
export function mergeChatTurns<T extends TaggedMessage>(stored: T[] | null | undefined, incoming: T[]): T[] {
  const prev = Array.isArray(stored) ? stored : [];
  const same = (a: TaggedMessage, b: TaggedMessage) => a.role === b.role && a.content === b.content;
  let k = 0;
  while (k < prev.length && k < incoming.length && same(prev[k], incoming[k])) k++;
  const out = [...prev];
  let j = k;
  for (let i = k; i < incoming.length; i++) {
    let p = j;
    while (p < prev.length && !same(prev[p], incoming[i])) p++;
    if (p < prev.length) {
      j = p + 1; // already stored (sent back by a stale view)
      continue;
    }
    out.push(incoming[i]);
  }
  return out;
}

export interface PlannerChatContext {
  plannerName: string;
  eventFor: string; // the host's name, or the client's on a client held event
  eventType: string;
  holdsBooking: boolean; // the Lead on a planner held event: may accept price changes
  holderFirstName: string; // who approves price changes when they cannot
}

/** "Jordan's wedding" */
export function eventPhrase(c: Pick<PlannerChatContext, "eventFor" | "eventType">): string {
  const who = firstWord(c.eventFor);
  const type = c.eventType.toLowerCase() || "event";
  return who ? `${who}'s ${type}` : `this ${type}`;
}

const NO_MONEY = (c: PlannerChatContext) =>
  `MONEY: this planner does not hold the booking. Never state, estimate, or confirm any price, total, difference, deposit, balance, payment, or payment option, even one they mention, and never ask the payment question. Any change to the guest count, service times or hours, bartenders, or package can change the price and goes to ${c.holderFirstName} to approve.`;

/** Intake, a planner on the other end. Replaces the booking questions. */
export function plannerIntakeSection(c: PlannerChatContext): string {
  const lines = [
    `YOU ARE TALKING WITH A PLANNER: ${c.plannerName || "the planner"} is planning ${eventPhrase(c)} for their client. Address them by first name (${firstWord(c.plannerName) || "there"}), and speak about the event as ${eventPhrase(c)}, for example "You are planning ${eventPhrase(c)}." Do not ask whether they are planning for themselves, and do not ask whether they are working with a planner. Every answer they give counts exactly like the client's. Everything else in this prompt applies the same way: the package, the drink rules, the deadlines.`,
  ];
  if (!c.holdsBooking) {
    lines.push(
      NO_MONEY(c),
      `SKIP THE PAYMENT STEP entirely, and leave payment_preference empty. GUEST COUNT: if they want a guest count different from the booked one, keep the booked number in guest_count, send the number they asked for in requested_guest_count, and tell them: "That change affects the price, so I will send it to ${c.holderFirstName} to approve once your planning is in." Never call quote_guest_count.`
    );
  }
  return lines.join("\n");
}

/** Update mode, a planner on the other end. */
export function plannerUpdateSection(c: PlannerChatContext): string {
  const lines = [
    `YOU ARE TALKING WITH A PLANNER: ${c.plannerName || "the planner"} is planning ${eventPhrase(c)}. Address them by first name (${firstWord(c.plannerName) || "there"}) and speak about the event as ${eventPhrase(c)}. They can change the event under the same rules, deadlines, and package limits as the client. Wherever this prompt says "the client", it means the person you are talking with.`,
  ];
  if (!c.holdsBooking) {
    lines.push(
      NO_MONEY(c),
      `PRICE CHANGES FOR THIS PLANNER replace PRICE CHANGES above: confirm the change back in one yes or no question with NO price in it. When they say yes, call quote_price_change with the new values and write NO text. If the TOOL RESULT says it was sent for approval, say exactly what it tells you to say and nothing about money. If it says there is no change in price, call update_event_data with the change. Never call update_event_data with a change that was sent for approval. Never ask the payment question and never send payment_preference.`
    );
  }
  return lines.join("\n");
}

/** The tool result a planner who cannot approve gets back from quote_price_change. */
export function sentForApprovalToolResult(line: string): string {
  return `TOOL RESULT: SENT FOR APPROVAL, NOTHING SAVED. This change affects the price, and the person who holds the booking must approve it before anything changes. Say exactly: "${line}" Then ask if there is anything else they would like to change. Do not call update_event_data for this change, and say nothing about any amount.`;
}

export const APPROVAL_FAILED_TOOL_RESULT =
  "TOOL RESULT: NOTHING SAVED AND NOT SENT. This change affects the price and could not be sent for approval right now. Tell them honestly it did not go through and our team will follow up. Say nothing about any amount.";

