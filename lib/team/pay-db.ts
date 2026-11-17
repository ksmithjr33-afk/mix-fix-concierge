// Pay: rates and estimates from the database. Server only.
//
// Rates live in their own table (staff_pay_rates), never on the staff row, so
// no staff list, chat, or teammate lookup can carry them. Bartender pages only
// ever call the functions here with the signed in person's own id.

import { supabase } from "@/lib/supabase";
import type { StaffMember } from "@/lib/team/event-view";
import { eventData } from "@/lib/team/markets";
import { timesheetRows } from "@/lib/team/timesheet-db";
import {
  effectiveRate,
  estimatedPayCents,
  mileageLine,
  money,
  payCents,
  scheduledMinutes,
  staffEstimate,
  tipsShare,
  validateMileageOverride,
  validateRate,
  type MilesInput,
  type PayRow,
  type StaffEstimate,
} from "@/lib/team/pay";
import { isAdminRole } from "@/lib/team/roles";
import { sessionMarket } from "@/lib/team/markets";
import { homeMiles } from "@/lib/team/profile-db";
import { mileageSettings } from "@/lib/team/business-settings-db";
import type { SessionRow } from "@/lib/event-updates";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number };

interface SessionLite {
  id: string;
  event_date?: string | null;
  event_data: Record<string, unknown> | null;
  team_market?: string | null;
  booked_price?: { gratuity?: number | null } | null;
}

/** The rate set for one person in cents, or null when none is on file. For the admin rate form. */
export async function rateOnFile(staffId: string): Promise<number | null> {
  const { data, error } = await supabase.from("staff_pay_rates").select("hourly_rate_cents").eq("staff_id", staffId).maybeSingle();
  if (error || !data) return null;
  const c = (data as { hourly_rate_cents: number | null }).hourly_rate_cents;
  return c && c > 0 ? c : null;
}

/** The rate pay is figured at for one person: theirs, else the $30 default. */
export async function rateFor(staffId: string): Promise<number> {
  return effectiveRate(await rateOnFile(staffId));
}

/** Everyone's rates, for admin pages and the admin CSV only. */
export async function ratesFor(admin: StaffMember, staffIds: string[]): Promise<Map<string, number>> {
  if (!isAdminRole(admin.role) || staffIds.length === 0) return new Map();
  const { data, error } = await supabase.from("staff_pay_rates").select("staff_id, hourly_rate_cents").in("staff_id", [...new Set(staffIds)]);
  if (error || !data) return new Map();
  return new Map((data as { staff_id: string; hourly_rate_cents: number }[]).filter((r) => r.hourly_rate_cents > 0).map((r) => [r.staff_id, r.hourly_rate_cents]));
}

/** Pay rates for many people, the default filled in for anyone with none. Admins and managers only. */
export async function payRates(admin: StaffMember, staffIds: string[]): Promise<Map<string, number>> {
  if (!isAdminRole(admin.role)) return new Map();
  const set = await ratesFor(admin, staffIds);
  return new Map([...new Set(staffIds)].map((id) => [id, effectiveRate(set.get(id))]));
}

/** Set or clear a rate. Admins only. */
export async function setRate(admin: StaffMember, staffId: string, raw: unknown, now: Date = new Date()): Promise<Result<{ cents: number | null }>> {
  if (!isAdminRole(admin.role)) return { ok: false, error: "Admins only.", status: 403 };
  const v = validateRate(raw);
  if (!v.ok) return { ok: false, error: v.error, status: 400 };
  const { data: p } = await supabase.from("staff").select("id").eq("id", staffId).maybeSingle();
  if (!p) return { ok: false, error: "We could not find that person.", status: 404 };
  const { error } =
    v.cents === null
      ? await supabase.from("staff_pay_rates").delete().eq("staff_id", staffId)
      : await supabase.from("staff_pay_rates").upsert({ staff_id: staffId, hourly_rate_cents: v.cents, updated_by: admin.id, updated_at: now.toISOString() }, { onConflict: "staff_id" });
  if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
  return { ok: true, cents: v.cents };
}

