// Database side of timesheets. Server only.
//
// The app checks every rule first (lib/team/timesheet.ts) and shows a clear
// message. The database is the backstop: check constraints refuse edits and
// approvals of your own time, a trigger refuses changes to an approved row,
// an approval can only be removed by reopen_timesheet_row() (which logs the
// reopen first), and staff_id always comes from the assignment.

import { supabase } from "@/lib/supabase";
import type { StaffMember } from "@/lib/team/event-view";
import { eventTitle } from "@/lib/team/event-list";
import { eventDay, eventSchedule, formatClock } from "@/lib/team/time";
import type { PunchFlag, PunchType } from "@/lib/team/clock";
import {
  checkApprove,
  checkEdit,
  checkReopen,
  LOCKED_MESSAGE,
  OWN_APPROVE_MESSAGE,
  OWN_EDIT_MESSAGE,
  OWN_REOPEN_MESSAGE,
  ownTimeConstraint,
  rowMinutes,
  sortRows,
  weekApproval,
  type EditSummary,
  type PunchSummary,
  type ReopenSummary,
  type TimesheetRow,
} from "@/lib/team/timesheet";

interface SessionLite {
  id: string;
  event_date: string | null;
  event_data: Record<string, unknown> | null;
}

interface PunchDb {
  id: string;
  assignment_id: string;
  type: PunchType;
  punched_at: string;
  flags: PunchFlag[] | null;
  source: "phone" | "admin";
}

interface EditDb {
  assignment_id: string;
  type: PunchType;
  action: "add" | "correct";
  old_punched_at: string | null;
  new_punched_at: string;
  reason: string;
  edited_by: string;
  created_at: string;
}

interface ReopenDb {
  assignment_id: string;
  reopened_by: string;
  reason: string;
  approved_by: string;
  approved_at: string;
  created_at: string;
}

function edOf(s: SessionLite): Record<string, unknown> {
  const ed = { ...(s.event_data ?? {}) };
  if (!ed.event_date && s.event_date) ed.event_date = s.event_date;
  return ed;
}

