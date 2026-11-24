// Ranked shift offers, the planning side: who is eligible for an event, in
// what order, and when each offer goes out. Reads the offer order
// (lib/team/scorecard-ranks-db.ts), so it is admin and cron only: no staff
// page, route, text or export imports this file. Once a run is planned,
// lib/team/offers-db.ts sends it and never reads the order tables.

import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import type { StaffMember } from "@/lib/team/event-view";
import { staffingCounts, type AssignmentStatus } from "@/lib/team/assignments";
import { activeOpenPost } from "@/lib/team/shifts-db";
import { hiddenEventIds, isHidden } from "@/lib/team/hidden";
import { ensureMarket } from "@/lib/team/markets-db";
import { eventData, marketLabel, marketTz, sessionMarket, staffMarketsOf, type Market } from "@/lib/team/markets";
import { eventSchedule, todayIn } from "@/lib/team/time";
import { isAdminRole } from "@/lib/team/roles";
import { bartenderRows } from "@/lib/team/event-roles";
import { assignmentsWithRoles } from "@/lib/team/event-roles-db";
import { anyoneBeyondDeveloping, offerOrder } from "@/lib/team/scorecard-ranks-db";
import {
  GROUP_LABEL,
  MODE_LABEL,
  daysUntil,
  planTimes,
  skipReason,
  type Mode,
  type Planned,
} from "@/lib/team/offers";
import { advanceRun, busyFor, countOnFile, createRun, eventFit, liveRun, offerSettings, runView, runsFor, whenIn, type Result, type RunView } from "@/lib/team/offers-db";

const fail = (error: string, status = 409) => ({ ok: false as const, error, status });

/** The people working the event as Bartender: offers fill Bartender spots only. */
async function assignmentsOf(sessionId: string): Promise<{ staff_id: string; status: AssignmentStatus }[]> {
  try {
    return bartenderRows(await assignmentsWithRoles(sessionId));
  } catch {
    return [];
  }
}

export interface PlanLine {
  staffId: string;
  name: string;
  group: string;
  rank: number;
  at: string; // when their offer would go out
}

export interface EventPlan {
  market: Market | null;
  needed: number | null;
  spots: number;
  order: PlanLine[];
  planned: Planned[];
  skipped: { name: string; reason: string }[];
  teamApproved: boolean;
  block: string | null; // why offers cannot start now
}

/** Who would get offers for this event, in what order and when, and who is skipped and why. */
export async function planFor(session: SessionRow, viewer: StaffMember | null, now: Date = new Date()): Promise<EventPlan> {
  const market = sessionMarket(session);
  const needed = countOnFile(session);
  const asg = await assignmentsOf(session.id);
  const spots = staffingCounts(needed, asg.map((a) => a.status)).stillNeeded;
  const base: EventPlan = { market, needed, spots, order: [], planned: [], skipped: [], teamApproved: false, block: null };
  if (!market) return { ...base, block: "Set the event's market first." };
  if (needed === null) return { ...base, block: "No bartender count on file. Set it so offers can start." };
  const day = eventSchedule(eventData(session)).day;
  if (!day) return { ...base, block: "The event has no date." };
  if (day < todayIn(marketTz(market), now)) return { ...base, block: "This event is over." };
  if (spots <= 0) return { ...base, block: "Every bartender spot is filled." };
  const { ready, people, order } = await offerOrder(market);
  if (!ready) return { ...base, block: "Run the ranked offers migration first." };
  const busy = await busyFor(session, people.map((p) => p.id), now);
  const fit = eventFit(session);
  const byId = new Map(people.map((p) => [p.id, p]));
  const eligible = order.filter((o) => {
    const p = byId.get(o.staffId)!;
    const reason = skipReason({ id: p.id, name: p.name, role: p.role, active: p.active, in_offers: p.in_offers, markets: staffMarketsOf(p), off_weekdays: p.off_weekdays, weddings: p.rank.weddings, solo: p.rank.solo_guests }, fit, busy);
    if (reason && reason !== "Already on this event") base.skipped.push({ name: p.name, reason });
    return !reason;
  });
  // Places renumbered among the eligible, so the head start never waits on someone skipped.
  const place = [0, 0, 0];
  const ranked = eligible.map((o) => ({ ...o, rank: ++place[o.grp] }));
  const settings = await offerSettings();
  const planned = planTimes(ranked, now, spots, settings, marketTz(market));
  const onEvent = asg.filter((a) => a.status !== "declined").map((a) => a.staff_id);
  return {
    ...base,
    planned,
    teamApproved: await anyoneBeyondDeveloping(onEvent),
    order: planned.map((p) => {
      const self = viewer?.id === p.staffId;
      return {
        staffId: p.staffId,
        name: byId.get(p.staffId)!.name,
        group: self ? "" : GROUP_LABEL[p.grp],
        rank: self ? 0 : p.rank,
        at: whenIn((spots >= 2 && p.dueWideAt ? p.dueWideAt : p.dueAt).toISOString(), market),
      };
    }),
    block: planned.length === 0 ? "Nobody is eligible for this event." : null,
  };
}