/** "$187.50" for this person on one event, or null without a rate or times. */
export async function myEstimate(staffId: string, session: SessionLite): Promise<string | null> {
  const c = estimatedPayCents(await rateFor(staffId), eventData(session));
  return c === null ? null : money(c);
}

/** The same for many events at once, by session id. */
export async function myEstimates(staffId: string, sessionIds: string[]): Promise<Record<string, string>> {
  const rate = await rateFor(staffId);
  if (sessionIds.length === 0) return {};
  const { data } = await supabase.from("sessions").select("*").in("id", [...new Set(sessionIds)]);
  const out: Record<string, string> = {};
  for (const s of (data as SessionLite[]) ?? []) {
    const c = estimatedPayCents(rate, eventData(s));
    if (c !== null) out[s.id] = money(c);
  }
  return out;
}

/** The estimate on a posted shift, for the person looking at it. */
export async function myEstimateForPost(staffId: string, postId: string): Promise<string | null> {
  const rate = await rateFor(staffId);
  const { data: post } = await supabase.from("shift_posts").select("session_id").eq("id", postId).maybeSingle();
  const sessionId = (post as { session_id?: string } | null)?.session_id;
  if (!sessionId) return null;
  const { data: s } = await supabase.from("sessions").select("*").eq("id", sessionId).maybeSingle();
  if (!s) return null;
  const c = estimatedPayCents(rate, eventData(s as SessionLite));
  return c === null ? null : money(c);
}

/**
 * My pay: one row per event this person worked or is on in from..to, with
 * scheduled hours, approved clocked hours, and pay (approved hours once
 * approved, the scheduled estimate before that). Only ever their own rows.
 */
export async function myPayRows(staffId: string, from: string, to: string): Promise<{ rate: number; rows: PayRow[] }> {
  const rate = await rateFor(staffId);
  const sheet = (await timesheetRows(from, to)).filter((r) => r.staffId === staffId);
  if (sheet.length === 0) return { rate, rows: [] };
  const { data } = await supabase.from("sessions").select("*").in("id", [...new Set(sheet.map((r) => r.sessionId))]);
  const sessions = new Map(((data as SessionLite[]) ?? []).map((s) => [s.id, s]));
  const rows = sheet.map((r): PayRow => {
    const s = sessions.get(r.sessionId);
    const sched = s ? scheduledMinutes(eventData(s)) : null;
    const approvedMinutes = r.approved && r.minutes !== null ? r.minutes : null;
    return {
      sessionId: r.sessionId,
      day: r.eventDay,
      title: r.eventTitle,
      scheduledMinutes: sched,
      approvedMinutes,
      payCents: approvedMinutes !== null ? payCents(rate, approvedMinutes) : payCents(rate, sched),
      fromApproved: approvedMinutes !== null,
    };
  });
  return { rate, rows: rows.sort((a, b) => (a.day ?? "").localeCompare(b.day ?? "")) };
}

// ----- Mileage and the full estimate (hourly, mileage, tips) -----
//
// Miles are stored per assignment in assignment_mileage when the person
// accepts, so the number does not drift if an address changes later. Before
// that (an offer, an open shift) they are worked out live. An admin or
// manager can adjust miles or the amount for one person on one event, with a
// note. The table is read only here, like the rates.

interface MileageRow {
  assignment_id: string;
  session_id: string;
  staff_id: string;
  one_way_miles: number | null;
  miles_reason: "no_address" | "not_found" | "no_event_location" | null;
  miles_source: "straight_line" | "driving";
  locked_at: string | null;
  override_miles: number | null;
  override_cents: number | null;
  override_note: string | null;
  override_by: string | null;
  override_by_name: string | null;
  override_at: string | null;
}

async function mileageRows(sessionId: string): Promise<Map<string, MileageRow>> {
  const { data, error } = await supabase.from("assignment_mileage").select("*").eq("session_id", sessionId);
  if (error || !data) return new Map();
  return new Map((data as MileageRow[]).map((r) => [r.staff_id, r]));
}

