// The planning chat and update mode when a planner (or a client being asked
// about planners) is on the other end. Pure: prompt sections, the booking
// answers the concierge sends with submit_event_data, and the "who said it"
// marks on each message.

import type Anthropic from "@anthropic-ai/sdk";
import { firstWord } from "@/lib/partners/rules";

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
export const BOOKING_ANSWER_FIELDS = ["booking_role", "host_name", "host_phone", "host_email", "planner_name", "planner_phone", "planner_company", "requested_guest_count"] as const;

export const bookingAnswerProperties: Record<string, unknown> = {
  booking_role: { type: "string", enum: ["self", "planner"], description: 'The answer to "Are you planning this for yourself, or are you a planner booking for a client?". Only when you asked it.' },
  host_name: { type: "string", description: "A planner booking for a client: the full name of the person the event is for." },
  host_phone: { type: "string", description: "A planner booking for a client: the host's mobile number, only if the planner wants the host to have access." },
  host_email: { type: "string", description: "The host's email, only if the planner gave it." },
  planner_name: { type: "string", description: "A client planning for themselves who is working with a planner: the planner's name." },
  planner_phone: { type: "string", description: "That planner's mobile number." },
  planner_company: { type: "string", description: "That planner's company, if given." },
  requested_guest_count: { type: "number", description: "Only for a planner who cannot approve price changes: a guest count they asked for that differs from the booked one." },
};

export interface BookingAnswers {
  role: "self" | "planner" | null;
  host: { name: string; phone: string; email: string } | null;
  planner: { name: string; phone: string; company: string } | null;
  requestedGuests: number | null;
}

const s = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/** Split the booking answers off the submitted event. */
export function takeBookingAnswers(input: Record<string, unknown>): { answers: BookingAnswers; rest: Record<string, unknown> } {
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) if (!(BOOKING_ANSWER_FIELDS as readonly string[]).includes(k)) rest[k] = v;
  const role = input.booking_role === "planner" ? "planner" : input.booking_role === "self" ? "self" : null;
  const hostName = s(input.host_name);
  const plannerPhone = s(input.planner_phone);
  const req = Number(input.requested_guest_count);
  return {
    answers: {
      role,
      host: role === "planner" && hostName ? { name: hostName, phone: s(input.host_phone), email: s(input.host_email) } : null,
      planner: role !== "planner" && plannerPhone ? { name: s(input.planner_name), phone: plannerPhone, company: s(input.planner_company) } : null,
      requestedGuests: Number.isFinite(req) && req > 0 ? Math.round(req) : null,
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
 * Client chats: ask once, at the start, whether they are planning for
 * themselves or are a planner booking for a client; then, for a client
 * planning for themselves, ask once whether they are working with a planner.
 * askRole false when the event already has a planner holding it or linked.
 */
export function bookingQuestionsSection(o: { askRole: boolean; askPlanner: boolean }): string {
  if (!o.askRole && !o.askPlanner) return "";
  const lines: string[] = ["WHO IS PLANNING:"];
  if (o.askRole) {
    lines.push(
      'In your FIRST reply, right after your greeting, ask once, exactly: "Are you planning this for yourself, or are you a planner booking for a client?" Ask it only once in the whole chat.',
      'If they are a planner: ask who the event is for (the host\'s full name). Then ask once whether they would like the host to have access to view the plans, and if yes, the host\'s mobile number. From then on speak to them as the planner and talk about the event as the host\'s event (for example "Jordan\'s wedding"). Send booking_role "planner", host_name, and host_phone (only when given) in submit_event_data. Do not ask the working with a planner question.',
      'If they are planning for themselves: send booking_role "self".'
    );
  }
  if (o.askPlanner) {
    lines.push(
      'For a client planning for themselves: once, after the Phase 1 basics, ask: "Are you working with an event planner? If so, I can give them access to help with your bar planning." If yes, ask for the planner\'s name and mobile number (and company, if they want to share it), and send planner_name, planner_phone, and planner_company. If no, move on and never ask again.'
    );
  }
  lines.push("These answers never change any price and never replace a booked detail.");
  return lines.join("\n");
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

