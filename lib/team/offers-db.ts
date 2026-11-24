// Ranked shift offers: the database side that runs offers once they are
// planned. Server only.
//
// A run is created by the planning side (admins and the cron), which holds
// the order. This file never reads the order tables: it sends what is due, takes accepts
// and declines, and gives admins their controls. Staff facing functions
// (offerForStaff, respondToOffer) never return a group, a place, the order, or
// who else was offered.
//
// Everything here loads before the migration runs: a missing table reads as
// "no offers" and never breaks posting, assigning, or the cron.

import { supabase } from "@/lib/supabase";
import { upsertAssignment } from "@/lib/team/event-roles-db";
import type { SessionRow } from "@/lib/event-updates";
import { bartendersNeeded, firstName, type StaffMember } from "@/lib/team/event-view";
import { adminEventTitle } from "@/lib/team/event-list";
import { alertAdmins, getSubmittedSession } from "@/lib/team/events";
import { siteOrigin } from "@/lib/team/clock-db";
import { isHidden } from "@/lib/team/hidden";
import { sendStaffText } from "@/lib/team/sms";
import { eventData, marketLabel, marketTz, sessionMarket, staffMarketsOf, type Market } from "@/lib/team/markets";
import { datesOffOn, eventDayOf } from "@/lib/team/availability-db";
import { certIssues, certsEnforced } from "@/lib/team/certs-db";
import { lockMileage } from "@/lib/team/pay-db";
import { eventSchedule, isWeddingEvent, shortDate, todayIn } from "@/lib/team/time";
import { gotShiftText, inQuietHours, overlaps, shiftSummary, workWindow, type ShiftSummary } from "@/lib/team/shifts";
import { isAdminRole, isFullAdmin } from "@/lib/team/roles";
import { bartendersFix, bookedBartenders } from "@/lib/team/staffing-fix";
import {
  GROUP_LABEL,
  OFFER_DEFAULTS,
  SETTINGS_KEY,
  STEP_LABEL,
  acceptDecision,
  daysUntil,
  daytimeBetween,
  heldText,
  nextUp,
  nobodyReason,
  nobodyText,
  offerClosedText,
  offerFilledText,
  offerText,
  openSpots,
  readOfferSettings,
  sendNow,
  shiftForPause,
  skipReason,
  validateOfferSettings,
  type Busy,
  type EventFit,
  type Group,
  type OfferSettings,
  type Planned,
  type StepStatus,
} from "@/lib/team/offers";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number };
const fail = (error: string, status = 409) => ({ ok: false as const, error, status });
const FORBIDDEN = fail("Admins only.", 403);

export type RunStatus = "running" | "paused" | "stopped" | "filled" | "exhausted";
export const LIVE: RunStatus[] = ["running", "paused"];

export interface RunRow {
  id: string;
  session_id: string;
  market: Market;
  spots: number;
  status: RunStatus;
  team_approved: boolean;
  started_by: string | null;
  started_by_name: string | null;
  started_how: "admin" | "automatic";
  started_at: string;
  paused_at: string | null;
  ended_at: string | null;
  ended_by_name: string | null;
  alerted_at: string | null;
  alert_reason: string | null;
}

export interface StepRow {
  id: string;
  run_id: string;
  staff_id: string;
  grp: Group;
  rank: number;
  due_at: string;
  due_wide_at: string | null;
  status: StepStatus;
  sent_at: string | null;
  responded_at: string | null;
  skip_reason: string | null;
  skipped_by_name: string | null;
}

interface ClaimRow {
  run_id: string;
  spot: number;
  staff_id: string | null;
  kind: "accept" | "held" | "hand";
}

type StaffFull = StaffMember & { markets?: unknown; off_weekdays?: unknown; in_offers?: boolean | null };

/** Rows from a query; empty (ok false) when the table is missing or the read failed. Never throws. */
async function rows<T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<{ ok: boolean; rows: T[] }> {
  try {
    const { data, error } = await q;
    if (error) return { ok: false, rows: [] };
    return { ok: true, rows: ((data as T[]) ?? []) as T[] };
  } catch {
    return { ok: false, rows: [] };
  }
}

