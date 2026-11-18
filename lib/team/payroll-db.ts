// Payroll from the database. Server only. Admins only (role admin, never
// managers): every function here checks the role itself.
//
// Lines are the payout sheet (lib/team/payout-db.ts payoutFrom) built from the
// Time page's timesheet rows, so this page, the Payout card and the payroll CSV
// always agree. Paid records live in payroll_paid
// (supabase/migrations/20261218_payroll_paid.sql). Until that migration runs,
// reads come back empty (everything shows unpaid) and marking says so.

import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import type { StaffMember } from "@/lib/team/event-view";
import { adminEventTitle } from "@/lib/team/event-list";
import { eventData } from "@/lib/team/markets";
import { isFullAdmin } from "@/lib/team/roles";
import { payoutFrom } from "@/lib/team/payout-db";
import { eventTimesheetRows, timesheetRows } from "@/lib/team/timesheet-db";
import { weekRange, weekStart, type TimesheetRow } from "@/lib/team/timesheet";
import { chicagoToday, eventSchedule } from "@/lib/team/time";
import {
  buildPayroll,
  checkMarkable,
  lineFrom,
  NOT_READY_MESSAGE,
  snapshotOf,
  validateMark,
  type PaidRecord,
  type PayrollLine,
  type PayrollView,
  type Period,
} from "@/lib/team/payroll";

export const PAID_TABLE = "payroll_paid";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number };
const ADMINS_ONLY = { ok: false as const, error: "Admins only.", status: 403 };

interface PaidDb {
  assignment_id: string;
  session_id: string;
  staff_id: string;
  paid_on: string;
  note: string | null;
  minutes: number;
  wages_cents: number;
  mileage_miles: number | string;
  mileage_cents: number;
  tips_cents: number | null;
  total_cents: number;
  marked_by_name: string | null;
  marked_at: string;
}

const toRecord = (r: PaidDb): PaidRecord => ({
  assignmentId: r.assignment_id,
  paidOn: String(r.paid_on).slice(0, 10),
  note: r.note ?? "",
  markedByName: r.marked_by_name || "An admin",
  markedAt: r.marked_at,
  snapshot: {
    minutes: Number(r.minutes),
    wagesCents: Number(r.wages_cents),
    mileageMiles: Number(r.mileage_miles),
    mileageCents: Number(r.mileage_cents),
    tipsCents: r.tips_cents === null || r.tips_cents === undefined ? null : Number(r.tips_cents),
    totalCents: Number(r.total_cents),
  },
});

/** Paid records still in force, by assignment. ready is false when the table is not there yet. */
async function activePaid(assignmentIds: string[]): Promise<{ ready: boolean; byAssignment: Map<string, PaidRecord> }> {
  const byAssignment = new Map<string, PaidRecord>();
  const probe = assignmentIds.length ? assignmentIds : ["00000000-0000-0000-0000-000000000000"];
  const { data, error } = await supabase.from(PAID_TABLE).select("*").in("assignment_id", probe).is("undone_at", null);
  if (error) return { ready: false, byAssignment };
  for (const r of (data as PaidDb[]) ?? []) byAssignment.set(r.assignment_id, toRecord(r));
  return { ready: true, byAssignment };
}

async function sessionsById(ids: string[]): Promise<Map<string, SessionRow>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase.from("sessions").select("*").in("id", [...new Set(ids)]);
  return new Map(((data as SessionRow[]) ?? []).map((s) => [s.id, s]));
}

/** Payroll lines for one event's timesheet rows: one per person on its payout sheet. */
async function eventLines(admin: StaffMember, session: SessionRow, sheet: TimesheetRow[], paid: Map<string, PaidRecord>): Promise<PayrollLine[]> {
  const payout = await payoutFrom(admin, session, sheet);
  if (!payout) return [];
  const ed = eventData(session);
  const sched = eventSchedule(ed);
  const ev = { sessionId: session.id, day: sched.day, title: adminEventTitle(ed), timeZone: sched.tz };
  const byAssignment = new Map(sheet.map((r) => [r.assignmentId, r]));
  return payout.rows.map((p) => lineFrom(p, byAssignment.get(p.assignmentId) ?? null, ev, paid.get(p.assignmentId) ?? null));
}

/**
 * Everything for a pay period: one card per person who worked an event dated
 * in it, their lines, totals, the 40 hour flag (whole weeks), and paid status.
 */
export async function payrollView(admin: StaffMember, period: Period): Promise<PayrollView | null> {
  if (!isFullAdmin(admin.role)) return null;
  // Whole weeks, so the 40 hour flag matches the Time page even for a custom range.
  const weekRows = await timesheetRows(weekStart(period.from), weekRange(period.to).to);
  const inPeriod = weekRows.filter((r) => !!r.eventDay && r.eventDay >= period.from && r.eventDay <= period.to);
  const sessions = await sessionsById(inPeriod.map((r) => r.sessionId));
  const paid = await activePaid(inPeriod.map((r) => r.assignmentId));
  const lines = (await Promise.all([...sessions.values()].map((s) => eventLines(admin, s, inPeriod.filter((r) => r.sessionId === s.id), paid.byAssignment)))).flat();
  return buildPayroll(period, lines, weekRows, paid.ready);
}

/** One line, built fresh from the database. Null when the assignment is not on a payout sheet. */
async function lineFor(admin: StaffMember, assignmentId: string): Promise<{ line: PayrollLine | null; ready: boolean }> {
  const { data: a } = await supabase.from("event_assignments").select("id, session_id").eq("id", assignmentId).maybeSingle();
  const asg = a as { id: string; session_id: string } | null;
  if (!asg) return { line: null, ready: true };
  const sessions = await sessionsById([asg.session_id]);
  const session = sessions.get(asg.session_id);
  if (!session) return { line: null, ready: true };
  const [sheet, paid] = await Promise.all([eventTimesheetRows(session.id), activePaid([assignmentId])]);
  const lines = await eventLines(admin, session, sheet, paid.byAssignment);
  return { line: lines.find((l) => l.assignmentId === assignmentId) ?? null, ready: paid.ready };
}

