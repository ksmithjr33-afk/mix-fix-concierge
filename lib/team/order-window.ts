// Order window: a pre event checklist item for each person on an event. Pure,
// no database (lib/team/order-window-db.ts has that).
//
// When someone accepts an event they are asked "When can you receive the
// order for this event?": Delivery or Pickup, then one or more windows (a day
// and a time range) on the days leading up to the event, and a short note. It
// is prefilled from the usual order windows on their profile
// (lib/team/delivery-availability.ts), so one tap confirms it. It stays open
// until answered and can be changed until the order is placed (any line on
// the order sheet marked ordered).
//
// Everyone on the event answers, whatever their role on it. Events where we
// buy nothing (the new Bartender Only: the client buys every line) skip it
// (buysNothing lives in the db module, so this file stays safe for the browser).
//
// Reminders: one text 24 hours after accepting if still open; one more when
// the event is within 5 days and it is still open (then it shows in red).
// Staff never see prices, costs, or supplier links here.

import { todayIn, TZ } from "@/lib/team/time";
import { DAY_KEYS, dayKeyOf, readWeek, type WeekWindows } from "@/lib/team/delivery-availability";

export const ITEM_TITLE = "Order window";
export const QUESTION = "When can you receive the order for this event?";
export const NEEDED_LABEL = "Order window needed";
export const PLACED_LINE = "The order has been placed, so this can no longer be changed here. Text the office if something changed.";

export const METHODS = ["delivery", "pickup"] as const;
export type Method = (typeof METHODS)[number];
export const METHOD_LABEL: Record<Method, string> = { delivery: "Delivery", pickup: "Pickup" };

export const NOTE_MAX = 120;
export const MAX_WINDOWS = 6;
/** Days offered before the event (plus the event day itself). */
export const DAYS_BEFORE = 7;
/** Days before the event the usual windows prefill. */
export const PREFILL_DAYS = 3;
/** Inside this many days of the event an open item is urgent: red, and the second reminder. */
export const URGENT_DAYS = 5;
export const FIRST_REMINDER_HOURS = 24;
/**
 * Events accepted before this item existed get it too; their 24 hour reminder
 * counts from here (midnight Central, Nov 25, 2026), so nobody is texted the
 * moment it ships.
 */
export const ITEM_START = "2026-11-25T06:00:00.000Z";

export interface Window {
  date: string; // YYYY-MM-DD
  from: number; // minutes after midnight
  to: number;
}

export interface Answer {
  method: Method;
  windows: Window[];
  note: string;
}