/** Rows for the given assignments, or for every event dated from..to (YYYY-MM-DD, inclusive). */
async function buildRows(filter: { from: string; to: string } | { assignmentIds: string[] }): Promise<TimesheetRow[]> {
  let assignments: { id: string; session_id: string; staff_id: string; status: string }[] = [];
  let sessions: SessionLite[] = [];

  if ("assignmentIds" in filter) {
    if (filter.assignmentIds.length === 0) return [];
    const { data, error } = await supabase.from("event_assignments").select("id, session_id, staff_id, status").in("id", filter.assignmentIds);
    if (error) throw new Error(`event_assignments lookup failed: ${error.message}`);
    assignments = (data as typeof assignments) ?? [];
    const ids = [...new Set(assignments.map((a) => a.session_id))];
    const { data: s } = ids.length ? await supabase.from("sessions").select("id, event_date, event_data").in("id", ids) : { data: [] };
    sessions = (s as SessionLite[]) ?? [];
  } else {
    const { data: s, error } = await supabase.from("sessions").select("id, event_date, event_data").eq("status", "submitted");
    if (error) throw new Error(`sessions lookup failed: ${error.message}`);
    sessions = ((s as SessionLite[]) ?? []).filter((x) => {
      const day = eventDay(edOf(x).event_date);
      return !!day && day >= filter.from && day <= filter.to;
    });
    const ids = sessions.map((x) => x.id);
    if (ids.length === 0) return [];
    const { data, error: aErr } = await supabase.from("event_assignments").select("id, session_id, staff_id, status").in("session_id", ids);
    if (aErr) throw new Error(`event_assignments lookup failed: ${aErr.message}`);
    assignments = (data as typeof assignments) ?? [];
  }

  const aIds = assignments.map((a) => a.id);
  if (aIds.length === 0) return [];
  const [punchRes, approvalRes, editRes, reopenRes] = await Promise.all([
    supabase.from("time_punches").select("id, assignment_id, type, punched_at, flags, source").in("assignment_id", aIds),
    supabase.from("time_approvals").select("assignment_id, approved_by, approved_at").in("assignment_id", aIds),
    supabase.from("time_edits").select("assignment_id, type, action, old_punched_at, new_punched_at, reason, edited_by, created_at").in("assignment_id", aIds),
    supabase.from("time_reopens").select("assignment_id, reopened_by, reason, approved_by, approved_at, created_at").in("assignment_id", aIds),
  ]);
  const punches = (punchRes.data as PunchDb[]) ?? [];
  const approvals = (approvalRes.data as { assignment_id: string; approved_by: string; approved_at: string }[]) ?? [];
  const edits = (editRes.data as EditDb[]) ?? [];
  const reopens = (reopenRes.data as ReopenDb[]) ?? [];

  // Declined rows only show if someone punched against them (which the app prevents).
  const withPunches = new Set(punches.map((p) => p.assignment_id));
  const kept = assignments.filter((a) => a.status === "accepted" || withPunches.has(a.id));

  const staffIds = [...new Set([...kept.map((a) => a.staff_id), ...approvals.map((a) => a.approved_by), ...edits.map((e) => e.edited_by), ...reopens.flatMap((r) => [r.reopened_by, r.approved_by])])];
  const { data: staffRows } = staffIds.length ? await supabase.from("staff").select("id, name, phone").in("id", staffIds) : { data: [] };
  const staff = new Map(((staffRows as { id: string; name: string; phone: string }[]) ?? []).map((s) => [s.id, s]));
  const bySession = new Map(sessions.map((s) => [s.id, s]));

  const rows = kept.flatMap((a): TimesheetRow[] => {
    const s = bySession.get(a.session_id);
    if (!s) return [];
    const ed = edOf(s);
    const sched = eventSchedule(ed);
    const mine = punches.filter((p) => p.assignment_id === a.id);
    const shape = (p: PunchDb | undefined): PunchSummary | null => (p ? { id: p.id, at: p.punched_at, flags: p.flags ?? [], source: p.source } : null);
    const clockIn = shape(mine.find((p) => p.type === "in"));
    const clockOut = shape(mine.find((p) => p.type === "out"));
    const myEdits: EditSummary[] = edits
      .filter((e) => e.assignment_id === a.id)
      .sort((x, y) => x.created_at.localeCompare(y.created_at))
      .map((e) => ({
        type: e.type,
        action: e.action,
        oldAt: e.old_punched_at,
        newAt: e.new_punched_at,
        reason: e.reason,
        byName: staff.get(e.edited_by)?.name || "An admin",
        at: e.created_at,
      }));
    const myReopens: ReopenSummary[] = reopens
      .filter((r) => r.assignment_id === a.id)
      .sort((x, y) => x.created_at.localeCompare(y.created_at))
      .map((r) => ({
        reason: r.reason,
        byName: staff.get(r.reopened_by)?.name || "An admin",
        at: r.created_at,
        approvedByName: staff.get(r.approved_by)?.name || "An admin",
        approvedAt: r.approved_at,
      }));
    const approval = approvals.find((x) => x.assignment_id === a.id);
    const person = staff.get(a.staff_id);
    return [
      {
        assignmentId: a.id,
        staffId: a.staff_id,
        staffName: person?.name || "Unknown staff member",
        staffPhone: person?.phone ?? "",
        sessionId: a.session_id,
        eventTitle: eventTitle(ed),
        eventDay: sched.day,
        scheduledStart: sched.startMin === null ? "" : formatClock(sched.startMin),
        scheduledEnd: sched.endMin === null ? "" : formatClock(sched.endMin),
        clockIn,
        clockOut,
        minutes: rowMinutes(clockIn, clockOut),
        flags: [...new Set([...(clockIn?.flags ?? []), ...(clockOut?.flags ?? [])])],
        edits: myEdits,
        editedByAdmin: myEdits.length > 0,
        reopens: myReopens,
        approved: approval ? { byName: staff.get(approval.approved_by)?.name || "An admin", at: approval.approved_at } : null,
      },
    ];
  });
  return sortRows(rows);
}

export function timesheetRows(from: string, to: string): Promise<TimesheetRow[]> {
  return buildRows({ from, to });
}

export type ActionResult = { ok: true; rows: TimesheetRow[]; message?: string } | { ok: false; error: string; status: number };

/** A database refusal as the message the admin should see. */
function refusal(message: string, kind: "edit" | "approve" | "reopen"): string {
  const own = ownTimeConstraint(message);
  if (own === "edit") return OWN_EDIT_MESSAGE;
  if (own === "approve") return OWN_APPROVE_MESSAGE;
  if (own === "reopen") return OWN_REOPEN_MESSAGE;
  if (/is not approved/i.test(message)) return "This row is not approved.";
  if (/only an admin can reopen/i.test(message)) return "Admins only.";
  if (/time_reopens_reason_check/.test(message)) return "Give a reason for reopening.";
  if (/approved and locked/i.test(message)) return LOCKED_MESSAGE;
  if (/duplicate key|unique/i.test(message)) return kind === "approve" ? "This row is already approved." : "That punch already exists. Correct it instead.";
  if (/reason_check/.test(message)) return "Give a reason for the change.";
  return "";
}

/**
 * Add a missing punch or correct one, with a reason, written to time_edits.
 * A correction keeps the original time on the edit row.
 */