const now0 = () => new Date();
const eventLink = (id: string) => `${siteOrigin()}/team/e/${id}`;
const adminLink = (id: string) => `${siteOrigin()}/team/admin/e/${id}?tab=team`;
export const offerLink = (stepId: string) => `${siteOrigin()}/team/offer/${stepId}`;

// ----- Settings -----

export async function offerSettings(): Promise<OfferSettings> {
  const { rows: r } = await rows<{ value: unknown }>(supabase.from("team_settings").select("value").eq("key", SETTINGS_KEY));
  return r.length ? readOfferSettings(r[0].value) : { ...OFFER_DEFAULTS, modes: { ...OFFER_DEFAULTS.modes }, reviewed: {} };
}

async function writeSettings(admin: StaffMember, value: OfferSettings): Promise<Result> {
  try {
    const { error } = await supabase.from("team_settings").upsert({ key: SETTINGS_KEY, value, updated_by: admin.id, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) return fail("Could not save. Try again.", 500);
    return { ok: true };
  } catch {
    return fail("Could not save. Try again.", 500);
  }
}

/** Head start, window, assign on accept, start days, and each market's mode. Admins only. */
export async function saveOfferSettings(admin: StaffMember, raw: Record<string, unknown>): Promise<Result<{ settings: OfferSettings }>> {
  if (!isFullAdmin(admin.role)) return FORBIDDEN;
  const current = await offerSettings();
  const v = validateOfferSettings(raw, current);
  if (!v.ok) return fail(v.error, 400);
  const w = await writeSettings(admin, v.value);
  return w.ok ? { ok: true, settings: v.value } : w;
}

/** "Order reviewed" for a market: needed before that market can be switched to Automatic. Admins only. */
export async function markOrderReviewed(admin: StaffMember, market: unknown, now: Date = now0()): Promise<Result<{ settings: OfferSettings }>> {
  if (!isFullAdmin(admin.role)) return FORBIDDEN;
  const current = await offerSettings();
  if (typeof market !== "string" || !(market in current.modes)) return fail("Pick a market.", 400);
  const value = { ...current, reviewed: { ...current.reviewed, [market]: { by: admin.name, at: now.toISOString() } } };
  const w = await writeSettings(admin, value);
  return w.ok ? { ok: true, settings: value } : w;
}

// ----- Reads -----

export async function liveRun(sessionId: string): Promise<RunRow | null> {
  const r = await rows<RunRow>(supabase.from("offer_runs").select("*").eq("session_id", sessionId).in("status", LIVE));
  return r.rows[0] ?? null;
}

export async function runsFor(sessionId: string): Promise<RunRow[]> {
  const r = await rows<RunRow>(supabase.from("offer_runs").select("*").eq("session_id", sessionId));
  return r.rows.sort((a, b) => b.started_at.localeCompare(a.started_at));
}

async function runById(id: string): Promise<RunRow | null> {
  const r = await rows<RunRow>(supabase.from("offer_runs").select("*").eq("id", id));
  return r.rows[0] ?? null;
}

async function stepsOf(runId: string): Promise<StepRow[]> {
  return (await rows<StepRow>(supabase.from("offer_steps").select("*").eq("run_id", runId))).rows;
}

async function stepById(id: string): Promise<StepRow | null> {
  return (await rows<StepRow>(supabase.from("offer_steps").select("*").eq("id", id))).rows[0] ?? null;
}

async function claimsOf(runId: string): Promise<ClaimRow[]> {
  return (await rows<ClaimRow>(supabase.from("offer_claims").select("*").eq("run_id", runId))).rows;
}

async function staffByIds(ids: string[]): Promise<Map<string, StaffFull>> {
  if (ids.length === 0) return new Map();
  const r = await rows<StaffFull>(supabase.from("staff").select("*").in("id", [...new Set(ids)]));
  return new Map(r.rows.map((s) => [s.id, s]));
}

async function updateStep(id: string, patch: Partial<StepRow>): Promise<void> {
  const { error } = await supabase.from("offer_steps").update(patch).eq("id", id);
  if (error) throw new Error(`offer step update failed: ${error.message}`);
}

async function updateRun(id: string, patch: Partial<RunRow>): Promise<void> {
  const { error } = await supabase.from("offer_runs").update(patch).eq("id", id);
  if (error) throw new Error(`offer run update failed: ${error.message}`);
}

// ----- Event facts -----

/**
 * The bartender count on file: one an admin set on the Team tab, or the
 * booking's own count. Never the estimate from the guest count, so an event
 * without a real count never starts offers (the Team tab flags it).
 */
export function countOnFile(session: SessionRow): number | null {
  const fix = bartendersFix(session);
  if (fix) return fix.value;
  const booked = bookedBartenders(session);
  return booked.estimated ? null : booked.count;
}

export function guestsOf(session: SessionRow): number | null {
  const ed = eventData(session);
  const n = parseInt(String(ed.guest_count ?? session.guest_count ?? "").replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function eventFit(session: SessionRow): EventFit {
  return {
    market: sessionMarket(session) ?? "",
    day: eventDayOf(session),
    wedding: isWeddingEvent(eventData(session)),
    guests: guestsOf(session),
    bartenders: countOnFile(session) ?? bartendersNeeded(session),
  };
}

function dateOf(session: SessionRow): string {
  return shortDate(eventSchedule(eventData(session)).day) || "the event";
}

function isPast(session: SessionRow, now: Date): boolean {
  const s = eventSchedule(eventData(session));
  return !!s.day && s.day < todayIn(s.tz, now);
}

/** Who is on the event now (offered or accepted). */
export async function onEventIds(sessionId: string): Promise<Set<string>> {
  const r = await rows<{ staff_id: string; status: string }>(supabase.from("event_assignments").select("staff_id, status").eq("session_id", sessionId));
  return new Set(r.rows.filter((a) => a.status !== "declined").map((a) => a.staff_id));
}

/**
 * Who cannot take this event, and why: on it already, a date marked off, on
 * another event at an overlapping time, and (only while certifications are
 * enforced) no valid certification for the market.
 */
export async function busyFor(session: SessionRow, staffIds: string[], now: Date = now0()): Promise<Busy> {
  const day = eventDayOf(session);
  const market = sessionMarket(session);
  const [unavailable, onEvent, enforced] = await Promise.all([datesOffOn(day), onEventIds(session.id), certsEnforced()]);
  const overlapping = new Set<string>();
  if (day && staffIds.length) {
    const mine = workWindow(eventData(session));
    const w = { from: mine.from?.toISOString() ?? null, to: mine.to?.toISOString() ?? null };
    const r = await rows<{ staff_id: string; session_id: string; status: string; session: SessionRow | SessionRow[] | null }>(
      supabase.from("event_assignments").select("staff_id, session_id, status, session:session_id (*)").in("staff_id", staffIds).neq("status", "declined")
    );
    for (const a of r.rows) {
      const s = Array.isArray(a.session) ? a.session[0] : a.session;
      if (!s || s.id === session.id || s.status !== "submitted") continue;
      if (eventDayOf(s) !== day) continue;
      const o = workWindow(eventData(s));
      if (overlaps(w, { from: o.from?.toISOString() ?? null, to: o.to?.toISOString() ?? null })) overlapping.add(a.staff_id);
    }
  }
  const certIssue = enforced && staffIds.length ? await certIssues(staffIds, market, now) : {};
  return { unavailable, onEvent, overlapping, certIssue };
}

// ----- Creating a run (called by the order side once it has planned it) -----

export async function createRun(
  session: SessionRow,
  o: { spots: number; teamApproved: boolean; by: StaffMember | null; how: "admin" | "automatic"; planned: Planned[]; now: Date }
): Promise<Result<{ run: RunRow }>> {
  const market = sessionMarket(session);
  if (!market) return fail("Set the event's market first.");
  const { data, error } = await supabase
    .from("offer_runs")
    .insert({
      session_id: session.id,
      market,
      spots: o.spots,
      status: "running",
      team_approved: o.teamApproved,
      started_by: o.by?.id ?? null,
      started_by_name: o.by?.name ?? "Automatic",
      started_how: o.how,
      started_at: o.now.toISOString(),
    })
    .select("*")
    .single();
  if (error || !data) return fail(/duplicate|unique/i.test(error?.message ?? "") ? "Offers are already running for this event." : "Could not start offers. Try again.", error ? 409 : 500);
  const run = data as RunRow;
  const { error: stepErr } = await supabase.from("offer_steps").insert(
    o.planned.map((p) => ({
      run_id: run.id,
      staff_id: p.staffId,
      grp: p.grp,
      rank: p.rank,
      due_at: p.dueAt.toISOString(),
      due_wide_at: p.dueWideAt?.toISOString() ?? null,
      status: "planned",
    }))
  );
  if (stepErr) {
    await supabase.from("offer_runs").delete().eq("id", run.id);
    return fail("Could not start offers. Try again.", 500);
  }
  return { ok: true, run };
}

// ----- Claims: first to accept gets the spot -----

/**
 * Take a spot in the run. The claims table's primary key (run, spot) makes
 * this safe when two people accept at the same moment: only one insert wins,
 * the other sees the spot taken and tries the next one, if any. Null when
 * every spot is taken.
 */
async function claimSpot(run: RunRow, staffId: string, kind: ClaimRow["kind"]): Promise<number | null> {
  for (let attempt = 0; attempt < run.spots + 2; attempt++) {
    const claims = await claimsOf(run.id);
    const mine = claims.find((c) => c.staff_id === staffId);
    if (mine) return mine.spot;
    if (claims.length >= run.spots) return null;
    const used = new Set(claims.map((c) => c.spot));
    let spot = 1;
    while (used.has(spot)) spot++;
    const { error } = await supabase.from("offer_claims").insert({ run_id: run.id, spot, staff_id: staffId, kind, created_at: new Date().toISOString() });
    if (!error) return spot;
    if (!/duplicate|unique/i.test(error.message)) throw new Error(`offer claim failed: ${error.message}`);
  }
  return null;
}

/** Put someone on the event as accepted (an offer they took). */
async function assignAccepted(run: RunRow, session: SessionRow, staff: StaffFull, now: Date): Promise<void> {
  // Ranked offers fill Bartender spots only.
  const { error } = await upsertAssignment({ session_id: session.id, staff_id: staff.id, status: "accepted", assigned_at: now.toISOString(), responded_at: now.toISOString(), assigned_by: run.started_by, role: "bartender" });
  if (error) throw new Error(`assign failed: ${error.message}`);
  await lockMileage(session.id, staff.id).catch((err) => console.error("[offers] mileage lock failed:", err));
  await sendStaffText(staff.phone, staff.name, gotShiftText({ date: dateOf(session), link: eventLink(session.id) }));
}

/**
 * When every spot is taken for good (nothing waiting for an admin), the run is
 * filled: anyone offered who never answered is recorded as No response and
 * told it is filled, and offers not sent yet are closed.
 */
async function finishIfFilled(run: RunRow, session: SessionRow | null, now: Date): Promise<boolean> {
  const claims = await claimsOf(run.id);
  if (claims.length < run.spots || claims.some((c) => c.kind === "held")) return false;
  await closeOut(run, session, "filled", null, now);
  return true;
}

async function closeOut(run: RunRow, session: SessionRow | null, status: RunStatus, by: string | null, now: Date, opts: { text?: boolean } = {}): Promise<void> {
  await updateRun(run.id, { status, ended_at: now.toISOString(), ended_by_name: by });
  const steps = await stepsOf(run.id);
  const waiting = steps.filter((s) => s.status === "sent");
  for (const s of steps.filter((x) => x.status === "planned")) await updateStep(s.id, { status: "closed" });
  for (const s of waiting) await updateStep(s.id, { status: "no_response" });
  if (opts.text === false || !session) return;
  const people = await staffByIds(waiting.map((s) => s.staff_id));
  const date = dateOf(session);
  const message = status === "filled" ? offerFilledText({ date }) : offerClosedText({ date });
  await Promise.all([...people.values()].map((p) => sendStaffText(p.phone, p.name, message)));
}

// ----- The cron: send what is due, notice when nobody is taking it -----

async function textAdmins(message: string): Promise<number> {
  const admins = await alertAdmins();
  const sent = await Promise.all(admins.map((a) => sendStaffText(a.phone, a.name, message)));
  return sent.filter(Boolean).length;
}

/** One run: end it when the event is gone, send due offers, then the one alert if nobody is taking it. Returns texts sent. */
export async function advanceRun(run: RunRow, now: Date = now0()): Promise<number> {
  const session = await getSubmittedSession(run.session_id);
  if (!session || (await isHidden(run.session_id)) || isPast(session, now)) {
    await closeOut(run, session, "stopped", "Event over or removed", now, { text: false });
    return 0;
  }
  if (await finishIfFilled(run, session, now)) return 0;
  const tz = marketTz(run.market);
  let steps = await stepsOf(run.id);
  const claims = await claimsOf(run.id);
  const open = openSpots(run, claims.length);
  let sent = 0;
  if (run.status === "running" && open > 0) {
    const due = steps.filter((s) => sendNow(s, open, now, tz));
    if (due.length) {
      const people = await staffByIds(due.map((s) => s.staff_id));
      const busy = await busyFor(session, due.map((s) => s.staff_id), now);
      const fit = eventFit(session);
      const sum = shiftSummary(session, { id: run.id, kind: "open", market: run.market }, open);
      for (const s of due) {
        const p = people.get(s.staff_id);
        // Checked again at send time: someone may have marked the day off or taken another event since the plan.
        const reason = !p
          ? "No longer on the team"
          : skipReason({ id: p.id, name: p.name, role: p.role, active: p.active, in_offers: p.in_offers, markets: staffMarketsOf(p), off_weekdays: p.off_weekdays, weddings: true, solo: null }, fit, busy);
        if (reason) {
          await updateStep(s.id, { status: "skipped", skip_reason: reason, skipped_by_name: "Automatic" });
          continue;
        }
        await updateStep(s.id, { status: "sent", sent_at: now.toISOString() });
        if (await sendStaffText(p!.phone, p!.name, offerText({ shortDate: sum.shortDate || "date to be confirmed", city: sum.city, arrive: sum.arrival || "time to be confirmed", service: serviceWords(sum), link: offerLink(s.id) }))) sent++;
      }
      steps = await stepsOf(run.id);
    }
  }
  const reason = nobodyReason({
    open,
    planned: steps.filter((s) => s.status === "planned").length,
    daysOut: daysUntil(eventDayOf(session), tz, now),
    alerted: !!run.alerted_at,
  });
  if (reason && !inQuietHours(now, tz)) {
    await updateRun(run.id, { alerted_at: now.toISOString(), alert_reason: reason });
    const needed = bartendersNeeded(session) ?? run.spots;
    sent += await textAdmins(
      nobodyText({ title: adminEventTitle(eventData(session)), date: dateOf(session), market: marketLabel(run.market), open: Math.min(open, needed), needed, reason, link: adminLink(session.id) })
    );
  }
  return sent;
}

function serviceWords(s: Pick<ShiftSummary, "serviceStart" | "serviceEnd">): string {
  return s.serviceStart && s.serviceEnd ? `${s.serviceStart} to ${s.serviceEnd}` : s.serviceStart || "time to be confirmed";
}

/** Every live run. Each runs on its own so one failing never stops the others. Returns texts sent. */
export async function advanceOffers(now: Date = now0()): Promise<number> {
  const live = await rows<RunRow>(supabase.from("offer_runs").select("*").in("status", LIVE));
  let sent = 0;
  for (const run of live.rows) {
    try {
      sent += await advanceRun(run, now);
    } catch (err) {
      console.error("[offers] run failed:", run.id, err instanceof Error ? err.message : String(err));
    }
  }
  return sent;
}

// ----- Staff side. Never a group, a place, the order, or who else was offered. -----

export type OfferPage =
  | { state: "open"; stepId: string; shift: ShiftSummary }
  | { state: "held"; date: string }
  | { state: "got"; sessionId: string }
  | { state: "passed"; date: string }
  | { state: "gone" };

/** The offer page for the person it was sent to. Anyone else, or an offer not sent yet, sees nothing. */
export async function offerForStaff(stepId: string, staff: StaffMember, now: Date = now0()): Promise<OfferPage> {
  const step = (await rows<Pick<StepRow, "id" | "run_id" | "staff_id" | "status">>(supabase.from("offer_steps").select("id, run_id, staff_id, status").eq("id", stepId))).rows[0];
  if (!step || step.staff_id !== staff.id || step.status === "planned") return { state: "gone" };
  const run = await runById(step.run_id);
  const session = run ? await getSubmittedSession(run.session_id) : null;
  if (!run || !session) return { state: "gone" };
  if (step.status === "accepted") return { state: "got", sessionId: session.id };
  if (step.status === "held") return { state: "held", date: dateOf(session) };
  if (step.status === "declined") return { state: "passed", date: dateOf(session) };
  if (step.status !== "sent" || !LIVE.includes(run.status) || isPast(session, now) || (await isHidden(session.id))) return { state: "gone" };
  const open = openSpots(run, (await claimsOf(run.id)).length);
  if (open <= 0) return { state: "gone" };
  return { state: "open", stepId: step.id, shift: shiftSummary(session, { id: run.id, kind: "open", market: run.market }, open) };
}

/**
 * Accept or pass. The first to accept gets the spot. Weddings, big events,
 * Assign on accept switched off, and an all Developing team wait for an admin
 * to confirm. A pass is recorded for admins and changes nothing else.
 */
export async function respondToOffer(stepId: string, staff: StaffMember, response: unknown, now: Date = now0()): Promise<Result<{ state: "got" | "held" | "passed" }>> {
  if (response !== "accept" && response !== "decline") return fail("Bad request", 400);
  const step = await stepById(stepId);
  if (!step || step.staff_id !== staff.id || step.status === "planned") return fail("We could not find that offer.", 404);
  if (step.status === "accepted") return fail("You already have this shift.");
  if (step.status === "held") return fail("You already accepted. An admin will confirm it and text you.");
  if (step.status === "declined") return fail("You already passed on this shift.");
  if (step.status !== "sent") return fail("This offer is closed.");
  const run = await runById(step.run_id);
  const session = run ? await getSubmittedSession(run.session_id) : null;
  if (!run || !session || !LIVE.includes(run.status) || isPast(session, now) || (await isHidden(session.id))) return fail("This offer is closed.");

  if (response === "decline") {
    await updateStep(step.id, { status: "declined", responded_at: now.toISOString() });
    return { ok: true, state: "passed" };
  }

  const busy = await busyFor(session, [staff.id], now);
  if (busy.onEvent.has(staff.id)) return fail("You are already on this event.");
  if (busy.overlapping.has(staff.id)) return fail("You are on another event at that time, so you cannot take this one. Text us at 469 754 8512 if that is wrong.");

  const settings = await offerSettings();
  const steps = await stepsOf(run.id);
  const claims = await claimsOf(run.id);
  const groupOf = new Map(steps.map((s) => [s.staff_id, s.grp]));
  const decision = acceptDecision({
    assignOnAccept: settings.assignOnAccept,
    wedding: isWeddingEvent(eventData(session)),
    guests: guestsOf(session),
    holdOverGuests: settings.holdOverGuests,
    bartenders: countOnFile(session) ?? bartendersNeeded(session),
    spots: run.spots,
    claims: claims.map((c) => ({ developing: c.kind !== "hand" && groupOf.get(c.staff_id ?? "") === 2 })),
    teamApproved: run.team_approved,
    developing: step.grp === 2,
  });
  const spot = await claimSpot(run, staff.id, decision.hold ? "held" : "accept");
  if (spot === null) {
    await updateStep(step.id, { status: "closed", responded_at: now.toISOString() });
    return fail("Sorry, this shift was just filled. Thanks for answering.");
  }
  const people = await staffByIds([staff.id]);
  const me = people.get(staff.id) ?? (staff as StaffFull);
  if (decision.hold) {
    await updateStep(step.id, { status: "held", responded_at: now.toISOString(), skip_reason: decision.reason });
    await sendStaffText(me.phone, me.name, heldText({ date: dateOf(session) }));
    await textAdmins(`${firstName(me.name) || "A bartender"} accepted the shift offer for ${adminEventTitle(eventData(session))} on ${dateOf(session)}. Confirm or release (${decision.reason}): ${adminLink(session.id)}`);
    return { ok: true, state: "held" };
  }
  await updateStep(step.id, { status: "accepted", responded_at: now.toISOString() });
  await assignAccepted(run, session, me, now);
  await finishIfFilled(run, session, now);
  return { ok: true, state: "got" };
}

// ----- Admin controls -----

async function adminRun(admin: StaffMember, runId: unknown): Promise<Result<{ run: RunRow }>> {
  if (!isAdminRole(admin.role)) return FORBIDDEN;
  if (typeof runId !== "string") return fail("Bad request", 400);
  const run = await runById(runId);
  if (!run) return fail("Those offers are gone. Reload the page.", 404);
  return { ok: true, run };
}

export async function pauseRun(admin: StaffMember, runId: unknown, now: Date = now0()): Promise<Result> {
  const r = await adminRun(admin, runId);
  if (!r.ok) return r;
  if (r.run.status !== "running") return fail("These offers are not running.");
  await updateRun(r.run.id, { status: "paused", paused_at: now.toISOString() });
  return { ok: true };
}

/** Resume: every offer not sent yet moves later by the daytime the pause took. */
export async function resumeRun(admin: StaffMember, runId: unknown, now: Date = now0()): Promise<Result> {
  const r = await adminRun(admin, runId);
  if (!r.ok) return r;
  if (r.run.status !== "paused") return fail("These offers are not paused.");
  const tz = marketTz(r.run.market);
  const paused = r.run.paused_at ? daytimeBetween(new Date(r.run.paused_at), now, tz) : 0;
  if (paused > 0) {
    for (const s of (await stepsOf(r.run.id)).filter((x) => x.status === "planned")) {
      await updateStep(s.id, { due_at: shiftForPause(s.due_at, paused, tz), due_wide_at: s.due_wide_at ? shiftForPause(s.due_wide_at, paused, tz) : null });
    }
  }
  await updateRun(r.run.id, { status: "running", paused_at: null });
  await advanceRun({ ...r.run, status: "running", paused_at: null }, now);
  return { ok: true };
}

/** Stop: no more offers. Anyone offered who never answered is recorded as No response and told it is closed. */
export async function stopRun(admin: StaffMember, runId: unknown, now: Date = now0()): Promise<Result> {
  const r = await adminRun(admin, runId);
  if (!r.ok) return r;
  if (!LIVE.includes(r.run.status)) return fail("These offers already ended.");
  const held = (await stepsOf(r.run.id)).find((s) => s.status === "held");
  if (held) return fail("Someone accepted and is waiting for you. Confirm or release them first.");
  await closeOut(r.run, await getSubmittedSession(r.run.session_id), "stopped", admin.name, now);
  return { ok: true };
}

/** Skip one person: their offer does not go out, or (if it already went out) it closes. */
export async function skipStep(admin: StaffMember, stepId: unknown): Promise<Result> {
  if (!isAdminRole(admin.role)) return FORBIDDEN;
  const step = typeof stepId === "string" ? await stepById(stepId) : null;
  if (!step) return fail("That person is not in these offers.", 404);
  const run = await runById(step.run_id);
  if (!run || !LIVE.includes(run.status)) return fail("These offers already ended.");
  if (step.status !== "planned" && step.status !== "sent") return fail("They already answered.");
  await updateStep(step.id, { status: "skipped", skip_reason: "Skipped by admin", skipped_by_name: admin.name });
  if (step.status === "sent") {
    const session = await getSubmittedSession(run.session_id);
    const p = (await staffByIds([step.staff_id])).get(step.staff_id);
    if (p && session) await sendStaffText(p.phone, p.name, offerClosedText({ date: dateOf(session) }));
  }
  return { ok: true };
}

async function heldStep(admin: StaffMember, stepId: unknown): Promise<Result<{ step: StepRow; run: RunRow; session: SessionRow; person: StaffFull }>> {
  if (!isAdminRole(admin.role)) return FORBIDDEN;
  const step = typeof stepId === "string" ? await stepById(stepId) : null;
  if (!step || step.status !== "held") return fail("Nobody is waiting on that. Reload the page.", 404);
  const run = await runById(step.run_id);
  const session = run ? await getSubmittedSession(run.session_id) : null;
  const person = (await staffByIds([step.staff_id])).get(step.staff_id);
  if (!run || !session || !person) return fail("Those offers are gone. Reload the page.", 404);
  return { ok: true, step, run, session, person };
}

/** Confirm someone who accepted and was held: they are on the event. */
export async function confirmHeld(admin: StaffMember, stepId: unknown, now: Date = now0()): Promise<Result> {
  const h = await heldStep(admin, stepId);
  if (!h.ok) return h;
  const { error } = await supabase.from("offer_claims").update({ kind: "accept" }).eq("run_id", h.run.id).eq("staff_id", h.person.id);
  if (error) throw new Error(`offer claim update failed: ${error.message}`);
  await updateStep(h.step.id, { status: "accepted" });
  await assignAccepted(h.run, h.session, h.person, now);
  await finishIfFilled(h.run, h.session, now);
  return { ok: true };
}

/** Release someone who accepted and was held: the spot opens again and offers carry on. */
export async function releaseHeld(admin: StaffMember, stepId: unknown, now: Date = now0()): Promise<Result> {
  const h = await heldStep(admin, stepId);
  if (!h.ok) return h;
  await supabase.from("offer_claims").delete().eq("run_id", h.run.id).eq("staff_id", h.person.id);
  await updateStep(h.step.id, { status: "released", skipped_by_name: admin.name });
  await sendStaffText(h.person.phone, h.person.name, offerClosedText({ date: dateOf(h.session) }));
  if (h.run.status === "running") await advanceRun(h.run, now);
  return { ok: true };
}

/**
 * Assigning by hand always works and ends the offers for that spot. Called
 * after the assignment is saved. Never throws.
 */
export async function handAssigned(sessionId: string, staffId: string, now: Date = now0()): Promise<void> {
  try {
    const run = await liveRun(sessionId);
    if (!run) return;
    const step = (await stepsOf(run.id)).find((s) => s.staff_id === staffId);
    const claims = await claimsOf(run.id);
    const existing = claims.find((c) => c.staff_id === staffId);
    if (existing) await supabase.from("offer_claims").update({ kind: "hand" }).eq("run_id", run.id).eq("staff_id", staffId);
    else await claimSpot(run, staffId, "hand");
    if (step && step.status !== "accepted") await updateStep(step.id, { status: "closed", skip_reason: "Assigned by hand" });
    await finishIfFilled(run, await getSubmittedSession(sessionId), now);
  } catch (err) {
    console.error("[offers] hand assign bookkeeping failed:", err instanceof Error ? err.message : String(err));
  }
}

// ----- The Team tab view (admins and managers) -----

export interface StepView {
  id: string;
  name: string;
  group: string; // "" for the viewer's own line
  rank: number | null; // null for the viewer's own line
  self: boolean;
  status: StepStatus;
  label: string;
  dueAt: string | null;
  sentAt: string | null;
  respondedAt: string | null;
  note: string;
}

export interface RunView {
  run: RunRow;
  open: number;
  steps: StepView[];
  next: { name: string; at: string } | null;
  held: StepView[];
}

/** The live run (or the latest one) for the Team tab. The viewer's own line never shows their group or place. */
export async function runView(viewer: StaffMember, sessionId: string, now: Date = now0()): Promise<RunView | null> {
  if (!isAdminRole(viewer.role)) return null;
  const run = (await liveRun(sessionId)) ?? (await runsFor(sessionId))[0] ?? null;
  if (!run) return null;
  const [steps, claims] = await Promise.all([stepsOf(run.id), claimsOf(run.id)]);
  const people = await staffByIds(steps.map((s) => s.staff_id));
  const open = openSpots(run, claims.length);
  const tz = marketTz(run.market);
  const views: StepView[] = steps
    .sort((a, b) => a.grp - b.grp || a.rank - b.rank)
    .map((s) => {
      const self = s.staff_id === viewer.id;
      const late = s.status === "closed" && !!s.responded_at;
      return {
        id: s.id,
        name: people.get(s.staff_id)?.name ?? "Former staff",
        group: self ? "" : GROUP_LABEL[s.grp],
        rank: self ? null : s.rank,
        self,
        status: s.status,
        label: late ? "Answered after it filled" : STEP_LABEL[s.status],
        dueAt: s.status === "planned" ? s.due_at : null,
        sentAt: s.sent_at,
        respondedAt: s.responded_at,
        note: s.skip_reason ?? "",
      };
    });
  const n = LIVE.includes(run.status) && run.status === "running" ? nextUp(steps, open, tz, now) : null;
  return {
    run,
    open,
    steps: views,
    next: n ? { name: people.get(n.step.staff_id)?.name ?? "", at: n.at.toISOString() } : null,
    held: views.filter((v) => v.status === "held"),
  };
}

/** "Sat, Dec 12, 3:30 PM" in the market, for the Team tab. */
export function whenIn(iso: string | null, market: Market): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone: marketTz(market), weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}
