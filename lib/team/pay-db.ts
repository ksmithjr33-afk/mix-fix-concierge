// Pay: rates and estimates from the database. Server only.
//
// Rates live in their own table (staff_pay_rates), never on the staff row, so
// no staff list, chat, or teammate lookup can carry them. Bartender pages only
// ever call the functions here with the signed in person's own id.

import { isPlanning } from "@/lib/planning";
import { supabase } from "@/lib/supabase";
import type { StaffMember } from "@/lib/team/event-view";
import { eventData } from "@/lib/team/markets";
import { timesheetRows } from "@/lib/team/timesheet-db";
import {
  estimatedPayCents,
  eventPackageName,
  forStaff,
  isPayReason,
  lineRate,
  mileageLine,
  money,
  payCents,
  scheduledMinutes,
  staffEstimate,
  tipsShare,
  validateMileageOverride,
  validateRate,
  MILES_SOURCE_LABEL,
  type LineRate,
  type MilesInput,
  type PackageRates,
  type PayReason,
  type PayStanding,
  type PayTier,
  type PayRow,
  type StaffEstimate,
} from "@/lib/team/pay";
import { isAdminRole } from "@/lib/team/roles";
import { sessionMarket } from "@/lib/team/markets";
import { homeMiles } from "@/lib/team/profile-db";
import { drivingMiles } from "@/lib/team/routes";
import { mileageSettings, packageRates } from "@/lib/team/business-settings-db";
import type { SessionRow } from "@/lib/event-updates";
import { myReimbursements } from "@/lib/team/reimbursements-db";
import { KIND_LABEL } from "@/lib/team/reimbursements";
import type { TimesheetRow } from "@/lib/team/timesheet";
import { sessionPricingModel } from "@/lib/pricing-model";
import { tiersForPay, type TierChange, type TierNow } from "@/lib/team/scorecard-pay-db";
import { eventSchedule } from "@/lib/team/time";
import { eventRoleOf, type EventRole } from "@/lib/team/event-roles";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number };

interface SessionLite {
  id: string;
  event_date?: string | null;
  event_data: Record<string, unknown> | null;
  package_type?: string | null;
  team_market?: string | null;
  booked_price?: { gratuity?: number | null } | null;
  pricing_model?: string | null;
}

/**
 * The rate for one person on one event, from their own rate (or none), the
 * package rates, the event's pricing model, the role they work on the event
 * (the assignment's, lib/team/event-roles.ts) and, on a
 * service fee event, their standing (payStandings). The one rule: lineRate.
 */
export function rateForEvent(ownCents: number | null | undefined, session: SessionLite, rates: PackageRates, role?: string | null, standing?: PayStanding | null): LineRate {
  return lineRate(ownCents, eventPackageName(eventData(session), session), rates, { model: session.pricing_model, role: role ?? "bartender", standing });
}

// ----- Standing on service fee events (tier, new hire, accepted and approved rates) -----
//
// Read only for service fee events: gratuity events never touch any of this.
// Server only. What comes back is used to figure a rate; the tier and the
// reason only ever leave the server on admin pages (forStaff strips them).

const isServiceFee = (s: SessionLite | undefined) => !!s && sessionPricingModel(s) === "service_fee";
const dayOf = (s: SessionLite) => eventSchedule(eventData(s)).day;
const chicagoDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
export const standingKey = (sessionId: string, staffId: string) => `${sessionId}:${staffId}`;

type RankNow = Pick<TierNow, "tier" | "placed">;
type RankChange = TierChange;

/** The tier on a day: the last change on or before it. Never changed: their row if placed, else not placed. */
export function tierOnDay(day: string | null, now: RankNow | undefined, changes: RankChange[]): PayTier | null {
  const valid = (t: unknown): t is PayTier => t === "top" || t === "core" || t === "developing";
  if (changes.length === 0) return now?.placed && valid(now.tier) ? now.tier : null;
  const upTo = changes.filter((c) => !day || chicagoDay(c.changed_at) <= day).sort((a, b) => a.changed_at.localeCompare(b.changed_at));
  const t = upTo.at(-1)?.after?.tier;
  return valid(t) ? t : null;
}

