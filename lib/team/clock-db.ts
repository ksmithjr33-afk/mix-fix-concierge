// Database side of the time clock and the cron jobs. Server only.
//
// A punch row is written for every accepted tap, with flags for anything an
// admin should look at. The database also guards the rules: one in and one out
// per assignment (unique), retried offline punches are ignored (unique
// client_id), and nobody can edit or approve their own time (check
// constraints on time_edits and time_approvals).

import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import { firstName, type StaffMember } from "@/lib/team/event-view";
import { eventTitle } from "@/lib/team/event-list";
import { alertAdmins } from "@/lib/team/events";
import { hiddenEventIds } from "@/lib/team/hidden";
import { geocodeAddress } from "@/lib/team/geocode";
import { sendStaffText } from "@/lib/team/sms";
import { chicagoToday, eventTz } from "@/lib/team/time";
import { eventData } from "@/lib/team/markets";
import {
  checkPunch,
  cleanLocation,
  clockInOpensAt,
  clockOutReminderDue,
  clockOutReminderText,
  lateSetupDue,
  lateSetupText,
  noticeKey,
  punchFlags,
  punchTime,
  serviceStartLabel,
  workedMinutes,
  type LatLng,
  type PunchFlag,
  type PunchType,
} from "@/lib/team/clock";

export interface PunchRow {
  id: string;
  assignment_id: string;
  staff_id: string;
  session_id: string;
  type: PunchType;
  punched_at: string;
  received_at: string;
  distance_m: number | null;
  flags: PunchFlag[];
}

const PUNCH_COLUMNS = "id, assignment_id, staff_id, session_id, type, punched_at, received_at, distance_m, flags";

export interface AssignmentRef {
  id: string;
  status: "offered" | "accepted" | "declined";
}

export async function assignmentRef(sessionId: string, staffId: string): Promise<AssignmentRef | null> {
  const { data, error } = await supabase
    .from("event_assignments")
    .select("id, status")
    .eq("session_id", sessionId)
    .eq("staff_id", staffId)
    .maybeSingle();
  if (error) return null;
  return (data as AssignmentRef | null) ?? null;
}

export async function punchesFor(assignmentId: string): Promise<PunchRow[]> {
  const { data, error } = await supabase.from("time_punches").select(PUNCH_COLUMNS).eq("assignment_id", assignmentId).order("punched_at");
  if (error) return []; // before the table exists
  return (data as PunchRow[]) ?? [];
}

/** True once anyone on the event has a punch. Staff with punches cannot be removed. */
export async function hasPunches(sessionId: string, staffId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("time_punches")
    .select("id", { count: "exact", head: true })
    .eq("session_id", sessionId)
    .eq("staff_id", staffId);
  if (error) return false;
  return (count ?? 0) > 0;
}

/**
 * The event's map location, geocoded once per address and stored on the
 * session (geo_* columns only, never event_data). A new address from a
 * client update is geocoded again on the next punch.
 */
export async function eventLocation(session: SessionRow): Promise<LatLng | null> {
  const s = session as SessionRow & { geo_lat?: number | null; geo_lng?: number | null; geo_address?: string | null };
  const address = String(session.event_data?.event_address ?? "").trim();
  if (!address) return null;
  if (s.geo_address === address) return s.geo_lat != null && s.geo_lng != null ? { lat: s.geo_lat, lng: s.geo_lng } : null;
  const { location, source } = await geocodeAddress(address);
  const { error } = await supabase
    .from("sessions")
    .update({ geo_lat: location?.lat ?? null, geo_lng: location?.lng ?? null, geo_address: address, geo_source: source, geocoded_at: new Date().toISOString() })
    .eq("id", session.id);
  if (error) console.error("[team] saving the event location failed:", error.message);
  return location;
}

export interface ClockView {
  canPunch: boolean; // accepted on the event
  timeZone: string; // the event's time zone, for the times on the card
  opensAt: string | null; // ISO
  clockIn: { at: string; flags: PunchFlag[]; distance: number | null } | null;
  clockOut: { at: string; flags: PunchFlag[]; distance: number | null } | null;
  workedMinutes: number | null;
}

