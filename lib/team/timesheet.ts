// Timesheets: one row per staff member per event, admin corrections with a
// reason, approvals that lock a row, and the CSV export. Nobody edits or
// approves their own time, admins included. Pure, no database.

import { canChangeTime, workedMinutes, type PunchFlag, type PunchType } from "@/lib/team/clock";
import { TZ, zonedInstant, zoneShort } from "@/lib/team/time";

export const OWN_EDIT_MESSAGE = "You cannot edit your own time. Ask another admin to make this change.";
export const OWN_APPROVE_MESSAGE = "You cannot approve your own time. Ask another admin to approve it.";
export const OWN_REOPEN_MESSAGE = "You cannot reopen your own time. Ask another admin to reopen it.";
export const LOCKED_MESSAGE = "This row is approved and locked. Reopen it to make changes.";
export const MIN_REASON = 3;

// ----- Weeks (Monday to Sunday, America/Chicago dates) -----

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function isYmd(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** The Monday of the week holding `ymd`. */
export function weekStart(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 is Sunday
  return addDays(ymd, dow === 0 ? -6 : 1 - dow);
}

export function weekRange(anyDay: string): { from: string; to: string; prev: string; next: string } {
  const from = weekStart(anyDay);
  return { from, to: addDays(from, 6), prev: addDays(from, -7), next: addDays(from, 7) };
}

/** "Nov 9 to Nov 15, 2026". */
export function weekLabel(from: string, to: string): string {
  const fmt = (ymd: string, year: boolean) => {
    const [y, m, d] = ymd.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}) });
  };
  return `${fmt(from, false)} to ${fmt(to, true)}`;
}

// ----- Rows -----

export interface PunchSummary {
  id: string;
  at: string; // ISO
  flags: PunchFlag[];
  source: "phone" | "admin";
}

export interface EditSummary {
  type: PunchType;
  action: "add" | "correct";
  oldAt: string | null;
  newAt: string;
  reason: string;
  byName: string;
  at: string;
}

export interface ReopenSummary {
  reason: string;
  byName: string;
  at: string;
  approvedByName: string; // the approval it undid
  approvedAt: string;
}

export interface TimesheetRow {
  assignmentId: string;
  staffId: string;
  staffName: string;
  staffPhone: string;
  sessionId: string;
  timeZone: string; // the event's market time zone: punches show and edit in it
  eventTitle: string;
  eventDay: string | null; // YYYY-MM-DD
  scheduledStart: string; // "6:00 PM", or ""
  scheduledEnd: string;
  clockIn: PunchSummary | null;
  clockOut: PunchSummary | null;
  minutes: number | null; // null until both punches exist
  flags: PunchFlag[]; // every flag on either punch
  edits: EditSummary[];
  editedByAdmin: boolean;
  reopens: ReopenSummary[];
  approved: { byName: string; at: string } | null;
}

export function rowMinutes(clockIn: PunchSummary | null, clockOut: PunchSummary | null): number | null {
  return clockIn && clockOut ? workedMinutes(clockIn.at, clockOut.at) : null;
}

/** Each staff member's total minutes for the rows given, largest first. */
export function staffTotals(rows: TimesheetRow[]): { staffId: string; staffName: string; minutes: number; rows: number; open: number }[] {
  const by = new Map<string, { staffId: string; staffName: string; minutes: number; rows: number; open: number }>();
  for (const r of rows) {
    const t = by.get(r.staffId) ?? { staffId: r.staffId, staffName: r.staffName, minutes: 0, rows: 0, open: 0 };
    t.minutes += r.minutes ?? 0;
    t.rows += 1;
    if (r.minutes === null) t.open += 1;
    by.set(r.staffId, t);
  }
  return [...by.values()].sort((a, b) => b.minutes - a.minutes || a.staffName.localeCompare(b.staffName));
}

// ----- Edits and approvals -----

