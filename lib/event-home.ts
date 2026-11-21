// The client's home for their event (app/s), and the same sections on the
// planner's event page: the countdown and status line, "What we need from
// you", the day in plain words, the bar team, the shopping list's timing,
// payment, the agreement, and pending requests. Pure, no database, safe in the
// browser: the checklist is worked out again in the browser after every saved
// change. lib/event-home-db.ts gathers the facts for one viewer.
//
// Never here: team notes, costs, staff pay, staff ratings, supplier details, a
// last name, or a phone number of anyone on the team.

import { formatClock, longDate, eventSchedule } from "@/lib/team/time";
import { isBlank } from "@/lib/blank";
import type { ClientAsks } from "@/lib/team-notes";
import { knownBalance, totalOnFile, type Recorded } from "@/lib/balance";
import { DRINKS_UNFINISHED_LINE, FINISH_DRINKS_BUTTON, FINISH_DRINKS_MESSAGE, extraDrinkQuestion } from "@/lib/team-notes";

type EventData = Record<string, unknown>;

export const HELP_LINE = "Text us 469 754 8512";
export const ASK_BUTTON = "Change something or ask a question";
export const TEAM_LATER = "Your team will be listed here closer to your event.";
export const GUEST_CONFIRMED_FIELD = "guest_count_confirmed";