export function clockView(assignment: AssignmentRef | null, ed: Record<string, unknown>, punches: PunchRow[]): ClockView {
  const pin = punches.find((p) => p.type === "in") ?? null;
  const pout = punches.find((p) => p.type === "out") ?? null;
  const shape = (p: PunchRow | null) => (p ? { at: p.punched_at, flags: p.flags ?? [], distance: p.distance_m } : null);
  return {
    canPunch: assignment?.status === "accepted",
    timeZone: eventTz(ed),
    opensAt: clockInOpensAt(ed)?.toISOString() ?? null,
    clockIn: shape(pin),
    clockOut: shape(pout),
    workedMinutes: pin && pout ? workedMinutes(pin.punched_at, pout.punched_at) : null,
  };
}

export type PunchResult = { ok: true; view: ClockView; duplicate: boolean } | { ok: false; error: string; status: number };

/** Record a clock in or out for the signed in staff member. */
export async function recordPunch(opts: {
  session: SessionRow;
  staff: StaffMember;
  type: PunchType;
  location: unknown;
  clientTime: unknown;
  clientId: unknown;
}): Promise<PunchResult> {
  const { session, staff, type } = opts;
  const ed = eventData(session);
  const assignment = await assignmentRef(session.id, staff.id);
  if (!assignment || assignment.status !== "accepted") {
    return { ok: false, error: "Only staff who accepted this event can clock in.", status: 403 };
  }
  const clientId = typeof opts.clientId === "string" && /^[0-9a-f-]{36}$/i.test(opts.clientId) ? opts.clientId : null;
  if (clientId) {
    // A retry of a punch that already reached us: answer as if it just saved.
    const { data: seen } = await supabase.from("time_punches").select("id").eq("client_id", clientId).maybeSingle();
    if (seen) return { ok: true, duplicate: true, view: clockView(assignment, ed, await punchesFor(assignment.id)) };
  }

  const receivedAt = new Date();
  const { punchedAt, late } = punchTime(opts.clientTime, receivedAt);
  const existing = await punchesFor(assignment.id);
  const allowed = checkPunch(type, existing, punchedAt, clockInOpensAt(ed), eventTz(ed));
  if (!allowed.ok) return { ok: false, error: allowed.error, status: 409 };

  const phone = cleanLocation(opts.location);
  const { flags, distance } = punchFlags({ phone, event: await eventLocation(session), late });
  const clientTime = typeof opts.clientTime === "string" && !isNaN(new Date(opts.clientTime).getTime()) ? opts.clientTime : null;

  const { error } = await supabase.from("time_punches").insert({
    assignment_id: assignment.id,
    staff_id: staff.id,
    session_id: session.id,
    type,
    punched_at: punchedAt.toISOString(),
    received_at: receivedAt.toISOString(),
    client_time: clientTime,
    client_id: clientId,
    lat: phone?.lat ?? null,
    lng: phone?.lng ?? null,
    accuracy: phone?.accuracy ?? null,
    distance_m: distance,
    flags,
    source: "phone",
    created_by: staff.id,
  });
  if (error) {
    // The unique (assignment_id, type) index catches a double tap that raced past the check.
    // An admin already approved this row: the phone drops the punch instead of retrying it.
    if (/approved and locked/i.test(error.message)) {
      return { ok: false, error: "Your time for this event is already approved. Text us at 469 754 8512 if it is wrong.", status: 409 };
    }
    if (/duplicate key|unique/i.test(error.message)) {
      return { ok: false, error: type === "in" ? "You already clocked in for this event." : "You already clocked out for this event.", status: 409 };
    }
    throw new Error(`time_punches insert failed: ${error.message}`);
  }
  return { ok: true, duplicate: false, view: clockView(assignment, ed, await punchesFor(assignment.id)) };
}

// ----- Cron: clock out reminders and late setup alerts -----