/** "2026-12-12T17:05" from a datetime-local input, read as a wall clock in `tz` (the event's time zone). */
export function parseLocal(v: unknown, tz: string = TZ): Date | null {
  const m = String(v ?? "").match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!m || !isYmd(m[1])) return null;
  const h = Number(m[2]);
  const min = Number(m[3]);
  if (h > 23 || min > 59) return null;
  return zonedInstant(m[1], h * 60 + min, tz);
}

export function parseChicagoLocal(v: unknown): Date | null {
  return parseLocal(v, TZ);
}

/** An instant as "2026-12-12T17:05" for a datetime-local input, in `tz`. */
export function toLocal(iso: string | null | undefined, tz: string = TZ): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function toChicagoLocal(iso: string | null | undefined): string {
  return toLocal(iso, TZ);
}

export type Check = { ok: true } | { ok: false; error: string };

export interface EditRequest {
  type: PunchType;
  at: Date | null;
  reason: string;
}

/**
 * An admin adding a missing punch or correcting one. Needs a reason, never on
 * your own time, never on an approved row, and in stays before out.
 */
export function checkEdit(actorId: string, row: Pick<TimesheetRow, "staffId" | "approved" | "clockIn" | "clockOut">, req: EditRequest, now: Date = new Date()): Check {
  if (!canChangeTime(actorId, row.staffId)) return { ok: false, error: OWN_EDIT_MESSAGE };
  if (row.approved) return { ok: false, error: LOCKED_MESSAGE };
  if (req.reason.trim().length < MIN_REASON) return { ok: false, error: "Give a reason for the change." };
  if (!req.at) return { ok: false, error: "Enter a valid date and time." };
  if (req.at.getTime() > now.getTime() + 5 * 60_000) return { ok: false, error: "That time is in the future." };
  const otherIn = req.type === "out" ? row.clockIn : null;
  const otherOut = req.type === "in" ? row.clockOut : null;
  if (otherIn && req.at.getTime() <= new Date(otherIn.at).getTime()) return { ok: false, error: "Clock out has to be after clock in." };
  if (otherOut && req.at.getTime() >= new Date(otherOut.at).getTime()) return { ok: false, error: "Clock in has to be before clock out." };
  return { ok: true };
}

/** Approving a row: never your own, only once, and only with both punches in. */
export function checkApprove(actorId: string, row: Pick<TimesheetRow, "staffId" | "approved" | "clockIn" | "clockOut">): Check {
  if (!canChangeTime(actorId, row.staffId)) return { ok: false, error: OWN_APPROVE_MESSAGE };
  if (row.approved) return { ok: false, error: "This row is already approved." };
  if (!row.clockIn || !row.clockOut) return { ok: false, error: "Add the missing clock in or clock out before approving." };
  return { ok: true };
}

/** Reopening an approved row: never your own, only when approved, and with a reason. */
export function checkReopen(actorId: string, row: Pick<TimesheetRow, "staffId" | "approved">, reason: string): Check {
  if (!canChangeTime(actorId, row.staffId)) return { ok: false, error: OWN_REOPEN_MESSAGE };
  if (!row.approved) return { ok: false, error: "This row is not approved." };
  if (reason.trim().length < MIN_REASON) return { ok: false, error: "Give a reason for reopening." };
  return { ok: true };
}

/** Edits and reopens in one list, oldest first, for the row's history. */
export function rowHistory(row: Pick<TimesheetRow, "edits" | "reopens">): ({ kind: "edit"; at: string; edit: EditSummary } | { kind: "reopen"; at: string; reopen: ReopenSummary })[] {
  return [
    ...row.edits.map((edit) => ({ kind: "edit" as const, at: edit.at, edit })),
    ...row.reopens.map((reopen) => ({ kind: "reopen" as const, at: reopen.at, reopen })),
  ].sort((a, b) => a.at.localeCompare(b.at));
}