/** A saved row (event_order_windows). */
export interface OrderWindowRow {
  session_id: string;
  staff_id: string;
  method?: string | null;
  windows?: unknown;
  note?: string | null;
  answered_at?: string | null;
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** "Fri, Nov 27". */
export function dayLabel(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** "9a–5p". */
export function shortTime(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h % 12 === 0 ? 12 : h % 12}${mm ? `:${String(mm).padStart(2, "0")}` : ""}${h < 12 ? "a" : "p"}`;
}

export function windowLabel(w: Window): string {
  return `${dayLabel(w.date)} ${shortTime(w.from)}–${shortTime(w.to)}`;
}

/** "Delivery: Thu, Nov 26 9a–5p, Fri, Nov 27 10a–2p". */
export function answerSummary(a: Answer): string {
  return `${METHOD_LABEL[a.method]}: ${a.windows.map(windowLabel).join("; ")}`;
}

/** The days a window can be on: up to a week before the event through the event day, never before today. */
export function dayChoices(eventYmd: string | null, today: string): string[] {
  if (!eventYmd) return [];
  const out: string[] = [];
  for (let i = DAYS_BEFORE; i >= 0; i--) {
    const d = addDays(eventYmd, -i);
    if (d >= today) out.push(d);
  }
  return out;
}

function minutes(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isInteger(v) && v >= 0 && v <= 1440 ? v : null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(v).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  return h < 24 && mm < 60 ? h * 60 + mm : null;
}

/** A saved answer, read leniently. Null when it was never answered or is broken. */
export function readAnswer(row: OrderWindowRow | null | undefined): Answer | null {
  if (!row || !row.answered_at) return null;
  if (!(METHODS as readonly unknown[]).includes(row.method)) return null;
  const list = Array.isArray(row.windows) ? (row.windows as Record<string, unknown>[]) : [];
  const windows: Window[] = [];
  for (const w of list) {
    const from = minutes(w?.from);
    const to = minutes(w?.to);
    if (typeof w?.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(w.date) || from === null || to === null) continue;
    windows.push({ date: w.date, from, to });
  }
  if (windows.length === 0) return null;
  return { method: row.method as Method, windows, note: row.note ?? "" };
}

/** The form, checked. At least one window, each on an offered day with from before to. */
export function cleanAnswer(raw: Record<string, unknown>, days: string[]): { ok: true; value: Answer } | { ok: false; error: string } {
  if (!(METHODS as readonly unknown[]).includes(raw.method)) return { ok: false, error: "Choose Delivery or Pickup." };
  const list = Array.isArray(raw.windows) ? (raw.windows as Record<string, unknown>[]) : [];
  if (list.length === 0) return { ok: false, error: "Add at least one window." };
  if (list.length > MAX_WINDOWS) return { ok: false, error: `Up to ${MAX_WINDOWS} windows.` };
  const windows: Window[] = [];
  for (const w of list) {
    const date = typeof w?.date === "string" ? w.date : "";
    if (!days.includes(date)) return { ok: false, error: "Pick a day for each window, on or before the event." };
    const from = minutes(w.from);
    const to = minutes(w.to);
    if (from === null || to === null) return { ok: false, error: `${dayLabel(date)}: enter a from and a to time.` };
    if (from >= to) return { ok: false, error: `${dayLabel(date)}: the from time must be before the to time.` };
    windows.push({ date, from, to });
  }
  windows.sort((a, b) => (a.date === b.date ? a.from - b.from : a.date < b.date ? -1 : 1));
  const note = String(raw.note ?? "").replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
  return { ok: true, value: { method: raw.method as Method, windows, note } };
}

/**
 * The prefill from the usual order windows on the profile: the method from
 * their preference (or whichever kind they have times for), and their usual
 * times on the 3 days before the event that can still be picked.
 */
export function prefill(profile: { delivery_windows?: unknown; handoff_pref?: string | null } | null, eventYmd: string | null, today: string): Answer {
  const week: WeekWindows | null = readWeek(profile?.delivery_windows);
  const has = (k: "receive" | "pickup") => !!week && DAY_KEYS.some((d) => week[d][k].on);
  const pref = profile?.handoff_pref;
  const method: Method = pref === "pickup" ? "pickup" : pref === "delivery" ? "delivery" : has("receive") || !has("pickup") ? "delivery" : "pickup";
  return { method, windows: usualWindows(week, method, eventYmd, today), note: "" };
}

/** The usual windows for one method on the prefill days. */
export function usualWindows(week: WeekWindows | null, method: Method, eventYmd: string | null, today: string): Window[] {
  if (!week || !eventYmd) return [];
  const kind = method === "delivery" ? "receive" : "pickup";
  const days = dayChoices(eventYmd, today).filter((d) => d < eventYmd && d >= addDays(eventYmd, -PREFILL_DAYS));
  return days.flatMap((d) => {
    const w = week[dayKeyOf(d)][kind];
    return w.on && w.from !== null && w.to !== null ? [{ date: d, from: w.from, to: w.to }] : [];
  });
}

/** Days from today (Chicago) to the event: 0 on the day, negative after. Null without a date. */
export function daysUntil(eventYmd: string | null, now: Date): number | null {
  if (!eventYmd) return null;
  return daysBetween(todayIn(TZ, now), eventYmd);
}

/** Open and the event is within 5 days (and not past): red. */
export function urgent(eventYmd: string | null, now: Date): boolean {
  const d = daysUntil(eventYmd, now);
  return d !== null && d >= 0 && d <= URGENT_DAYS;
}

/** When the clock for the first reminder starts: accepting, or when the item shipped for older accepts. */
export function askedAt(respondedAt: string | null | undefined): number {
  const start = Date.parse(ITEM_START);
  const t = respondedAt ? Date.parse(respondedAt) : NaN;
  return Number.isNaN(t) ? start : Math.max(t, start);
}

export type ReminderKind = "first" | "urgent";

/**
 * Which reminder is due for an open item, if any. The first 24 hours after
 * accepting; the urgent one once the event is within 5 days, also no sooner
 * than 24 hours after accepting (when both are due, only the urgent one goes).
 * `sent` is what has already gone out.
 */
export function reminderDue(o: { respondedAt: string | null | undefined; eventYmd: string | null; now: Date; sent: { first: boolean; urgent: boolean } }): ReminderKind | null {
  const d = daysUntil(o.eventYmd, o.now);
  if (d === null || d < 0) return null;
  if (o.now.getTime() < askedAt(o.respondedAt) + FIRST_REMINDER_HOURS * 3_600_000) return null;
  if (d <= URGENT_DAYS && !o.sent.urgent) return "urgent";
  if (!o.sent.first && !o.sent.urgent) return "first";
  return null;
}

export const noticeKey = (kind: ReminderKind, sessionId: string, staffId: string) => `order_window:${kind}:${sessionId}:${staffId}`;

/** The reminder text. No client details, no prices. */
export function reminderText(o: { firstName: string; title: string; date: string; kind: ReminderKind; link: string }): string {
  const hi = o.firstName ? `${o.firstName}, ` : "";
  const when = o.date ? ` on ${o.date}` : "";
  return o.kind === "urgent"
    ? `The Mix Fix: ${hi}${o.title}${when} is coming up and we still need your order window, when you can receive the order. Please answer now: ${o.link}`
    : `The Mix Fix: ${hi}please tell us when you can receive the order for ${o.title}${when}. One tap if your usual times work: ${o.link}`;
}