export async function editPunch(actor: StaffMember, assignmentId: string, type: PunchType, at: Date | null, reason: string): Promise<ActionResult> {
  const [row] = await buildRows({ assignmentIds: [assignmentId] });
  if (!row) return { ok: false, error: "We could not find that timesheet row.", status: 404 };
  const check = checkEdit(actor.id, row, { type, at, reason });
  if (!check.ok) return { ok: false, error: check.error, status: check.error === OWN_EDIT_MESSAGE ? 403 : 400 };
  const when = at!.toISOString();
  const why = reason.trim().slice(0, 500);
  const existing = type === "in" ? row.clockIn : row.clockOut;

  if (existing) {
    // Record the edit first: the database refuses it for your own time or an approved row, and then nothing changes.
    const { data: editRow, error: editErr } = await supabase
      .from("time_edits")
      .insert({ punch_id: existing.id, assignment_id: assignmentId, staff_id: row.staffId, edited_by: actor.id, action: "correct", type, old_punched_at: existing.at, new_punched_at: when, reason: why })
      .select("id")
      .single();
    if (editErr) return { ok: false, error: refusal(editErr.message, "edit") || "Could not save. Try again.", status: 409 };
    const flags = [...new Set([...existing.flags, "edited" as PunchFlag])];
    const { error: upErr } = await supabase.from("time_punches").update({ punched_at: when, flags }).eq("id", existing.id);
    if (upErr) {
      await supabase.from("time_edits").delete().eq("id", (editRow as { id: string }).id);
      return { ok: false, error: refusal(upErr.message, "edit") || "Could not save. Try again.", status: 409 };
    }
  } else {
    const { data: punch, error: insErr } = await supabase
      .from("time_punches")
      .insert({
        assignment_id: assignmentId,
        staff_id: row.staffId,
        session_id: row.sessionId,
        type,
        punched_at: when,
        received_at: new Date().toISOString(),
        flags: ["admin_entry"],
        source: "admin",
        created_by: actor.id,
      })
      .select("id")
      .single();
    if (insErr) return { ok: false, error: refusal(insErr.message, "edit") || "Could not save. Try again.", status: 409 };
    const punchId = (punch as { id: string }).id;
    const { error: editErr } = await supabase
      .from("time_edits")
      .insert({ punch_id: punchId, assignment_id: assignmentId, staff_id: row.staffId, edited_by: actor.id, action: "add", type, old_punched_at: null, new_punched_at: when, reason: why });
    if (editErr) {
      // No edit row, no punch: an added punch always has its reason.
      await supabase.from("time_punches").delete().eq("id", punchId);
      return { ok: false, error: refusal(editErr.message, "edit") || "Could not save. Try again.", status: 409 };
    }
  }
  return { ok: true, rows: await buildRows({ assignmentIds: [assignmentId] }) };
}

/** Approve rows. Each is checked; your own rows and incomplete rows are skipped with a reason. */
export async function approveRows(actor: StaffMember, assignmentIds: string[]): Promise<ActionResult> {
  const rows = await buildRows({ assignmentIds });
  if (rows.length === 0) return { ok: false, error: "We could not find those timesheet rows.", status: 404 };
  if (rows.length === 1) {
    const c = checkApprove(actor.id, rows[0]);
    if (!c.ok) return { ok: false, error: c.error, status: c.error === OWN_APPROVE_MESSAGE ? 403 : 400 };
  }
  const { approve, skipped } = weekApproval(actor.id, rows);
  const failures: string[] = [];
  for (const id of approve) {
    const { error } = await supabase.from("time_approvals").insert({ assignment_id: id, staff_id: rows.find((r) => r.assignmentId === id)!.staffId, approved_by: actor.id });
    if (error) failures.push(refusal(error.message, "approve") || "Could not save.");
  }
  const own = skipped.filter((s) => s.reason === OWN_APPROVE_MESSAGE).length;
  const incomplete = skipped.length - own;
  const done = approve.length - failures.length;
  const parts = [`Approved ${done} ${done === 1 ? "row" : "rows"}.`];
  if (own) parts.push(`${own} ${own === 1 ? "row is" : "rows are"} your own time. Ask another admin to approve ${own === 1 ? "it" : "them"}.`);
  if (incomplete) parts.push(`${incomplete} ${incomplete === 1 ? "row needs" : "rows need"} a clock in or out first.`);
  if (failures.length) parts.push(`${failures.length} could not be saved.`);
  return { ok: true, rows: await buildRows({ assignmentIds }), message: parts.join(" ") };
}

/**
 * Reopen an approved row, with a reason. The database function logs who
 * reopened it, when, why, and which approval it undid, then removes the
 * approval, all in one transaction. It is the only way to remove an approval.
 */
export async function reopenRow(actor: StaffMember, assignmentId: string, reason: string): Promise<ActionResult> {
  const [row] = await buildRows({ assignmentIds: [assignmentId] });
  if (!row) return { ok: false, error: "We could not find that timesheet row.", status: 404 };
  const check = checkReopen(actor.id, row, reason);
  if (!check.ok) return { ok: false, error: check.error, status: check.error === OWN_REOPEN_MESSAGE ? 403 : 400 };
  const { error } = await supabase.rpc("reopen_timesheet_row", {
    p_assignment_id: assignmentId,
    p_reopened_by: actor.id,
    p_reason: reason.trim().slice(0, 500),
  });
  if (error) {
    const msg = refusal(error.message, "reopen");
    return { ok: false, error: msg || "Could not reopen. Try again.", status: msg === OWN_REOPEN_MESSAGE ? 403 : 409 };
  }
  return { ok: true, rows: await buildRows({ assignmentIds: [assignmentId] }), message: "Reopened. Correct the row, then approve it again." };
}
