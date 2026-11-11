// Availability and time off. Pure, no database.
//
// A staff member marks single dates or date ranges as unavailable, with an
// optional note. Days are YYYY-MM-DD in the staff member's own market time
// zone. Past days cannot be added or changed: removing a range that already
// started keeps the days before today and drops the rest.

export const NOTE_MAX = 200;
export const MAX_RANGE_DAYS = 366;
export const MAX_AHEAD_DAYS = 730;

/** Status an admin gets back when an action needs a confirm step (the person is unavailable that day). */
export const NEEDS_CONFIRM = 428;

export interface UnavailRow {
  id: string;
  staff_id: string;
  start_day: string;
  end_day: string;
  note: string | null;
  created_at?: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function isDay(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** "Sat, Dec 12" */
export function shortDay(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "Sat, Dec 12" or "Sat, Dec 12 to Tue, Dec 15". */
export function rangeLabel(r: Pick<UnavailRow, "start_day" | "end_day">): string {
  return r.start_day === r.end_day ? shortDay(r.start_day) : `${shortDay(r.start_day)} to ${shortDay(r.end_day)}`;
}

export type UnavailInput = { start: string; end: string; note: string };

/** A new unavailable date or range, or why not. `today` is the staff member's today. */
export function validateUnavailable(raw: Record<string, unknown>, today: string): { ok: true; value: UnavailInput } | { ok: false; error: string } {
  const start = String(raw.start ?? "").trim();
  const end = String(raw.end ?? "").trim() || start;
  const note = String(raw.note ?? "").replace(/\s+/g, " ").trim();
  if (!isDay(start)) return { ok: false, error: "Pick a date." };
  if (!isDay(end)) return { ok: false, error: "Pick an end date." };
  if (end < start) return { ok: false, error: "The end date is before the start date." };
  if (start < today) return { ok: false, error: "Past dates cannot be changed. Pick today or later." };
  if (daysBetween(start, end) + 1 > MAX_RANGE_DAYS) return { ok: false, error: "Pick a range of a year or less." };
  if (daysBetween(today, start) > MAX_AHEAD_DAYS) return { ok: false, error: "Pick a date within the next two years." };
  if (note.length > NOTE_MAX) return { ok: false, error: `Keep the note under ${NOTE_MAX} characters.` };
  return { ok: true, value: { start, end, note } };
}

/** True when the row covers the day. */
export function covers(r: Pick<UnavailRow, "start_day" | "end_day">, day: string): boolean {
  return r.start_day <= day && day <= r.end_day;
}

/** True when the person marked the day unavailable. */
export function isUnavailableOn(rows: Pick<UnavailRow, "staff_id" | "start_day" | "end_day">[], staffId: string, day: string | null): boolean {
  if (!day) return false;
  return rows.some((r) => r.staff_id === staffId && covers(r, day));
}

/**
 * What removing a row does: "delete" a row that has not started, "trim" one
 * that started before today (it keeps the past days and ends yesterday), and
 * "past" for a row that is over, which cannot be changed.
 */
export function removalPlan(r: Pick<UnavailRow, "start_day" | "end_day">, today: string): { action: "delete" } | { action: "trim"; end: string } | { action: "past" } {
  if (r.end_day < today) return { action: "past" };
  if (r.start_day >= today) return { action: "delete" };
  return { action: "trim", end: addDays(today, -1) };
}

/** The admin confirm text: "Jordan marked themselves unavailable on Sat, Dec 12. Assign anyway?" */
export function unavailableConfirm(o: { name: string; day: string; verb: "Assign" | "Approve" }): string {
  return `${o.name || "This person"} marked themselves unavailable on ${shortDay(o.day)}. ${o.verb} anyway?`;
}

/** The bartender's warning when they mark a day they already accepted an event on. */
export function acceptedWarning(o: { title: string; day: string }): string {
  return `You are still on ${o.title} on ${shortDay(o.day)}. Marking the day unavailable does not take you off it. To give it up, open the event and use "Give up this shift".`;
}