const str = (v: unknown) => (typeof v === "string" && !isBlank(v) ? v.trim() : typeof v === "number" ? String(v) : "");
const money = (n: number) => `$${(Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** What one viewer may see of the money: the client on their own booking sees it all; a planner follows "Planner can see pricing". */
export interface HomeMoney {
  total: boolean;
  balance: boolean;
  payments: boolean;
  agreement: boolean;
}
export const ALL_MONEY: HomeMoney = { total: true, balance: true, payments: true, agreement: true };
export const NO_MONEY: HomeMoney = { total: false, balance: false, payments: false, agreement: false };

// ----- Top -----

/** "21 days to go", "Tomorrow", "Today", or "" once it has passed. */
export function countdown(daysUntil: number | null): string {
  if (daysUntil === null) return "";
  if (daysUntil < 0) return "";
  if (daysUntil === 0) return "Today";
  if (daysUntil === 1) return "Tomorrow";
  return `${daysUntil} days to go`;
}

/** The one status line under the countdown. */
export function statusLine(left: number, daysUntil: number | null): string {
  if (daysUntil !== null && daysUntil < 0) return "Thank you for celebrating with us.";
  if (left === 0) return "You are all set.";
  return left === 1 ? "1 thing left to do" : `${left} things left to do`;
}

/** The event's title for the top of the page: its own name, else its type, else "Your event". */
export function homeTitle(ed: EventData): string {
  return str(ed.event_name) || str(ed.event_type) || "Your event";
}

// ----- What we need from you -----

export type TodoAction =
  | { kind: "chat"; button: string; message: string }
  | { kind: "extra_drink" }
  | { kind: "confirm_guests"; button: string; count: string; changeMessage: string };

export interface TodoItem {
  key: "drinks" | "extra_drink" | "day_of_contact" | "guest_count" | "balance";
  label: string; // written to the client
  done: boolean;
  action: TodoAction | null; // null once done
}

/** Facts the checklist needs beyond the event itself. */
export interface TodoFacts {
  asks: ClientAsks | null;
  balance: { amount: number; due: string } | null; // only when payments have been recorded and the viewer may see the balance
  past: boolean;
}

const DRINKS_ON_PACKAGE = (ed: EventData) => {
  const p = String(ed.package ?? "").toLowerCase();
  if (/beer\s*(and|&)\s*wine/.test(p) && !/full|premium|essentials|tailored|bartender/.test(p)) return false;
  if (p.includes("dive") && ed.dive_menu_card !== true) return false; // the set menu: nothing to pick
  return true;
};

/** The final guest count the client confirmed, when it is still the count on file. */
export function guestCountConfirmed(ed: EventData): boolean {
  const c = ed[GUEST_CONFIRMED_FIELD] as { count?: unknown } | undefined;
  return !!c && str(c.count) !== "" && str(c.count) === str(ed.guest_count);
}

/** Built only from what is actually missing. Finished items stay, marked done. */
export function buildTodo(ed: EventData, f: TodoFacts): TodoItem[] {
  if (f.past) return [];
  const items: TodoItem[] = [];
  if (DRINKS_ON_PACKAGE(ed)) {
    const unfinished = f.asks?.drinksUnfinished === true;
    items.push({
      key: "drinks",
      label: unfinished ? DRINKS_UNFINISHED_LINE : "Your drink menu is finished.",
      done: !unfinished,
      action: unfinished ? { kind: "chat", button: FINISH_DRINKS_BUTTON, message: FINISH_DRINKS_MESSAGE } : null,
    });
  }
  if (f.asks && f.asks.extraDrinks.length > 0) {
    items.push({ key: "extra_drink", label: extraDrinkQuestion(f.asks), done: false, action: { kind: "extra_drink" } });
  }
  const contact = str(ed.day_of_contact_name) && str(ed.day_of_contact_phone);
  items.push({
    key: "day_of_contact",
    label: contact ? `Day of contact: ${str(ed.day_of_contact_name)}.` : "Give us a day of contact: who our team can call on the day.",
    done: !!contact,
    action: contact ? null : { kind: "chat", button: "Add a day of contact", message: "I would like to add a day of contact." },
  });
  const count = str(ed.guest_count);
  if (count) {
    const confirmed = guestCountConfirmed(ed);
    items.push({
      key: "guest_count",
      label: confirmed ? `Final guest count confirmed: ${count}.` : `Confirm your final guest count: ${count} guests.`,
      done: confirmed,
      action: confirmed ? null : { kind: "confirm_guests", button: `Yes, ${count} is final`, count, changeMessage: "I would like to change my guest count." },
    });
  }
  if (f.balance) {
    const paid = f.balance.amount <= 0;
    items.push({
      key: "balance",
      label: paid ? "Your balance is paid." : `Pay your balance of ${money(f.balance.amount)}${f.balance.due ? ` by ${f.balance.due}` : ""}.`,
      done: paid,
      action: paid ? null : { kind: "chat", button: "Ask about paying", message: "I have a question about paying my balance." },
    });
  }
  return items;
}

export const leftToDo = (items: TodoItem[]) => items.filter((i) => !i.done).length;

// ----- Your day -----

export interface DayLine {
  label: string;
  value: string;
}

/** The timeline in plain words: when the team arrives, bar service, when breakdown finishes. */
export function dayLines(ed: EventData): DayLine[] {
  const s = eventSchedule(ed);
  const out: DayLine[] = [];
  if (s.arrivalMin !== null) out.push({ label: "Our team arrives to set up", value: formatClock(s.arrivalMin) });
  if (s.startMin !== null) out.push({ label: "Bar service starts", value: formatClock(s.startMin) });
  if (s.endMin !== null) out.push({ label: "Bar service ends", value: formatClock(s.endMin) });
  if (s.endMin !== null) out.push({ label: "Breakdown finishes", value: `around ${formatClock(s.endMin + 60)}` });
  return out;
}

// ----- Payment -----

export interface PaymentView {
  total: string; // the booked total, when this viewer may see it and it is on file (never while a new price is being confirmed)
  due: string; // "Saturday, November 27, 2026"
  paid: string; // only when payments have been recorded
  balance: string; // only when payments have been recorded and the total is known
  preference: string; // how they chose to pay
}

/** The balance is due two weeks before the event. */
export function balanceDue(eventDay: string | null): string {
  if (!eventDay) return "";
  const [y, m, d] = eventDay.split("-").map(Number);
  const due = new Date(Date.UTC(y, m - 1, d - 14));
  return longDate(due.toISOString().slice(0, 10));
}

/**
 * Only what we know, and never an invitation to text: the booked total when it
 * is on file, the due date, paid and balance only when payments have been
 * recorded, and how they chose to pay. Never guessed from the deposit or
 * computed again. Null when there is nothing to show, so the section is left out.
 */
export function paymentView(o: {
  money: HomeMoney;
  total: number | null; // the booked total on file (lib/balance.ts totalOnFile), null when none
  pricePending: boolean;
  eventDay: string | null;
  recorded: Recorded | null; // what has been recorded as paid (lib/balance.ts), never the assumed deposit
  preference: unknown;
}): PaymentView | null {
  if (!o.money.total && !o.money.balance) return null;
  const total = o.money.total ? totalOnFile({ total: o.total }, o.pricePending) : null;
  const rec = o.money.balance && o.recorded?.any ? o.recorded : null;
  const balance = knownBalance(total, rec);
  const view: PaymentView = {
    total: total !== null ? money(total) : "",
    due: balanceDue(o.eventDay),
    paid: rec ? money(rec.cents / 100) : "",
    balance: balance !== null ? money(balance) : "",
    preference: o.money.balance ? str(o.preference) : "",
  };
  return Object.values(view).some(Boolean) ? view : null;
}

/** The balance for the checklist: only when it is known (lib/balance.ts) and the viewer may see it. */
export function balanceFact(p: PaymentView | null, total: number | null, recorded: Recorded | null, eventDay: string | null): TodoFacts["balance"] {
  if (!p || !p.balance) return null;
  const amount = knownBalance(totalOnFile({ total }), recorded);
  return amount === null ? null : { amount, due: balanceDue(eventDay) };
}

// ----- Bar team -----

export interface TeamMember {
  name: string; // first name only
  role: string; // "Bartender", "Bar back", "Event helper", or "" when we cannot tell
}

// ----- Shopping list -----

export type ListTiming = "ready" | "review" | "later";

export function listLine(t: ListTiming): string {
  if (t === "review") return "We are checking the recipes you gave us. Your shopping list will be here as soon as that is done.";
  if (t === "later") return "Your shopping list will be here once our team sends it to you.";
  return "";
}

// ----- Pending requests -----

export interface PendingRequest {
  summary: string;
  status: string; // "Waiting for our team's approval", "Approved", "Not approved", "A manager will reach out"
  when: string;
}

export const REQUEST_STATUS = {
  pending: "Waiting for our team's approval",
  approved: "Approved",
  declined: "Not approved",
  manager: "A manager will reach out",
  price: "Saved. Our team is confirming the price",
} as const;
