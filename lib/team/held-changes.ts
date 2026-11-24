// Admin edits held from the team: the rules, no database.
//
// When an admin or manager edits event details, the edit saves right away
// (event_updates, GHL, lists) but staff are not texted. The changes collect
// as "changes not sent to the team" until someone presses Notify the team
// (one text listing all of them) or Do not notify. Client changes keep
// texting staff as they always have.
//
// Safety net: if changes sit unsent for 2 hours, or the event is within 48
// hours (after a short grace so the editor can press the button themselves),
// the admin or manager who made them gets one reminder with a link to the
// event. Staff are never texted automatically.

import type { FieldChange } from "@/lib/event-diff";
import { consolidateChanges, recapLines } from "@/lib/event-diff";
import { scrub, staffChange } from "@/lib/team/event-view";

export const HOLD_REMIND_AFTER_MS = 2 * 3_600_000;
export const NEAR_EVENT_MS = 48 * 3_600_000;
export const NEAR_EVENT_GRACE_MS = 15 * 60_000;
export const MAX_LINES = 8;

/** The date, service times, and the address: the bar turns red and says so. */
export const TIME_PLACE_FIELDS = new Set(["event_date", "bar_service_start", "bar_service_end", "hours_booked", "event_address"]);
export const TIME_PLACE_LINE = "The team has not been told about a time or location change.";

export interface HeldRow {
  id: string;
  session_id: string;
  created_at: string;
  changes: FieldChange[];
  applied?: boolean;
  staff_notice?: string | null;
  updated_by_staff_id?: string | null;
  updated_by_name?: string | null;
  held_reminded_at?: string | null;
}

/** Only fields staff can see are held; an edit to nothing staff see is never held. */
export function staffVisible(changes: FieldChange[]): FieldChange[] {
  return (changes ?? []).filter((c) => staffChange(c.field));
}

export interface HeldSummary {
  count: number; // distinct fields changed, after merging repeat edits of one field
  timePlace: boolean;
  lines: string[]; // "Guest count: from 100 to 120", scrubbed (no numbers, emails, or prices)
  rowIds: string[];
  editors: string[]; // first names
}

/** What the bar shows and the one text lists. Repeat edits of one field count once, oldest to newest value. */
export function summarize(rows: HeldRow[]): HeldSummary {
  const ordered = [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const all = ordered.flatMap((r) => staffVisible(r.changes));
  const merged = consolidateChanges(all);
  return {
    count: merged.length,
    timePlace: merged.some((c) => TIME_PLACE_FIELDS.has(c.field)),
    lines: recapLines(merged, { team: true }).map(scrub).filter(Boolean),
    rowIds: ordered.map((r) => r.id),
    editors: [...new Set(ordered.map((r) => r.updated_by_name ?? "").filter(Boolean))],
  };
}

/** "3 changes not sent to the team". */
export function barText(count: number): string {
  return `${count} ${count === 1 ? "change" : "changes"} not sent to the team`;
}

/** The one text to the team, listing every change. No client contact details, no prices. */
export function teamText(o: { date: string; lines: string[]; link: string }): string {
  const shown = o.lines.slice(0, MAX_LINES);
  const more = o.lines.length - shown.length;
  const list = shown.join("; ") + (more > 0 ? `; and ${more} more` : "");
  return `Your event on ${o.date} was updated: ${list}. Check your event page: ${o.link}`;
}

/** Whether the editor's held rows are due a reminder now. Never twice for the same rows. */
export function reminderDue(rows: HeldRow[], now: Date, eventStart: Date | null): boolean {
  const open = rows.filter((r) => !r.held_reminded_at);
  if (open.length === 0) return false;
  const oldest = Math.min(...open.map((r) => new Date(r.created_at).getTime()));
  const waited = now.getTime() - oldest;
  if (waited >= HOLD_REMIND_AFTER_MS) return true;
  const near = eventStart !== null && eventStart.getTime() - now.getTime() <= NEAR_EVENT_MS && eventStart.getTime() > now.getTime();
  return near && waited >= NEAR_EVENT_GRACE_MS;
}

/** The reminder to the admin or manager who made the changes. */
export function reminderText(o: { firstName: string; count: number; title: string; date: string; timePlace: boolean; link: string }): string {
  const hi = o.firstName ? `${o.firstName}, ` : "";
  const tp = o.timePlace ? " They include a time or location change." : "";
  return `${hi}${barText(o.count)} for ${o.title}, ${o.date}.${tp} Open the event to Notify the team or choose Do not notify: ${o.link}`;
}