function toInput(stored: MileageRow | undefined, live: { miles: number | null; reason?: "no_address" | "not_found" } | undefined, eventFound: boolean): MilesInput {
  const override = stored ? { overrideMiles: stored.override_miles, overrideCents: stored.override_cents, overrideNote: stored.override_note, overrideByName: stored.override_by_name } : {};
  if (stored?.locked_at) {
    return { oneWayMiles: stored.one_way_miles === null ? null : Number(stored.one_way_miles), reason: stored.miles_reason ?? undefined, source: stored.miles_source, locked: true, ...override };
  }
  if (live) return { oneWayMiles: live.miles, reason: live.reason, source: "straight_line", locked: false, ...override };
  return { oneWayMiles: null, reason: eventFound ? "no_address" : "no_event_location", source: "straight_line", locked: false, ...override };
}

/** Mileage input for each person on an event: stored when they accepted, else live. */
async function mileageInputs(session: SessionRow, staffIds: string[]): Promise<Map<string, MilesInput>> {
  const stored = await mileageRows(session.id);
  const needLive = staffIds.filter((id) => !stored.get(id)?.locked_at);
  const live = needLive.length ? await homeMiles(session, needLive) : { event: true, byStaff: new Map() };
  return new Map(staffIds.map((id) => [id, toInput(stored.get(id), live.byStaff.get(id), live.event)]));
}

/**
 * Store one person's miles on their assignment when they accept. Runs after
 * every accept path (accepting an offer, an approved shift request, a handoff).
 * Keeps the first stored number. Never throws, never blocks the accept.
 */
export async function lockMileage(sessionId: string, staffId: string, now: Date = new Date()): Promise<void> {
  try {
    const { data: a } = await supabase.from("event_assignments").select("id, status").eq("session_id", sessionId).eq("staff_id", staffId).maybeSingle();
    const asg = a as { id: string; status: string } | null;
    if (!asg || asg.status !== "accepted") return;
    const { data: existing } = await supabase.from("assignment_mileage").select("assignment_id, locked_at").eq("assignment_id", asg.id).maybeSingle();
    if ((existing as { locked_at: string | null } | null)?.locked_at) return;
    const { data: s } = await supabase.from("sessions").select("*").eq("id", sessionId).maybeSingle();
    if (!s) return;
    const live = await homeMiles(s as SessionRow, [staffId]);
    const h = live.byStaff.get(staffId);
    await supabase.from("assignment_mileage").upsert(
      {
        assignment_id: asg.id,
        session_id: sessionId,
        staff_id: staffId,
        one_way_miles: h?.miles ?? null,
        miles_reason: h ? (h.reason ?? null) : live.event ? "no_address" : "no_event_location",
        miles_source: "straight_line",
        locked_at: now.toISOString(),
      },
      { onConflict: "assignment_id" }
    );
  } catch (err) {
    console.error("[team] storing mileage failed:", err instanceof Error ? err.message : String(err));
  }
}

/** Bartenders accepted on the event, for splitting the gratuity. */
async function acceptedCrew(sessionId: string): Promise<{ staffId: string; role: string; assignmentId: string }[]> {
  const { data } = await supabase.from("event_assignments").select("id, staff_id, status, staff:staff_id (role)").eq("session_id", sessionId).eq("status", "accepted");
  return ((data as { id: string; staff_id: string; staff: { role: string } | { role: string }[] | null }[]) ?? []).map((r) => {
    const st = Array.isArray(r.staff) ? r.staff[0] : r.staff;
    return { staffId: r.staff_id, role: st?.role ?? "bartender", assignmentId: r.id };
  });
}

async function roleOf(staffId: string): Promise<string> {
  const { data } = await supabase.from("staff").select("role").eq("id", staffId).maybeSingle();
  return (data as { role: string } | null)?.role ?? "bartender";
}

function gratuityOf(session: SessionLite): number | null {
  const g = session.booked_price?.gratuity;
  return g === null || g === undefined || !Number.isFinite(Number(g)) ? null : Number(g);
}

/**
 * One person's own estimate on one event: hourly, mileage, tips, total. Only
 * ever called with the signed in person's own id on staff pages. Before they
 * are on the event (an open shift), they are counted in the tips split.
 */
