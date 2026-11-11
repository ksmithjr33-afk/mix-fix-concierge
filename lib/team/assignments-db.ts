// Database side of staff and assignments: the staff list, assigning and
// removing staff, accept and decline, and the texts each one sends. Server only.
// Texts go through sendStaffText, which never throws, so a failed text never
// undoes or blocks the change that triggered it.

import { supabase } from "@/lib/supabase";
import { NEEDS_CONFIRM } from "@/lib/team/availability";
import type { SessionRow } from "@/lib/event-updates";
import { normalizePhone } from "@/lib/team/codes";
import { bartendersNeeded, firstName, type StaffMember } from "@/lib/team/event-view";
import { eventTitle } from "@/lib/team/event-list";
import { alertAdmins, checkSnapshot, getConfirmation, getSubmittedSession } from "@/lib/team/events";
import { sendStaffText } from "@/lib/team/sms";
import { isHidden } from "@/lib/team/hidden";
import { hasPunches } from "@/lib/team/clock-db";
import { workedMinutes } from "@/lib/team/clock";
import { eventDay, eventSchedule, formatClock, shortDate } from "@/lib/team/time";
import { cleanMarkets, eventData, staffMarketsOf } from "@/lib/team/markets";
import { cancelHandoffsFor, closeIfFilled, confirmProblems } from "@/lib/team/shifts-db";
import {
  assignText,
  canRespond,
  declineText,
  removalText,
  selfChangeError,
  staffingCounts,
  statusAfter,
  notifyAssignedStaff,
  validateStaffInput,
  type UpdateNoticeDeps,
  type AssignmentStatus,
  type Response,
  type StaffingCounts,
  type StaffRecord,
} from "@/lib/team/assignments";

// "*" so markets is read once the column exists, and older rows still load before it does.
const STAFF_COLUMNS = "*";

function shapeStaff(s: StaffRecord): StaffRecord {
  return { id: s.id, name: s.name, phone: s.phone, role: s.role, active: s.active, alerts: s.alerts !== false, markets: staffMarketsOf(s) };
}

// ----- Staff list -----

export async function listStaff(): Promise<StaffRecord[]> {
  const { data, error } = await supabase.from("staff").select(STAFF_COLUMNS).order("active", { ascending: false }).order("name");
  if (error) throw new Error(`staff list failed: ${error.message}`);
  return ((data as StaffRecord[]) ?? []).map(shapeStaff);
}

export type SaveResult = { ok: true; staff: StaffRecord } | { ok: false; error: string };

function duplicatePhone(message: string): boolean {
  return /duplicate key|unique/i.test(message);
}

/** Add a staff member. A market is required: nobody is added to a market by default. */
export async function createStaff(raw: Record<string, unknown>): Promise<SaveResult> {
  const valid = validateStaffInput(raw, normalizePhone, { requireMarkets: true });
  if (!valid.ok) return valid;
  const { data, error } = await supabase
    .from("staff")
    .insert({ ...valid.value, active: true, alerts: true })
    .select(STAFF_COLUMNS)
    .single();
  if (error) return { ok: false, error: duplicatePhone(error.message) ? "Someone on the team already has that phone number." : "Could not save. Try again." };
  return { ok: true, staff: shapeStaff(data as StaffRecord) };
}

/** Edit name, phone, role, active, or alerts. Deactivating also signs the person out everywhere. */
export async function updateStaff(actor: StaffMember, id: string, raw: Record<string, unknown>): Promise<SaveResult> {
  const patch: Record<string, unknown> = {};
  if ("first" in raw || "last" in raw || "phone" in raw || "role" in raw) {
    const valid = validateStaffInput(raw, normalizePhone);
    if (!valid.ok) return valid;
    Object.assign(patch, valid.value);
  }
  if (typeof raw.active === "boolean") patch.active = raw.active;
  if (typeof raw.alerts === "boolean") patch.alerts = raw.alerts;
  if ("markets" in raw && !("markets" in patch)) {
    const markets = cleanMarkets(raw.markets);
    if (!markets) return { ok: false, error: "Pick at least one market." };
    patch.markets = markets;
  }
  if (Object.keys(patch).length === 0) return { ok: false, error: "Nothing to change." };

  const selfError = selfChangeError(actor.id, id, patch as { active?: boolean; role?: string });
  if (selfError) return { ok: false, error: selfError };

  const { data, error } = await supabase.from("staff").update(patch).eq("id", id).select(STAFF_COLUMNS).maybeSingle();
  if (error) return { ok: false, error: duplicatePhone(error.message) ? "Someone on the team already has that phone number." : "Could not save. Try again." };
  if (!data) return { ok: false, error: "That person is not on the team." };
  if (patch.active === false) await supabase.from("staff_sessions").delete().eq("staff_id", id);
  return { ok: true, staff: shapeStaff(data as StaffRecord) };
}