function paidRow(admin: StaffMember, l: PayrollLine, paidOn: string, note: string, now: Date) {
  const s = snapshotOf(l);
  return {
    assignment_id: l.assignmentId,
    session_id: l.sessionId,
    staff_id: l.staffId,
    paid_on: paidOn,
    note,
    rate_cents: l.payout.rateCents,
    minutes: s.minutes,
    wages_cents: s.wagesCents,
    mileage_miles: s.mileageMiles,
    mileage_cents: s.mileageCents,
    tips_cents: s.tipsCents,
    total_cents: s.totalCents,
    marked_by: admin.id,
    marked_by_name: admin.name,
    marked_at: now.toISOString(),
  };
}

const insertError = (message: string) => (/duplicate key|unique/i.test(message) ? { error: "This line is already marked paid.", status: 409 } : /does not exist|relation|schema cache/i.test(message) ? { error: NOT_READY_MESSAGE, status: 503 } : { error: "Could not save. Try again.", status: 500 });

/** Mark one line paid with a pay date (default today) and an optional note. The numbers are worked out here, never taken from the browser. */
export async function markPaid(admin: StaffMember, body: { assignmentId?: unknown; paidOn?: unknown; note?: unknown }, now: Date = new Date()): Promise<Result> {
  if (!isFullAdmin(admin.role)) return ADMINS_ONLY;
  if (typeof body.assignmentId !== "string" || !body.assignmentId) return { ok: false, error: "Bad request", status: 400 };
  const v = validateMark(body, chicagoToday(now));
  if (!v.ok) return { ok: false, error: v.error, status: 400 };
  const { line, ready } = await lineFor(admin, body.assignmentId);
  if (!ready) return { ok: false, error: NOT_READY_MESSAGE, status: 503 };
  if (!line) return { ok: false, error: "We could not find that line.", status: 404 };
  const c = checkMarkable(line);
  if (!c.ok) return c;
  const { error } = await supabase.from(PAID_TABLE).insert(paidRow(admin, line, v.paidOn, v.note, now));
  if (error) return { ok: false, ...insertError(error.message) };
  return { ok: true };
}

/** Mark every payable line in the period paid for one person. Lines without clocked hours are left and counted. */
export async function markAllPaid(
  admin: StaffMember,
  body: { staffId?: unknown; period?: Period; paidOn?: unknown; note?: unknown },
  now: Date = new Date()
): Promise<Result<{ marked: number; skipped: number }>> {
  if (!isFullAdmin(admin.role)) return ADMINS_ONLY;
  if (typeof body.staffId !== "string" || !body.staffId || !body.period) return { ok: false, error: "Bad request", status: 400 };
  const v = validateMark(body, chicagoToday(now));
  if (!v.ok) return { ok: false, error: v.error, status: 400 };
  const view = await payrollView(admin, body.period);
  if (!view) return ADMINS_ONLY;
  if (!view.ready) return { ok: false, error: NOT_READY_MESSAGE, status: 503 };
  const person = view.people.find((p) => p.staffId === body.staffId);
  if (!person) return { ok: false, error: "That person has no lines in this period.", status: 404 };
  const toMark = person.lines.filter((l) => checkMarkable(l).ok);
  const skipped = person.lines.filter((l) => !l.paid && !l.payable).length;
  if (toMark.length === 0) return { ok: false, error: skipped ? "Nothing to mark. Fix hours first on the lines left." : "Every line is already marked paid.", status: 400 };
  const { error } = await supabase.from(PAID_TABLE).insert(toMark.map((l) => paidRow(admin, l, v.paidOn, v.note, now)));
  if (error) return { ok: false, ...insertError(error.message) };
  return { ok: true, marked: toMark.length, skipped };
}

/** Undo a paid mark. The record is kept, with who undid it and when. */
export async function undoPaid(admin: StaffMember, body: { assignmentId?: unknown }, now: Date = new Date()): Promise<Result> {
  if (!isFullAdmin(admin.role)) return ADMINS_ONLY;
  if (typeof body.assignmentId !== "string" || !body.assignmentId) return { ok: false, error: "Bad request", status: 400 };
  const { data, error } = await supabase
    .from(PAID_TABLE)
    .update({ undone_by: admin.id, undone_by_name: admin.name, undone_at: now.toISOString() })
    .eq("assignment_id", body.assignmentId)
    .is("undone_at", null)
    .select("assignment_id");
  if (error) return { ok: false, ...insertError(error.message) };
  if (!((data as unknown[]) ?? []).length) return { ok: false, error: "This line is not marked paid.", status: 404 };
  return { ok: true };
}

/**
 * A staff member's own paid status: the pay date for each of their events
 * that is marked paid, by session id. Only ever their own rows, only the pay
 * date: no amounts, notes, or anyone else. Empty before the migration runs.
 */
export async function myPaidDates(staffId: string, sessionIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!staffId || sessionIds.length === 0) return out;
  const { data, error } = await supabase.from(PAID_TABLE).select("session_id, paid_on").eq("staff_id", staffId).in("session_id", [...new Set(sessionIds)]).is("undone_at", null);
  if (error) return out;
  for (const r of (data as { session_id: string; paid_on: string }[]) ?? []) out.set(r.session_id, String(r.paid_on).slice(0, 10));
  return out;
}
