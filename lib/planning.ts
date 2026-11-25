// Bookings the client has not finished planning yet. Pure, no database.
//
// The booking webhook and Add event "Save and send link" create the session
// row the client fills in through the concierge. Until they finish, the row
// stays in_progress with no event_data. The team side shows it anyway: the
// event details are built here, in memory, from what the booking gave us, and
// never written back. When the client finishes, recordSubmission saves their
// answers on the same row (with the booking filling what they left blank), so
// there is never a second record and nothing the team set is touched
// (assignments, roles, needed counts, offers, market and hidden all live in
// their own columns and tables).
//
// Which unfinished bookings show: any whose event date is on or after the day
// this shipped (2026-11-25), and any booked from that day on. Older ones stay
// hidden, as before.

import { bookingFill, cityFallback, clean } from "@/lib/booking-webhook";
import { bookedGuestCount } from "@/lib/booked-facts";
import { withPricingModel } from "@/lib/bartender-only";
import { withHoursBooked } from "@/lib/price-change";
import { chicagoToday, eventDay, formatClock, longDate, parseClock } from "@/lib/team/time";

export const PLANNING_SINCE = "2026-11-25";
export { PLANNING_BANNER, PLANNING_EDIT_NOTE, PLANNING_PLACEHOLDER, PLANNING_TAG } from "@/lib/planning-text";
/** "Waiting on the client" is red when the event is this close and planning is still not finished. */
export const WAITING_RED_DAYS = 14;

// Any session shaped row: SessionRow, a joined row, or a partial select.
type Row = { id: string; status?: unknown };
const f = (s: Row) => s as unknown as Record<string, unknown>;

/** True for a booking the client has not finished planning. */
export function isPlanning(s: { status?: unknown } | null | undefined): boolean {
  return !!s && s.status === "in_progress";
}

/** "2026-11-25" from a created_at (UTC, with or without a zone suffix), or null. */
function utcDay(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}Z`);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** The day they booked: booked_on (events added by hand), else the day the row was made. */
export function bookedDay(s: Row): string | null {
  const r = f(s);
  const on = typeof r.booked_on === "string" && /^\d{4}-\d{2}-\d{2}/.test(r.booked_on) ? r.booked_on.slice(0, 10) : null;
  return on ?? utcDay(r.created_at);
}

/** Whole days from the day they booked to today (Central). Null without a booked day. */
export function daysSinceBooked(s: Row, now: Date = new Date()): number | null {
  const day = bookedDay(s);
  if (!day) return null;
  const a = Date.parse(`${day}T00:00:00Z`);
  const b = Date.parse(`${chicagoToday(now)}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/** "Booked today", "Booked 1 day ago", "Booked 6 days ago". Empty without a booked day. */
export function bookedAgoText(s: Row, now: Date = new Date()): string {
  const n = daysSinceBooked(s, now);
  if (n === null) return "";
  return n === 0 ? "Booked today" : `Booked ${n} day${n === 1 ? "" : "s"} ago`;
}

/** Shown on the team side: every submitted event, and unfinished bookings dated or booked from PLANNING_SINCE on. */
export function showsOnTeam(s: Row): boolean {
  if (s.status === "submitted") return true;
  if (!isPlanning(s)) return false;
  const day = eventDay(f(s).event_date);
  if (day && day >= PLANNING_SINCE) return true;
  const booked = utcDay(f(s).created_at);
  return !!booked && booked >= PLANNING_SINCE;
}

/**
 * The event details as far as the booking knows them, in the shape the
 * concierge saves: client name, email and phone, the date, type and name, the
 * start and end time, hours, guests (a range is its higher end), package,
 * bartenders, the city, and the pricing model. No address, no drinks.
 */