// ----- Assignments -----

export interface AssignmentRow {
  session_id: string;
  staff_id: string;
  status: AssignmentStatus;
  assigned_at: string;
  responded_at: string | null;
  assigned_by: string | null;
}

function eventFacts(session: SessionRow) {
  const ed = eventData(session);
  const s = eventSchedule(ed);
  return {
    date: shortDate(eventDay(ed.event_date)),
    arrival: s.arrivalMin === null ? "" : formatClock(s.arrivalMin),
    title: eventTitle(ed),
  };
}

async function staffById(id: string): Promise<StaffRecord | null> {
  const { data } = await supabase.from("staff").select(STAFF_COLUMNS).eq("id", id).maybeSingle();
  return (data as StaffRecord | null) ?? null;
}

export async function assignmentsFor(sessionId: string): Promise<AssignmentRow[]> {
  const { data, error } = await supabase.from("event_assignments").select("*").eq("session_id", sessionId);
  if (error) throw new Error(`event_assignments lookup failed: ${error.message}`);
  return (data as AssignmentRow[]) ?? [];
}

export type ActionResult = { ok: true } | { ok: false; error: string; status: number };

/** Offer an event to a staff member and text them. Someone who declined can be offered it again. */
export async function assignStaff(
  session: SessionRow,
  staffId: string,
  admin: StaffMember,
  origin: string,
  opts: { confirmUnavailable?: boolean } = {}
): Promise<ActionResult> {
  if (await isHidden(session.id)) return { ok: false, error: "This event is hidden. Unhide it before assigning staff.", status: 409 };
  const staff = await staffById(staffId);
  if (!staff || !staff.active) return { ok: false, error: "That person is not on the active team.", status: 404 };
  const { data: existing } = await supabase
    .from("event_assignments")
    .select("status")
    .eq("session_id", session.id)
    .eq("staff_id", staffId)
    .maybeSingle();
  if (existing && existing.status !== "declined") return { ok: false, error: `${firstName(staff.name)} is already on this event.`, status: 409 };
  // Someone who marked the day unavailable, or (when enforced) has no current certification, can still be assigned after a confirm step.
  if (!opts.confirmUnavailable) {
    const problem = await confirmProblems(staff, session, "Assign");
    if (problem) return { ok: false, error: problem, status: NEEDS_CONFIRM };
  }

  const { error } = await supabase.from("event_assignments").upsert(
    {
      session_id: session.id,
      staff_id: staffId,
      status: "offered",
      assigned_at: new Date().toISOString(),
      responded_at: null,
      assigned_by: admin.id,
    },
    { onConflict: "session_id,staff_id" }
  );
  if (error) throw new Error(`assign failed: ${error.message}`);

  const f = eventFacts(session);
  await sendStaffText(staff.phone, staff.name, assignText({ firstName: firstName(staff.name), date: f.date, arrival: f.arrival, link: `${origin}/team/e/${session.id}` }));
  // Assigning directly still works. If it filled the last spot, a posted shift closes.
  try {
    await closeIfFilled(session);
  } catch (err) {
    console.error("[team] closing the filled shift failed:", err instanceof Error ? err.message : String(err));
  }
  return { ok: true };
}