export async function myPayEstimate(staffId: string, session: SessionRow): Promise<StaffEstimate> {
  const [rate, settings, crew, miles, role] = await Promise.all([rateOnFile(staffId), mileageSettings(), acceptedCrew(session.id), mileageInputs(session, [staffId]), roleOf(staffId)]);
  const isBartender = role === "bartender";
  const bartenders = crew.filter((c) => c.role === "bartender" && c.staffId !== staffId).length + (isBartender ? 1 : 0);
  return staffEstimate({
    rateOnFile: rate,
    minutes: scheduledMinutes(eventData(session)),
    mileage: mileageLine(miles.get(staffId)!, settings, sessionMarket(session) === "los_angeles"),
    tips: tipsShare(gratuityOf(session), bartenders, isBartender),
  });
}

/** The same for a posted shift, for the person looking at it. */
export async function myPayEstimateForPost(staffId: string, postId: string): Promise<StaffEstimate | null> {
  const { data: post } = await supabase.from("shift_posts").select("session_id").eq("id", postId).maybeSingle();
  const sessionId = (post as { session_id?: string } | null)?.session_id;
  if (!sessionId) return null;
  const { data: s } = await supabase.from("sessions").select("*").eq("id", sessionId).maybeSingle();
  return s ? myPayEstimate(staffId, s as SessionRow) : null;
}

export interface CrewEstimate {
  staffId: string;
  assignmentId: string;
  role: string;
  estimate: StaffEstimate;
}

/** Everyone accepted on the event, with their estimate. Admins and managers only (the payout sheet). */
export async function crewEstimates(viewer: StaffMember, session: SessionRow): Promise<CrewEstimate[]> {
  if (!isAdminRole(viewer.role)) return [];
  const crew = await acceptedCrew(session.id);
  if (crew.length === 0) return [];
  const ids = crew.map((c) => c.staffId);
  const [rates, settings, miles] = await Promise.all([ratesFor(viewer, ids), mileageSettings(), mileageInputs(session, ids)]);
  const minutes = scheduledMinutes(eventData(session));
  const bartenders = crew.filter((c) => c.role === "bartender").length;
  const ca = sessionMarket(session) === "los_angeles";
  return crew.map((c) => ({
    staffId: c.staffId,
    assignmentId: c.assignmentId,
    role: c.role,
    estimate: staffEstimate({
      rateOnFile: rates.get(c.staffId) ?? null,
      minutes,
      mileage: mileageLine(miles.get(c.staffId)!, settings, ca),
      tips: tipsShare(gratuityOf(session), bartenders, c.role === "bartender"),
    }),
  }));
}

/** Adjust miles or the mileage amount for one person on one event, with a note. Blank both to clear. Admins and managers. */
export async function setMileageOverride(actor: StaffMember, sessionId: string, staffId: string, body: Record<string, unknown>, now: Date = new Date()): Promise<Result> {
  if (!isAdminRole(actor.role)) return { ok: false, error: "Admins and managers only.", status: 403 };
  const v = validateMileageOverride({ miles: body.miles, amount: body.amount, note: body.note });
  if (!v.ok) return { ok: false, error: v.error, status: 400 };
  const { data: a } = await supabase.from("event_assignments").select("id, status").eq("session_id", sessionId).eq("staff_id", staffId).maybeSingle();
  const asg = a as { id: string; status: string } | null;
  if (!asg || asg.status !== "accepted") return { ok: false, error: "That person is not on this event.", status: 404 };
  const patch = v.clear
    ? { override_miles: null, override_cents: null, override_note: null, override_by: null, override_by_name: null, override_at: null }
    : { override_miles: v.miles, override_cents: v.cents, override_note: v.note, override_by: actor.id, override_by_name: actor.name, override_at: now.toISOString() };
  const { error } = await supabase.from("assignment_mileage").upsert({ assignment_id: asg.id, session_id: sessionId, staff_id: staffId, ...patch }, { onConflict: "assignment_id" });
  if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
  return { ok: true };
}