/**
 * Each person's approved events worked as Bartender (session ids with their
 * days), on either model. Events worked in another role (Barback, Event
 * helper, Server) never count toward the new hire count.
 */
async function approvedEventDays(staffIds: string[]): Promise<Map<string, { sessionId: string; day: string | null }[]>> {
  const out = new Map<string, { sessionId: string; day: string | null }[]>();
  const ids = [...new Set(staffIds)];
  if (ids.length === 0) return out;
  const { data: ap } = await supabase.from("time_approvals").select("assignment_id, staff_id").in("staff_id", ids);
  const approvals = (ap as { assignment_id: string; staff_id: string }[]) ?? [];
  if (approvals.length === 0) return out;
  // "*": the role is read once 20270106_assignment_roles.sql has added it; before that the profile role stands in.
  const [{ data: asg }, profiles] = await Promise.all([supabase.from("event_assignments").select("*").in("id", approvals.map((a) => a.assignment_id)), rolesOf(ids)]);
  const rows = (asg as { id: string; session_id: string; staff_id: string; role?: string | null }[]) ?? [];
  const sessionOf = new Map(rows.filter((a) => eventRoleOf(a, profiles.get(a.staff_id)) === "bartender").map((a) => [a.id, a.session_id]));
  const sessions = await sessionsById([...sessionOf.values()]);
  for (const a of approvals) {
    const sid = sessionOf.get(a.assignment_id);
    if (!sid) continue;
    const list = out.get(a.staff_id) ?? [];
    if (!list.some((x) => x.sessionId === sid)) list.push({ sessionId: sid, day: sessions.has(sid) ? dayOf(sessions.get(sid)!) : null });
    out.set(a.staff_id, list);
  }
  return out;
}

/** How many events each person has approved hours on as Bartender, on either model. For the Scorecard warning. */
export async function approvedEventCounts(staffIds: string[]): Promise<Map<string, number>> {
  const days = await approvedEventDays(staffIds);
  return new Map(staffIds.map((id) => [id, days.get(id)?.length ?? 0]));
}

/**
 * Standing for each person on each service fee event, by standingKey. Keys on
 * gratuity events are left out. accepted: use the rate stored when they
 * accepted (off when working out that rate). stored: use the rate stored at approval.
 */
export async function payStandings(
  sessions: Map<string, SessionLite>,
  keys: { sessionId: string; staffId: string }[],
  opts: { accepted?: boolean; stored?: boolean } = { accepted: true, stored: true }
): Promise<Map<string, PayStanding>> {
  const out = new Map<string, PayStanding>();
  const sf = keys.filter((k) => isServiceFee(sessions.get(k.sessionId)));
  if (sf.length === 0) return out;
  const staffIds = [...new Set(sf.map((k) => k.staffId))];
  const sessionIds = [...new Set(sf.map((k) => k.sessionId))];
  const [tiers, approved, asgRes] = await Promise.all([
    tiersForPay(staffIds),
    approvedEventDays(staffIds),
    supabase.from("event_assignments").select("*").in("session_id", sessionIds).in("staff_id", staffIds),
  ]);
  const ranks = new Map(tiers.now.map((r) => [r.staff_id, r]));
  const history = tiers.changes;
  const assignments = (asgRes.data as { id: string; session_id: string; staff_id: string; accepted_rate_cents?: number | null }[]) ?? [];
  const asgFor = new Map(assignments.map((a) => [standingKey(a.session_id, a.staff_id), a]));
  let stored = new Map<string, { rate_cents?: number | null; rate_reason?: string | null }>();
  if (opts.stored !== false && assignments.length) {
    const { data } = await supabase.from("time_approvals").select("*").in("assignment_id", assignments.map((a) => a.id));
    stored = new Map(((data as { assignment_id: string; rate_cents?: number | null; rate_reason?: string | null }[]) ?? []).map((x) => [x.assignment_id, x]));
  }
  for (const k of sf) {
    const s = sessions.get(k.sessionId)!;
    const day = dayOf(s);
    const asg = asgFor.get(standingKey(k.sessionId, k.staffId));
    const st = asg ? stored.get(asg.id) : undefined;
    const before = (approved.get(k.staffId) ?? []).filter((e) => e.sessionId !== k.sessionId && (!day || !e.day || e.day < day)).length;
    out.set(standingKey(k.sessionId, k.staffId), {
      tier: tierOnDay(day, ranks.get(k.staffId), history.filter((h) => h.staff_id === k.staffId)),
      approvedEvents: before,
      acceptedCents: opts.accepted !== false && asg?.accepted_rate_cents && asg.accepted_rate_cents > 0 ? asg.accepted_rate_cents : null,
      stored: st?.rate_cents && st.rate_cents > 0 ? { cents: st.rate_cents, reason: isPayReason(st.rate_reason) ? st.rate_reason : null } : null,
    });
  }
  return out;
}