/** Take a staff member off an event. They get a text unless they had already declined. */
export async function removeStaff(session: SessionRow, staffId: string): Promise<ActionResult> {
  // Time punches point at the assignment, so someone who clocked in stays on the event.
  if (await hasPunches(session.id, staffId)) {
    return { ok: false, error: "They have clocked in for this event, so they cannot be removed. Their time stays on the timesheet.", status: 409 };
  }
  const { data, error } = await supabase
    .from("event_assignments")
    .delete()
    .eq("session_id", session.id)
    .eq("staff_id", staffId)
    .select("status");
  if (error) throw new Error(`remove failed: ${error.message}`);
  const removed = (data as { status: AssignmentStatus }[] | null)?.[0];
  if (!removed) return { ok: false, error: "That person is not on this event.", status: 404 };
  await cancelHandoffsFor(session.id, staffId).catch((err) => console.error("[team] closing a handoff failed:", err));
  if (removed.status !== "declined") {
    const staff = await staffById(staffId);
    if (staff) await sendStaffText(staff.phone, staff.name, removalText({ firstName: firstName(staff.name), date: eventFacts(session).date }));
  }
  return { ok: true };
}

/** Accept or decline. A decline texts every admin with alerts on. */
export async function respondToAssignment(sessionId: string, staff: StaffMember, response: Response, origin: string): Promise<ActionResult> {
  const session = await getSubmittedSession(sessionId);
  if (!session) return { ok: false, error: "We could not find that event.", status: 404 };
  const { data } = await supabase
    .from("event_assignments")
    .select("status")
    .eq("session_id", sessionId)
    .eq("staff_id", staff.id)
    .maybeSingle();
  const status = (data?.status as AssignmentStatus | undefined) ?? null;
  if (!status) return { ok: false, error: "You are not assigned to this event.", status: 403 };
  if (response === "decline" && (await hasPunches(sessionId, staff.id))) {
    return { ok: false, error: "You have clocked in for this event, so it cannot be declined. Text us at 469 754 8512.", status: 409 };
  }
  if (!canRespond(status, response)) {
    return { ok: false, error: status === "declined" ? "You already declined this event." : "You already accepted this event.", status: 409 };
  }

  const { error } = await supabase
    .from("event_assignments")
    .update({ status: statusAfter(response), responded_at: new Date().toISOString() })
    .eq("session_id", sessionId)
    .eq("staff_id", staff.id);
  if (error) throw new Error(`respond failed: ${error.message}`);
  if (response === "decline" && status === "accepted") {
    // A late drop, for the reliability record. Separate, so it never blocks the decline.
    const { error: dropErr } = await supabase.from("event_assignments").update({ dropped_at: new Date().toISOString() }).eq("session_id", sessionId).eq("staff_id", staff.id);
    if (dropErr) console.error("[team] recording the late drop failed:", dropErr.message);
  }

  if (response === "decline") {
    await cancelHandoffsFor(sessionId, staff.id).catch((err) => console.error("[team] closing a handoff failed:", err));
    const f = eventFacts(session);
    const message = declineText({ firstName: firstName(staff.name), title: f.title, date: f.date, link: `${origin}/team/admin/e/${sessionId}` });
    const admins = await alertAdmins();
    await Promise.all(admins.map((a) => sendStaffText(a.phone, a.name, message)));
  }
  return { ok: true };
}

// ----- Client updates -----

const updateDeps: UpdateNoticeDeps = {
  assignedStaff: async (sessionId) => {
    const { data, error } = await supabase
      .from("event_assignments")
      .select("status, staff:staff_id (name, phone, active)")
      .eq("session_id", sessionId)
      .neq("status", "declined");
    if (error) throw new Error(`event_assignments lookup failed: ${error.message}`);
    return (data ?? [])
      .map((r) => (Array.isArray(r.staff) ? r.staff[0] : r.staff) as { name: string; phone: string; active: boolean } | null)
      .filter((s): s is { name: string; phone: string; active: boolean } => !!s && s.active);
  },
  send: sendStaffText,
};

/** After a client update saves, text each assigned staff member. Never throws. */
export function notifyStaffOfUpdate(
  session: { id: string; event_date?: string | null; event_data: Record<string, unknown> | null },
  changedFields: string[],
  origin: string
): Promise<number> {
  return notifyAssignedStaff(session, changedFields, origin, updateDeps);
}