/** Start offers for an event: by an admin (Suggest's one tap) or by the cron (Automatic). */
export async function startOffers(by: StaffMember | null, session: SessionRow, now: Date = new Date(), how: "admin" | "automatic" = "admin"): Promise<Result<{ runId: string }>> {
  if (by && !isAdminRole(by.role)) return fail("Admins only.", 403);
  if (await isHidden(session.id)) return fail("This event is hidden. Unhide it first.");
  const market = sessionMarket(session) ?? (await ensureMarket(session));
  if (!market) return fail("Set the event's market first.");
  const settings = await offerSettings();
  if (settings.modes[market] === "off") return fail(`Shift offers are off for ${marketLabel(market)}.`);
  if (await activeOpenPost(session.id)) return fail("This shift is posted. Unpost it first, then send offers.");
  if (await liveRun(session.id)) return fail("Offers are already running for this event.");
  const plan = await planFor(session, by, now);
  if (plan.block) return fail(plan.block);
  const made = await createRun(session, { spots: plan.spots, teamApproved: plan.teamApproved, by, how, planned: plan.planned, now });
  if (!made.ok) return made;
  await advanceRun(made.run, now);
  return { ok: true, runId: made.run.id };
}

/**
 * Automatic mode: start offers for events that need staff, starting the set
 * number of days before the event. Never an event with no bartender count on
 * file, a posted shift, or offers an admin stopped. Only markets on Automatic,
 * which needs "Order reviewed". Returns how many runs started.
 */
export async function autoStartOffers(now: Date = new Date()): Promise<number> {
  const settings = await offerSettings();
  const auto = (Object.entries(settings.modes) as [Market, Mode][]).filter(([m, mode]) => mode === "automatic" && settings.reviewed[m]).map(([m]) => m);
  if (auto.length === 0) return 0;
  const { data } = await supabase.from("sessions").select("*").eq("status", "submitted");
  const hidden = await hiddenEventIds();
  let started = 0;
  for (const s of (data as SessionRow[]) ?? []) {
    try {
      const market = sessionMarket(s);
      if (!market || !auto.includes(market) || hidden.has(s.id)) continue;
      const days = daysUntil(eventSchedule(eventData(s)).day, marketTz(market), now);
      if (days === null || days < 0 || days > settings.startDaysBefore) continue;
      if (countOnFile(s) === null) continue;
      const runs = await runsFor(s.id);
      // Once per need: a run that filled can start again when a spot opens later; never after an admin stopped one.
      if (runs.some((r) => r.status !== "filled")) continue;
      const asg = await assignmentsOf(s.id);
      if (staffingCounts(countOnFile(s), asg.map((a) => a.status)).stillNeeded <= 0) continue;
      if (await activeOpenPost(s.id)) continue;
      const r = await startOffers(null, s, now, "automatic");
      if (r.ok) started++;
    } catch (err) {
      console.error("[offers] automatic start failed:", s.id, err instanceof Error ? err.message : String(err));
    }
  }
  return started;
}

export interface OffersPanel {
  market: string;
  mode: Mode;
  modeLabel: string;
  noCount: boolean; // no bartender count on file: flagged so someone sets it
  posted: boolean;
  run: (RunView & { lines: { sent: string; responded: string; due: string }[]; nextAt: string; startedAt: string }) | null;
  plan: EventPlan | null; // the planned order when nothing is running
}

/** The Offers card on the event's Team tab. Admins and managers; null for anyone else. */
export async function offersPanel(viewer: StaffMember, session: SessionRow, now: Date = new Date()): Promise<OffersPanel | null> {
  if (!isAdminRole(viewer.role)) return null;
  const market = sessionMarket(session);
  const settings = await offerSettings();
  const mode = market ? settings.modes[market] : "off";
  const [view, post] = await Promise.all([runView(viewer, session.id, now), activeOpenPost(session.id)]);
  const live = view && (view.run.status === "running" || view.run.status === "paused");
  const plan = !live && mode !== "off" && !post ? await planFor(session, viewer, now) : null;
  return {
    market: market ? marketLabel(market) : "",
    mode,
    modeLabel: MODE_LABEL[mode],
    noCount: countOnFile(session) === null,
    posted: !!post,
    run: view
      ? {
          ...view,
          lines: view.steps.map((s) => ({ due: whenIn(s.dueAt, view.run.market), sent: whenIn(s.sentAt, view.run.market), responded: whenIn(s.respondedAt, view.run.market) })),
          nextAt: view.next ? whenIn(view.next.at, view.run.market) : "",
          startedAt: whenIn(view.run.started_at, view.run.market),
        }
      : null,
    plan,
  };
}