/** One person's rate on one event, read fresh: own rate, role and standing. */
async function rateNow(sessionId: string, staffId: string, opts: { accepted?: boolean; stored?: boolean }): Promise<{ session: SessionLite; rate: LineRate } | null> {
  const { data: s } = await supabase.from("sessions").select("*").eq("id", sessionId).maybeSingle();
  if (!s) return null;
  const session = s as SessionLite;
  const [own, rates, roles] = await Promise.all([rateOnFile(staffId), packageRates(), eventRoles([{ sessionId, staffId }])]);
  const standing = (await payStandings(new Map([[session.id, session]]), [{ sessionId, staffId }], opts)).get(standingKey(sessionId, staffId));
  return { session, rate: rateForEvent(own, session, rates, roles.get(standingKey(sessionId, staffId)), standing) };
}

/**
 * The service fee rate that applies to someone right now, for a shift request
 * (lib/team/offers-db.ts): approving stores it as their floor, so the rate is
 * the one when they asked. Null on a gratuity event. Never throws.
 */
export async function rateForRequest(sessionId: string, staffId: string): Promise<number | null> {
  try {
    const now = await rateNow(sessionId, staffId, { accepted: false, stored: false });
    return now && sessionPricingModel(now.session) === "service_fee" ? now.rate.cents : null;
  } catch (err) {
    console.error("[offers] rate for request failed:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

/**
 * Store the rate that applies to someone when they accept a service fee event
 * (event_assignments.accepted_rate_cents), so a later tier drop never lowers
 * pay on it. Keeps the first number. Gratuity events store nothing. Never
 * throws, never blocks the accept. Runs from lockMileage, after every accept path.
 */
export async function lockAcceptedRate(sessionId: string, staffId: string, opts: { replace?: boolean } = {}): Promise<void> {
  try {
    const asg = await acceptedAssignment(sessionId, staffId);
    if (!asg) return;
    const now = await rateNow(sessionId, staffId, { accepted: false, stored: false });
    if (!now || sessionPricingModel(now.session) !== "service_fee") return;
    // replace: the role changed, so the floor becomes the new role's rate at the time of the change.
    const q = supabase.from("event_assignments").update({ accepted_rate_cents: now.rate.cents }).eq("id", asg.id);
    const { error } = opts.replace ? await q : await q.is("accepted_rate_cents", null);
    if (error) console.error("[team] storing the accepted rate failed (run 20270105_tier_pay.sql):", error.message);
  } catch (err) {
    console.error("[team] storing the accepted rate failed:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * The rate to store on a timesheet approval: service fee events only (null on
 * a gratuity event, which stores nothing new). Read before the approval is saved.
 */
export async function rateToStore(assignmentId: string): Promise<{ rate_cents: number; rate_reason: PayReason | null } | null> {
  const { data: a } = await supabase.from("event_assignments").select("session_id, staff_id").eq("id", assignmentId).maybeSingle();
  const asg = a as { session_id: string; staff_id: string } | null;
  if (!asg) return null;
  const now = await rateNow(asg.session_id, asg.staff_id, { accepted: true, stored: false });
  if (!now || sessionPricingModel(now.session) !== "service_fee") return null;
  return { rate_cents: now.rate.cents, rate_reason: now.rate.reason ?? null };
}

/**
 * The role each person works on each event (by standingKey): the assignment's
 * role, else the default from their profile. Someone not on the event yet (an
 * open shift, an offer) gets the profile default. Server only.
 */
export async function eventRoles(keys: { sessionId: string; staffId: string }[]): Promise<Map<string, EventRole>> {
  const out = new Map<string, EventRole>();
  if (keys.length === 0) return out;
  const staffIds = [...new Set(keys.map((k) => k.staffId))];
  const sessionIds = [...new Set(keys.map((k) => k.sessionId))];
  const [profiles, { data }] = await Promise.all([rolesOf(staffIds), supabase.from("event_assignments").select("*").in("session_id", sessionIds).in("staff_id", staffIds)]);
  const rows = new Map(((data as { session_id: string; staff_id: string; role?: string | null }[]) ?? []).map((a) => [standingKey(a.session_id, a.staff_id), a]));
  for (const k of keys) out.set(standingKey(k.sessionId, k.staffId), eventRoleOf(rows.get(standingKey(k.sessionId, k.staffId)), profiles.get(k.staffId)));
  return out;
}

/** The profile roles of these people. Missing reads as bartender. */
async function rolesOf(staffIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(staffIds)];
  if (ids.length === 0) return new Map();
  const { data } = await supabase.from("staff").select("id, role").in("id", ids);
  return new Map(((data as { id: string; role: string }[]) ?? []).map((r) => [r.id, r.role]));
}

/** The rate set for one person in cents, or null when none is on file. For the admin rate form. */
export async function rateOnFile(staffId: string): Promise<number | null> {
  const { data, error } = await supabase.from("staff_pay_rates").select("hourly_rate_cents").eq("staff_id", staffId).maybeSingle();
  if (error || !data) return null;
  const c = (data as { hourly_rate_cents: number | null }).hourly_rate_cents;
  return c && c > 0 ? c : null;
}

/** Everyone's rates, for admin pages and the admin CSV only. */
export async function ratesFor(admin: StaffMember, staffIds: string[]): Promise<Map<string, number>> {
  if (!isAdminRole(admin.role) || staffIds.length === 0) return new Map();
  const { data, error } = await supabase.from("staff_pay_rates").select("staff_id, hourly_rate_cents").in("staff_id", [...new Set(staffIds)]);
  if (error || !data) return new Map();
  return new Map((data as { staff_id: string; hourly_rate_cents: number }[]).filter((r) => r.hourly_rate_cents > 0).map((r) => [r.staff_id, r.hourly_rate_cents]));
}

/**
 * The rate for each timesheet row (one person on one event), by assignment:
 * their own rate, else the event's package rate. Admins and managers only, for
 * the Time page and its CSV.
 */
export async function rowRates(admin: StaffMember, rows: Pick<TimesheetRow, "assignmentId" | "staffId" | "sessionId">[]): Promise<Map<string, number>> {
  if (!isAdminRole(admin.role) || rows.length === 0) return new Map();
  const [own, rates, sessions, roles] = await Promise.all([ratesFor(admin, rows.map((r) => r.staffId)), packageRates(), sessionsById(rows.map((r) => r.sessionId)), eventRoles(rows)]);
  const standings = await payStandings(sessions, rows);
  const out = new Map<string, number>();
  for (const r of rows) {
    const s = sessions.get(r.sessionId);
    const key = standingKey(r.sessionId, r.staffId);
    out.set(r.assignmentId, s ? rateForEvent(own.get(r.staffId), s, rates, roles.get(key), standings.get(key)).cents : lineRate(own.get(r.staffId), "", rates).cents);
  }
  return out;
}

async function sessionsById(ids: string[]): Promise<Map<string, SessionLite>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data } = await supabase.from("sessions").select("*").in("id", unique);
  return new Map(((data as SessionLite[]) ?? []).map((s) => [s.id, s]));
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

/** "$187.50" for this person on one event, or null without times. */
export async function myEstimate(staffId: string, session: SessionLite): Promise<string | null> {
  const key = { sessionId: session.id, staffId };
  const [own, rates, roles, standings] = await Promise.all([rateOnFile(staffId), packageRates(), eventRoles([key]), payStandings(new Map([[session.id, session]]), [key])]);
  const c = estimatedPayCents(rateForEvent(own, session, rates, roles.get(standingKey(session.id, staffId)), standings.get(standingKey(session.id, staffId))).cents, eventData(session));
  return c === null ? null : money(c);
}

/** The same for many events at once, by session id. */
export async function myEstimates(staffId: string, sessionIds: string[]): Promise<Record<string, string>> {
  if (sessionIds.length === 0) return {};
  const [own, rates, sessions] = await Promise.all([rateOnFile(staffId), packageRates(), sessionsById(sessionIds)]);
  const keys = [...sessions.keys()].map((sessionId) => ({ sessionId, staffId }));
  const [standings, roles] = await Promise.all([payStandings(sessions, keys), eventRoles(keys)]);
  const out: Record<string, string> = {};
  for (const s of sessions.values()) {
    const c = estimatedPayCents(rateForEvent(own, s, rates, roles.get(standingKey(s.id, staffId)), standings.get(standingKey(s.id, staffId))).cents, eventData(s));
    if (c !== null) out[s.id] = money(c);
  }
  return out;
}

/** The estimate on a posted shift, for the person looking at it. */
export async function myEstimateForPost(staffId: string, postId: string): Promise<string | null> {
  const { data: post } = await supabase.from("shift_posts").select("session_id").eq("id", postId).maybeSingle();
  const sessionId = (post as { session_id?: string } | null)?.session_id;
  if (!sessionId) return null;
  const { data: s } = await supabase.from("sessions").select("*").eq("id", sessionId).maybeSingle();
  if (!s) return null;
  return myEstimate(staffId, s as SessionLite);
}

/**
 * My pay: one row per event this person worked or is on in from..to, with
 * the rate (their own, else the package rate), scheduled hours, approved
 * clocked hours, pay (approved hours once approved, the scheduled estimate
 * before that), their share of the gratuity once it is on file, and their own
 * reimbursements once an admin enters them. Only ever their own rows: the
 * gratuity share is the booking's gratuity split evenly among the bartenders,
 * the same tipsShare the Payout card uses, and nothing about anyone else.
 */
export async function myPayRows(staffId: string, from: string, to: string): Promise<{ rows: PayRow[] }> {
  const sheet = (await timesheetRows(from, to)).filter((r) => r.staffId === staffId);
  if (sheet.length === 0) return { rows: [] };
  const ids = [...new Set(sheet.map((r) => r.sessionId))];
  const [own, rates, sessions, crews, reimb, role] = await Promise.all([rateOnFile(staffId), packageRates(), sessionsById(ids), bartenderCounts(ids), myReimbursements(staffId, ids), roleOf(staffId)]);
  const keys = ids.map((sessionId) => ({ sessionId, staffId }));
  const [standings, eventRoleBy] = await Promise.all([payStandings(sessions, keys), eventRoles(keys)]);
  const rows = sheet.map((r): PayRow => {
    const s = sessions.get(r.sessionId);
    const eventRole = eventRoleBy.get(standingKey(r.sessionId, staffId)) ?? "bartender";
    // Only the rate leaves here, never why: no tier, rank or new hire rate on a staff page.
    const rate = s ? rateForEvent(own, s, rates, eventRole, standings.get(standingKey(s.id, staffId))) : lineRate(own, "", rates);
    const sched = s ? scheduledMinutes(eventData(s)) : null;
    const approvedMinutes = r.approved && r.minutes !== null ? r.minutes : null;
    const tips = s ? tipsShare(gratuityOf(s), crews.get(s.id) ?? 1, role === "bartender", s.pricing_model) : null;
    return {
      sessionId: r.sessionId,
      day: r.eventDay,
      title: r.eventTitle,
      eventRole,
      rateCents: rate.cents,
      rateSource: rate.source,
      ratePkg: rate.pkg,
      serviceFee: !!rate.serviceFee,
      tipsCents: tips?.state === "on_file" ? tips.cents : null,
      reimbursements: (reimb.get(r.sessionId) ?? []).map((x) => ({ label: KIND_LABEL[x.kind], cents: x.cents, note: x.note })),
      scheduledMinutes: sched,
      approvedMinutes,
      payCents: approvedMinutes !== null ? payCents(rate.cents, approvedMinutes) : payCents(rate.cents, sched),
      fromApproved: approvedMinutes !== null,
    };
  });
  return { rows: rows.sort((a, b) => (a.day ?? "").localeCompare(b.day ?? "")) };
}

/** How many accepted bartenders each event has: only a count, for splitting the gratuity. */
async function bartenderCounts(sessionIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (sessionIds.length === 0) return out;
  const { data } = await supabase.from("event_assignments").select("session_id, status, staff:staff_id (role)").in("session_id", sessionIds).eq("status", "accepted");
  for (const r of (data as { session_id: string; staff: { role: string } | { role: string }[] | null }[]) ?? []) {
    const st = Array.isArray(r.staff) ? r.staff[0] : r.staff;
    if ((st?.role ?? "bartender") === "bartender") out.set(r.session_id, (out.get(r.session_id) ?? 0) + 1);
  }
  return out;
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
  if (isPlanning(session)) {
    // No address until the client finishes planning: nothing live from the booked city (lib/planning.ts).
    return new Map(staffIds.map((id) => [id, { ...toInput(stored.get(id), undefined, true), ...(stored.get(id)?.locked_at ? {} : { reason: "awaiting_address" as const }) }]));
  }
  const needLive = staffIds.filter((id) => !stored.get(id)?.locked_at);
  const live = needLive.length ? await homeMiles(session, needLive) : { event: true, byStaff: new Map() };
  return new Map(staffIds.map((id) => [id, toInput(stored.get(id), live.byStaff.get(id), live.event)]));
}

type StoredMiles = { one_way_miles: number | null; miles_reason: MileageRow["miles_reason"]; miles_source: MileageRow["miles_source"] };

/**
 * Work out one person's miles to store: driving miles from the Routes API
 * when their home and the event are both on the map, else straight line
 * (the call failed, or no key). The only place the paid call is made.
 */
async function milesToStore(session: SessionRow, staffId: string): Promise<StoredMiles> {
  const live = await homeMiles(session, [staffId]);
  const h = live.byStaff.get(staffId);
  if (!h) return { one_way_miles: null, miles_reason: live.event ? "no_address" : "no_event_location", miles_source: "straight_line" };
  if (h.miles === null || !h.home || !live.eventAt) return { one_way_miles: null, miles_reason: h.reason ?? null, miles_source: "straight_line" };
  const driving = await drivingMiles(h.home, live.eventAt);
  return driving === null
    ? { one_way_miles: h.miles, miles_reason: null, miles_source: "straight_line" }
    : { one_way_miles: driving, miles_reason: null, miles_source: "driving" };
}

async function acceptedAssignment(sessionId: string, staffId: string): Promise<{ id: string } | null> {
  const { data: a } = await supabase.from("event_assignments").select("id, status").eq("session_id", sessionId).eq("staff_id", staffId).maybeSingle();
  const asg = a as { id: string; status: string } | null;
  return asg && asg.status === "accepted" ? { id: asg.id } : null;
}

/**
 * Store one person's miles on their assignment when they accept. Runs after
 * every accept path (accepting an offer, an approved shift request, a handoff).
 * One Routes API call, here and never on a page view. Keeps the first stored
 * number. Never throws, never blocks the accept.
 */
export async function lockMileage(sessionId: string, staffId: string, now: Date = new Date()): Promise<void> {
  // Every accept path runs this: the service fee rate that applies now is stored with the miles.
  await lockAcceptedRate(sessionId, staffId);
  try {
    const asg = await acceptedAssignment(sessionId, staffId);
    if (!asg) return;
    const { data: existing } = await supabase.from("assignment_mileage").select("assignment_id, locked_at").eq("assignment_id", asg.id).maybeSingle();
    if ((existing as { locked_at: string | null } | null)?.locked_at) return;
    const { data: s } = await supabase.from("sessions").select("*").eq("id", sessionId).maybeSingle();
    // The client has not finished planning: no address yet, so mileage waits for it (lib/planning-db.ts).
    if (!s || isPlanning(s as SessionRow)) return;
    const miles = await milesToStore(s as SessionRow, staffId);
    await supabase.from("assignment_mileage").upsert({ assignment_id: asg.id, session_id: sessionId, staff_id: staffId, ...miles, locked_at: now.toISOString() }, { onConflict: "assignment_id" });
  } catch (err) {
    console.error("[team] storing mileage failed:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Work one person's stored miles out again (their home or the event moved,
 * or they were stored as straight line). Admins and managers, from the Payout
 * card. Leaves any adjustment as it is. Driving miles already stored are not
 * replaced by straight line if the call fails.
 */
export async function recalculateMileage(
  actor: StaffMember,
  sessionId: string,
  staffId: string,
  now: Date = new Date()
): Promise<Result<{ miles: number | null; source: MileageRow["miles_source"]; changed: boolean }>> {
  if (!isAdminRole(actor.role)) return { ok: false, error: "Admins and managers only.", status: 403 };
  const asg = await acceptedAssignment(sessionId, staffId);
  if (!asg) return { ok: false, error: "That person is not on this event.", status: 404 };
  const { data: s } = await supabase.from("sessions").select("*").eq("id", sessionId).maybeSingle();
  if (!s) return { ok: false, error: "We could not find that event.", status: 404 };
  return storeRecalculated(asg.id, s as SessionRow, staffId, now);
}

async function storeRecalculated(
  assignmentId: string,
  session: SessionRow,
  staffId: string,
  now: Date
): Promise<Result<{ miles: number | null; source: MileageRow["miles_source"]; changed: boolean }>> {
  const { data: ex } = await supabase.from("assignment_mileage").select("*").eq("assignment_id", assignmentId).maybeSingle();
  const existing = ex as MileageRow | null;
  const next = await milesToStore(session, staffId);
  if (existing?.miles_source === "driving" && next.miles_source !== "driving") {
    return { ok: false, error: "Could not get driving miles right now. The stored driving miles are unchanged.", status: 502 };
  }
  const changed = !existing?.locked_at || Number(existing.one_way_miles) !== Number(next.one_way_miles) || existing.miles_source !== next.miles_source || existing.miles_reason !== next.miles_reason;
  const { error } = await supabase
    .from("assignment_mileage")
    .upsert({ assignment_id: assignmentId, session_id: session.id, staff_id: staffId, ...next, locked_at: existing?.locked_at ?? now.toISOString() }, { onConflict: "assignment_id" });
  if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
  return { ok: true, miles: next.one_way_miles, source: next.miles_source, changed };
}

export interface UpgradeLine {
  sessionId: string;
  eventDate: string;
  staffId: string;
  assignmentId: string;
  before: { miles: number | null; source: string };
  after: { miles: number | null; source: string } | null; // null: dry run, or not upgraded
  note: string;
}

/**
 * One time: accepted assignments on events from today on whose stored miles
 * are not driving miles (straight line, or never stored). Dry run lists what
 * would be called; apply makes one Routes API call each and stores driving
 * miles. Adjustments are kept. A call that fails leaves the row as it was.
 */
export async function upgradeToDriving(opts: { fromDay: string; apply: boolean; now?: Date }): Promise<UpgradeLine[]> {
  const now = opts.now ?? new Date();
  const { data: sess } = await supabase.from("sessions").select("*").gte("event_date", opts.fromDay);
  const sessions = new Map(((sess as SessionRow[]) ?? []).map((x) => [x.id, x]));
  if (sessions.size === 0) return [];
  const { data: asgs } = await supabase.from("event_assignments").select("id, session_id, staff_id, status").in("session_id", [...sessions.keys()]).eq("status", "accepted");
  const rows = (asgs as { id: string; session_id: string; staff_id: string }[]) ?? [];
  if (rows.length === 0) return [];
  const { data: ms } = await supabase.from("assignment_mileage").select("*").in("assignment_id", rows.map((r) => r.id));
  const stored = new Map(((ms as MileageRow[]) ?? []).map((m) => [m.assignment_id, m]));
  const out: UpgradeLine[] = [];
  for (const r of rows) {
    const m = stored.get(r.id);
    if (m?.locked_at && m.miles_source === "driving") continue;
    const session = sessions.get(r.session_id)!;
    const line: UpgradeLine = {
      sessionId: r.session_id,
      eventDate: String((session as { event_date?: string }).event_date ?? ""),
      staffId: r.staff_id,
      assignmentId: r.id,
      before: { miles: m?.one_way_miles == null ? null : Number(m.one_way_miles), source: m?.locked_at ? MILES_SOURCE_LABEL[m.miles_source] : "not stored" },
      after: null,
      note: opts.apply ? "" : "would call",
    };
    if (opts.apply) {
      const res = await storeRecalculated(r.id, session, r.staff_id, now);
      if (!res.ok) line.note = res.error;
      else {
        line.after = { miles: res.miles, source: MILES_SOURCE_LABEL[res.source] };
        line.note = res.source === "driving" ? "upgraded" : "kept straight line (no driving miles)";
      }
    }
    out.push(line);
  }
  return out.sort((a, b) => a.eventDate.localeCompare(b.eventDate));
}

/** Bartenders accepted on the event, for splitting the gratuity. */
async function acceptedCrew(sessionId: string): Promise<{ staffId: string; role: string; eventRole: EventRole; assignmentId: string }[]> {
  const { data } = await supabase.from("event_assignments").select("*, staff:staff_id (role)").eq("session_id", sessionId).eq("status", "accepted");
  return ((data as { id: string; staff_id: string; role?: string | null; staff: { role: string } | { role: string }[] | null }[]) ?? []).map((r) => {
    const st = Array.isArray(r.staff) ? r.staff[0] : r.staff;
    const role = st?.role ?? "bartender";
    return { staffId: r.staff_id, role, eventRole: eventRoleOf(r, role), assignmentId: r.id };
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
  const [own, rates, settings, crew, miles, role, standings, eventRoleBy] = await Promise.all([
    rateOnFile(staffId),
    packageRates(),
    mileageSettings(),
    acceptedCrew(session.id),
    mileageInputs(session, [staffId]),
    roleOf(staffId),
    payStandings(new Map([[session.id, session as SessionLite]]), [{ sessionId: session.id, staffId }]),
    eventRoles([{ sessionId: session.id, staffId }]),
  ]);
  // The gratuity split (gratuity events only) still follows the profile role, exactly as before.
  const isBartender = role === "bartender";
  const bartenders = crew.filter((c) => c.role === "bartender" && c.staffId !== staffId).length + (isBartender ? 1 : 0);
  // The person's own estimate: the rate, never why (forStaff).
  return forStaff(staffEstimate({
    rate: rateForEvent(own, session, rates, eventRoleBy.get(standingKey(session.id, staffId)), standings.get(standingKey(session.id, staffId))),
    minutes: scheduledMinutes(eventData(session)),
    mileage: mileageLine(miles.get(staffId)!, settings, sessionMarket(session) === "los_angeles"),
    tips: tipsShare(gratuityOf(session), bartenders, isBartender, session.pricing_model),
  }));
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
  role: string; // the profile role: the gratuity split on gratuity events follows it, as before
  eventRole: EventRole; // the role worked on this event: service fee pay follows it, and it is what the Payout card and Payroll show
  estimate: StaffEstimate;
}

/** Everyone accepted on the event, with their estimate. Admins and managers only (the payout sheet). */
export async function crewEstimates(viewer: StaffMember, session: SessionRow): Promise<CrewEstimate[]> {
  if (!isAdminRole(viewer.role)) return [];
  const crew = await acceptedCrew(session.id);
  if (crew.length === 0) return [];
  const ids = crew.map((c) => c.staffId);
  const [own, rates, settings, miles, standings] = await Promise.all([
    ratesFor(viewer, ids),
    packageRates(),
    mileageSettings(),
    mileageInputs(session, ids),
    payStandings(new Map([[session.id, session as SessionLite]]), ids.map((staffId) => ({ sessionId: session.id, staffId }))),
  ]);
  const minutes = scheduledMinutes(eventData(session));
  const bartenders = crew.filter((c) => c.role === "bartender").length;
  const ca = sessionMarket(session) === "los_angeles";
  return crew.map((c) => ({
    staffId: c.staffId,
    assignmentId: c.assignmentId,
    role: c.role,
    eventRole: c.eventRole,
    estimate: staffEstimate({
      rate: rateForEvent(own.get(c.staffId), session, rates, c.eventRole, standings.get(standingKey(session.id, c.staffId))),
      minutes,
      mileage: mileageLine(miles.get(c.staffId)!, settings, ca),
      tips: tipsShare(gratuityOf(session), bartenders, c.role === "bartender", session.pricing_model),
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