/** Approve a whole week: every row that passes checkApprove. The rest are listed with why. */
export function weekApproval(actorId: string, rows: TimesheetRow[]): { approve: string[]; skipped: { assignmentId: string; reason: string }[] } {
  const approve: string[] = [];
  const skipped: { assignmentId: string; reason: string }[] = [];
  for (const r of rows) {
    if (r.approved) continue;
    const c = checkApprove(actorId, r);
    if (c.ok) approve.push(r.assignmentId);
    else skipped.push({ assignmentId: r.assignmentId, reason: c.error });
  }
  return { approve, skipped };
}

/** The database check constraints use these names. A hit means someone tried their own time. */
export function ownTimeConstraint(message: string): "edit" | "approve" | "reopen" | null {
  if (/time_edits_not_own|time_punches_own_or_admin/.test(message)) return "edit";
  if (/time_approvals_not_own/.test(message)) return "approve";
  if (/time_reopens_not_own/.test(message)) return "reopen";
  return null;
}

// ----- CSV -----

export const CSV_COLUMNS = [
  "Staff name",
  "Staff phone",
  "Event date",
  "Event name",
  "Scheduled start",
  "Scheduled end",
  "Clock in",
  "Clock out",
  "Hours",
  "Flags",
  "Edited by admin",
  "Approved by",
  "Time zone",
  "Hourly rate",
  "Pay (hours x rate)",
] as const;

/** One CSV cell. Quoted when needed, and text that a spreadsheet would run as a formula is made plain. */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** "2026-12-12 5:02 PM" in the event's time zone (Chicago by default). */
export function csvTime(iso: string | null | undefined, tz: string = TZ): string {
  if (!iso) return "";
  const local = toLocal(iso, tz);
  if (!local) return "";
  const [day, hm] = local.split("T");
  const [h, m] = hm.split(":").map(Number);
  return `${day} ${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** Minutes as decimal hours, two places: 330 as "5.50". Blank until both punches exist. */
export function csvHours(minutes: number | null): string {
  return minutes === null ? "" : (minutes / 60).toFixed(2);
}

/** "+12145550101" as "(214) 555-0101", so a spreadsheet keeps it as text. Anything else as given. */
export function csvPhone(phone: string): string {
  const m = phone.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : phone;
}

export const FLAG_CSV: Record<string, string> = {
  no_location: "no location",
  far: "away from event",
  no_event_location: "event not on map",
  sent_late: "sent late",
  admin_entry: "added by admin",
  edited: "corrected by admin",
};

/** Admin CSV. `rates` is hourly cents by staff id; blank columns for anyone without a rate. */
export function timesheetCsv(rows: TimesheetRow[], rates: Map<string, number> = new Map()): string {
  const lines = [CSV_COLUMNS.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.staffName,
        csvPhone(r.staffPhone),
        r.eventDay ?? "",
        r.eventTitle,
        r.scheduledStart,
        r.scheduledEnd,
        csvTime(r.clockIn?.at, r.timeZone),
        csvTime(r.clockOut?.at, r.timeZone),
        csvHours(r.minutes),
        r.flags.map((f) => FLAG_CSV[f] ?? f).join("; "),
        r.editedByAdmin ? "Yes" : "No",
        r.approved?.byName ?? "",
        zoneShort(r.timeZone || TZ),
        rates.get(r.staffId) ? (rates.get(r.staffId)! / 100).toFixed(2) : "",
        rates.get(r.staffId) && r.minutes !== null ? ((rates.get(r.staffId)! * r.minutes) / 6000).toFixed(2) : "",
      ]
        .map(csvCell)
        .join(",")
    );
  }
  return lines.join("\r\n") + "\r\n";
}

/** Rows in event date order, then staff name. */
export function sortRows(rows: TimesheetRow[]): TimesheetRow[] {
  return [...rows].sort(
    (a, b) => (a.eventDay ?? "9999").localeCompare(b.eventDay ?? "9999") || a.eventTitle.localeCompare(b.eventTitle) || a.staffName.localeCompare(b.staffName)
  );
}