/** Claim a once only notice. False when it was already sent, so callers skip it. */
export async function claimNotice(key: string, kind: string): Promise<boolean> {
  const { error } = await supabase.from("team_notices").insert({ key, kind });
  if (!error) return true;
  if (!/duplicate key|unique/i.test(error.message)) console.error("[team] notice claim failed:", error.message);
  return false;
}

export function siteOrigin(): string {
  return (process.env.TEAM_BASE_URL || "https://plan.themixfix.com").replace(/\/+$/, "");
}

/** Anyone still clocked in 30 minutes after service end plus an hour of breakdown gets one text. */
export async function sendClockOutReminders(now: Date = new Date()): Promise<number> {
  const { data, error } = await supabase.from("time_punches").select(PUNCH_COLUMNS).eq("type", "in");
  if (error || !data) return 0;
  const ins = data as PunchRow[];
  if (ins.length === 0) return 0;
  const { data: outs } = await supabase.from("time_punches").select("assignment_id").eq("type", "out").in("assignment_id", ins.map((p) => p.assignment_id));
  const done = new Set(((outs as { assignment_id: string }[]) ?? []).map((o) => o.assignment_id));
  const open = ins.filter((p) => !done.has(p.assignment_id));

  let sent = 0;
  for (const p of open) {
    const { data: s } = await supabase.from("sessions").select("*").eq("id", p.session_id).maybeSingle();
    if (!s) continue;
    const ed = eventData(s as SessionRow);
    if (!clockOutReminderDue(ed, now)) continue;
    const { data: staff } = await supabase.from("staff").select("id, name, phone, active").eq("id", p.staff_id).maybeSingle();
    if (!staff || !staff.active) continue;
    if (!(await claimNotice(noticeKey.clockOut(p.assignment_id), "clock_out"))) continue;
    const ok = await sendStaffText(
      staff.phone as string,
      staff.name as string,
      clockOutReminderText({ firstName: firstName(staff.name), title: eventTitle(ed), link: `${siteOrigin()}/team/e/${p.session_id}` })
    );
    if (ok) sent++;
  }
  return sent;
}

/** Events with staff and no bar ready check in 30 minutes before service: one text to admins with alerts on. */
export async function sendLateSetupAlerts(now: Date = new Date()): Promise<number> {
  // Every event with someone offered or accepted. lateSetupDue only fires in the 30 minutes before service through 2 hours after.
  const { data: rows, error } = await supabase.from("event_assignments").select("session_id, status").neq("status", "declined");
  if (error || !rows) return 0;
  const ids = [...new Set((rows as { session_id: string }[]).map((r) => r.session_id))];
  if (ids.length === 0) return 0;
  const hidden = await hiddenEventIds();
  const { data: sessions } = await supabase.from("sessions").select("*").in("id", ids).eq("status", "submitted");
  const { data: ready } = await supabase.from("bar_ready_reports").select("session_id").in("session_id", ids);
  const hasReady = new Set(((ready as { session_id: string }[]) ?? []).map((r) => r.session_id));
  const today = chicagoToday(now);

  let sent = 0;
  for (const s of (sessions as SessionRow[]) ?? []) {
    if (hidden.has(s.id)) continue;
    const ed = eventData(s);
    if (!lateSetupDue(ed, now, { hasStaff: true, hasBarReady: hasReady.has(s.id) })) continue;
    if (!(await claimNotice(noticeKey.lateSetup(s.id), "late_setup"))) continue;
    const message = lateSetupText({ title: eventTitle(ed), startTime: serviceStartLabel(ed), link: `${siteOrigin()}/team/admin/e/${s.id}` });
    const admins = await alertAdmins();
    const results = await Promise.all(admins.map((a) => sendStaffText(a.phone, a.name, message)));
    if (results.some(Boolean)) sent++;
    console.log(`[team-cron] late setup alert for ${s.id} (${today}): ${results.filter(Boolean).length}/${admins.length} texts`);
  }
  return sent;
}