// ----- Admin views -----


/** Staffing counts for every submitted event, for the admin events list. */
export async function staffingByEvent(sessions: SessionRow[]): Promise<Map<string, StaffingCounts>> {
  const ids = sessions.map((s) => s.id);
  const statuses = new Map<string, AssignmentStatus[]>();
  if (ids.length > 0) {
    const { data, error } = await supabase.from("event_assignments").select("session_id, status").in("session_id", ids);
    if (error) throw new Error(`event_assignments lookup failed: ${error.message}`);
    for (const r of (data as { session_id: string; status: AssignmentStatus }[]) ?? []) {
      statuses.set(r.session_id, [...(statuses.get(r.session_id) ?? []), r.status]);
    }
  }
  return new Map(sessions.map((s) => [s.id, staffingCounts(bartendersNeeded(s), statuses.get(s.id) ?? [])]));
}

export interface AssigneeProgress {
  staffId: string;
  name: string;
  phone: string;
  status: AssignmentStatus;
  assignedAt: string;
  respondedAt: string | null;
  checklist: { checked: number; total: number };
  shopping: { checked: number; total: number };
  confirmedAt: string | null;
  barReadyAt: string | null;
  clockIn: string | null;
  clockOut: string | null;
  workedMinutes: number | null;
  punchFlags: string[];
}

/** Everyone on the event with their checklist, shopping, and check in progress. */
export async function assigneeProgress(session: SessionRow): Promise<AssigneeProgress[]> {
  const rows = await assignmentsFor(session.id);
  if (rows.length === 0) return [];
  const { data: staffRows } = await supabase.from("staff").select(STAFF_COLUMNS).in("id", rows.map((r) => r.staff_id));
  const staff = new Map(((staffRows as StaffRecord[]) ?? []).map((s) => [s.id, s]));
  const { data: bar } = await supabase
    .from("bar_ready_reports")
    .select("staff_id, created_at")
    .eq("session_id", session.id)
    .order("created_at", { ascending: true });
  const firstBar = new Map<string, string>();
  for (const b of (bar as { staff_id: string; created_at: string }[]) ?? []) if (!firstBar.has(b.staff_id)) firstBar.set(b.staff_id, b.created_at);

  const { data: punchRows } = await supabase.from("time_punches").select("staff_id, type, punched_at, flags").eq("session_id", session.id);
  const punches = (punchRows as { staff_id: string; type: "in" | "out"; punched_at: string; flags: string[] | null }[]) ?? [];

  const order: Record<AssignmentStatus, number> = { accepted: 0, offered: 1, declined: 2 };
  const out = await Promise.all(
    rows.map(async (r) => {
      const s = staff.get(r.staff_id);
      const member = s ?? { id: r.staff_id, name: "", phone: "", role: "bartender" as const, active: false, alerts: false };
      const [snap, confirmedAt] = await Promise.all([checkSnapshot(session, member), getConfirmation(r.staff_id, session.id)]);
      return {
        staffId: r.staff_id,
        name: s?.name || "Removed staff member",
        phone: s?.phone ?? "",
        status: r.status,
        assignedAt: r.assigned_at,
        respondedAt: r.responded_at,
        checklist: { checked: snap.checklistChecked, total: snap.checklistTotal },
        shopping: { checked: snap.shoppingChecked, total: snap.shoppingTotal },
        confirmedAt: snap.checklistChecked === snap.checklistTotal ? confirmedAt : null,
        barReadyAt: firstBar.get(r.staff_id) ?? null,
        ...(() => {
          const mine = punches.filter((p) => p.staff_id === r.staff_id);
          const pin = mine.find((p) => p.type === "in")?.punched_at ?? null;
          const pout = mine.find((p) => p.type === "out")?.punched_at ?? null;
          return {
            clockIn: pin,
            clockOut: pout,
            workedMinutes: pin && pout ? workedMinutes(pin, pout) : null,
            punchFlags: [...new Set(mine.flatMap((p) => p.flags ?? []))],
          };
        })(),
      };
    })
  );
  return out.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
}