export function planningEventData(row: Row): Record<string, unknown> {
  const s = f(row);
  const base: Record<string, unknown> = {};
  const set = (k: string, v: unknown) => {
    const c = clean(v);
    if (c !== null) base[k] = c;
  };
  set("client_name", s.name);
  set("email", s.email);
  set("event_date", s.event_date);
  set("event_name", s.event_name);
  set("package", s.package_type);
  const guests = bookedGuestCount(s.guest_count);
  if (guests !== null) base.guest_count = guests;
  const city = cityFallback(s);
  if (city) base.event_city = city;
  const filled = { ...base, ...bookingFill(base, s) };
  return withPricingModel(withHoursBooked(filled, { hours_booked: (s.hours_booked as string | null) ?? null }), s as { pricing_model?: unknown });
}

/**
 * The row the team side reads: a submitted row as it is, an unfinished one
 * with event_data built from the booking. The built data is never saved.
 */
export function asTeamRow<T extends Row>(s: T): T {
  if (!isPlanning(s)) return s;
  return { ...s, event_data: planningEventData(s) } as T;
}

export interface WaitingOnClient {
  sessionId: string;
  name: string;
  eventDay: string | null;
  daysSinceBooked: number | null;
  red: boolean; // the event is within 14 days and planning is still not finished
}

/** "Waiting on the client": upcoming unfinished bookings, soonest event first. Hidden events left out. */
export function waitingOnClient(rows: Row[], hidden: Set<string>, now: Date = new Date()): WaitingOnClient[] {
  const today = chicagoToday(now);
  const redBy = new Date(Date.parse(`${today}T00:00:00Z`) + WAITING_RED_DAYS * 86_400_000).toISOString().slice(0, 10);
  return rows
    .filter((s) => isPlanning(s) && showsOnTeam(s) && !hidden.has(s.id))
    .map((s) => {
      const day = eventDay(f(s).event_date);
      return { s, day };
    })
    .filter(({ day }) => !day || day >= today)
    .map(({ s, day }) => ({
      sessionId: s.id,
      name: clean(f(s).name) ?? clean(f(s).email) ?? "Unknown client",
      eventDay: day,
      daysSinceBooked: daysSinceBooked(s, now),
      red: !!day && day <= redBy,
    }))
    .sort((a, b) => (a.eventDay ?? "9999").localeCompare(b.eventDay ?? "9999"));
}

export interface FinishChange {
  date: string | null; // "Saturday, December 12, 2026" when the date moved
  start: string | null; // "7:00 PM" when the start time moved
}

/**
 * What the client changed at finish against the booking: the date, or the
 * start time. Only when the booking had one and the saved answer differs.
 */
export function finishChanges(row: Row, saved: Record<string, unknown>): FinishChange {
  const booked = f(row);
  const bookedDayStr = eventDay(booked.event_date);
  const savedDay = eventDay(saved.event_date);
  const date = bookedDayStr && savedDay && bookedDayStr !== savedDay ? longDate(savedDay) || savedDay : null;
  const bookedStart = parseClock(clean(booked.bar_service_start));
  const savedStart = parseClock(clean(saved.bar_service_start));
  const start = bookedStart !== null && savedStart !== null && bookedStart !== savedStart ? formatClock(savedStart) : null;
  return { date, start };
}

/** The one text to assigned staff when the client finishes. */
export function detailsInText(title: string, change: FinishChange, link: string): string {
  const parts = [`Details are in for ${title}.`];
  if (change.date) parts.push(`The date changed to ${change.date}.`);
  if (change.start) parts.push(`The start time changed to ${change.start}.`);
  if (change.date || change.start) parts.push("Please open the event and confirm you can still work it.");
  parts.push(link);
  return parts.join(" ");
}

/** The text to admins and managers when the client finished with a different date or start time. */
export function finishChangeAdminText(title: string, change: FinishChange, link: string): string {
  const what = [change.date ? `the date to ${change.date}` : "", change.start ? `the start time to ${change.start}` : ""].filter(Boolean).join(" and ");
  return `The client finished planning ${title} and changed ${what}. Assigned staff were asked to confirm they can still work it. Nobody was removed. ${link}`;
}
