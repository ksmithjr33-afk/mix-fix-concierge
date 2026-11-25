// Staff Scorecard: database side. Server only.
//
// Every function here takes the viewer and checks, on the server:
//   1. admins and managers only (anyone else gets null or a 403), and
//   2. never about themselves: the viewer's own ratings, reviews, calls, tier
//      and rank are left out of every read, and every write about them is refused.
// Ranks are worked out without the viewer, so no gap gives their rank away.
//
// Before the migration runs every read comes back empty (ready: false) and
// every write says to run it. No staff page, text or export imports this file.

import { showsOnTeam } from "@/lib/planning";
import { teamRows } from "@/lib/team/team-sessions";
import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import type { StaffMember } from "@/lib/team/event-view";
import { scrub } from "@/lib/team/event-view";
import { adminEventTitle } from "@/lib/team/event-list";
import { listStaff } from "@/lib/team/assignments-db";
import { hiddenEventIds } from "@/lib/team/hidden";
import { recordFacts } from "@/lib/team/reliability-db";
import { correctedClocks } from "@/lib/team/timesheet-db";
import { computeRecord, since90 } from "@/lib/team/reliability";
import { certRows, onboardingProgress } from "@/lib/team/certs-db";
import { certStanding, requiredCert } from "@/lib/team/certs";
import { ONBOARDING } from "@/lib/team/cert-config";
import { eventData, marketLabel, marketTz, staffMarketsOf, type Market } from "@/lib/team/markets";
import { chicagoToday, eventSchedule, todayIn } from "@/lib/team/time";
import { isAdminRole, isFieldRole, isFullAdmin } from "@/lib/team/roles";
import {
  CALL_DAYS,
  NOT_READY,
  SETTINGS_KEY,
  TIER_LABEL,
  arrivalText,
  blankMarks,
  callOverdue,
  confidenceSuggestion,
  leftoverSuggestion,
  markAverage,
  lockOverdue,
  MARK_KEYS,
  ranksByMarket,
  ratingsCsv,
  readTierSettings,
  rosterCsv,
  tierFor,
  toRateList,
  tuesdayBefore,
  validateCall,
  validateRating,
  validateReview,
  validateTierSettings,
  type Marks,
  type MarkKey,
  type Outcome,
  type RatedEvent,
  type RatingCsvRow,
  type ReviewKind,
  type RosterRow,
  type Suggestion,
  type Tier,
  type TierSettings,
  type ToRateEvent,
} from "@/lib/team/scorecard";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number };

const FORBIDDEN = { ok: false as const, error: "Admins and managers only.", status: 403 };
const SELF = { ok: false as const, error: "You cannot see or change your own scorecard.", status: 403 };
const NOT_READY_R = { ok: false as const, error: NOT_READY, status: 503 };

/** Admins and managers only. */
export const canScore = (viewer: Pick<StaffMember, "role"> | null | undefined): boolean => !!viewer && isAdminRole(viewer.role);

/** May this viewer see or change records about this person? Admins and managers, never themselves. */
export function scoreGuard(viewer: Pick<StaffMember, "id" | "role">, staffId: unknown): Result {
  if (!canScore(viewer)) return FORBIDDEN;
  if (typeof staffId !== "string" || !staffId) return { ok: false, error: "Pick a person.", status: 400 };
  if (staffId === viewer.id) return SELF;
  return { ok: true };
}

/** Rows from a query, or ok: false when the table is not there yet (or the read failed). Never throws. */
async function rows<T>(q: PromiseLike<{ data: unknown; error: unknown }>): Promise<{ ok: boolean; rows: T[] }> {
  try {
    const { data, error } = await q;
    if (error) return { ok: false, rows: [] };
    return { ok: true, rows: ((data as T[]) ?? []) as T[] };
  } catch {
    return { ok: false, rows: [] };
  }
}

// ----- Rows -----

export interface RatingRow extends Record<MarkKey, number | null> {
  id: string;
  session_id: string;
  staff_id: string;
  mark_notes: Partial<Record<MarkKey, string>> | null;
  client_feedback: string;
  admin_notes: string;
  rated_by: string | null;
  rated_by_name: string | null;
  rated_at: string;
  updated_by: string | null;
  updated_by_name: string | null;
  updated_at: string;
}

interface VersionRow {
  id: string;
  rating_id: string;
  data: Record<string, unknown>;
  saved_by_name: string | null;
  saved_at: string;
}

interface CallRow {
  session_id: string;
  staff_id: string;
  done: boolean;
  outcome: Outcome | null;
  confidence: number | null;
  notes: string;
  called_by: string | null;
  called_by_name: string | null;
  called_at: string | null;
  updated_at: string;
}

interface LockRow {
  session_id: string;
  locked: boolean;
  locked_by_name: string | null;
  locked_at: string | null;
}

interface SetupFlagRow {
  staff_id: string;
  payroll_done: boolean;
  payroll_by_name: string | null;
  payroll_at: string | null;
  // Manual signed: missing until 20261221_manual_signed.sql runs.
  manual_done?: boolean;
  manual_by_name?: string | null;
  manual_at?: string | null;
}

interface ReviewRow {
  id: string;
  staff_id: string;
  kind: ReviewKind;
  review_date: string;
  body: string;
  author_id: string | null;
  author_name: string | null;
  created_at: string;
  updated_by_name: string | null;
  updated_at: string | null;
}

const marksOf = (r: Partial<Record<MarkKey, unknown>>): Marks => {
  const m = blankMarks();
  for (const k of MARK_KEYS) m[k] = typeof r[k] === "number" ? (r[k] as number) : null;
  return m;
};

export async function tierSettings(): Promise<TierSettings> {
  const { rows: r } = await rows<{ value: unknown }>(supabase.from("team_settings").select("value").eq("key", SETTINGS_KEY));
  return readTierSettings(r[0]?.value);
}

/** Session day, title, package and client for a set of events. */
async function sessionsById(ids: string[]): Promise<Map<string, SessionRow>> {
  if (ids.length === 0) return new Map();
  const { rows: r } = await rows<SessionRow>(supabase.from("sessions").select("*").in("id", [...new Set(ids)]));
  return new Map(r.map((s) => [s.id, s]));
}

const dayOf = (s: SessionRow | undefined) => (s ? eventSchedule(eventData(s)).day : null);

/** Ratings for these people, newest event first, as tier inputs. */
async function ratingsFor(staffIds: string[]): Promise<{ ready: boolean; ratings: RatingRow[]; sessions: Map<string, SessionRow> }> {
  if (staffIds.length === 0) return { ready: true, ratings: [], sessions: new Map() };
  const r = await rows<RatingRow>(supabase.from("staff_ratings").select("*").in("staff_id", staffIds));
  const sessions = await sessionsById(r.rows.map((x) => x.session_id));
  const ratings = r.rows.sort((a, b) => (dayOf(sessions.get(b.session_id)) ?? "").localeCompare(dayOf(sessions.get(a.session_id)) ?? "") || b.rated_at.localeCompare(a.rated_at));
  return { ready: r.ok, ratings, sessions };
}

function ratedEvents(ratings: RatingRow[], sessions: Map<string, SessionRow>, staffId: string): RatedEvent[] {
  return ratings.filter((r) => r.staff_id === staffId).map((r) => ({ sessionId: r.session_id, day: dayOf(sessions.get(r.session_id)), marks: marksOf(r) }));
}

// ----- Roster -----

/** "Mar 1, 2027" from YYYY-MM-DD, with no hyphens on screen. */
export function dateWords(ymd: string | null): string {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });
}

/** Certification expiry per person for the certs their markets need: "TABC expires Mar 1, 2027". */
async function certExpiry(staff: { id: string; markets?: unknown }[], now: Date): Promise<Record<string, string>> {
  const all = await certRows(staff.map((s) => s.id)).catch(() => []);
  const out: Record<string, string> = {};
  for (const s of staff) {
    const types = new Map<string, Market>();
    for (const m of staffMarketsOf(s)) {
      const t = requiredCert(m);
      if (t && !types.has(t)) types.set(t, m);
    }
    const parts = [...types].map(([t, m]) => {
      const st = certStanding(all.filter((r) => r.staff_id === s.id), t, todayIn(marketTz(m), now));
      if (st.state === "ok") return `${t} expires ${dateWords(st.expiresOn)}`;
      if (st.state === "pending") return `${t} waiting for review`;
      if (st.state === "expired") return `${t} expired ${dateWords(st.expiresOn)}`;
      if (st.state === "rejected") return `${t} rejected`;
      return `${t} missing`;
    });
    if (parts.length) out[s.id] = parts.join(", ");
  }
  return out;
}

export interface Roster {
  ready: boolean;
  settings: TierSettings;
  rows: RosterRow[];
}

/** One row per active staff member who works events, never the viewer. Null for anyone but admins and managers. */
export async function roster(viewer: StaffMember, now: Date = new Date()): Promise<Roster | null> {
  if (!canScore(viewer)) return null;
  const all = (await listStaff()).filter((s) => s.active && s.id !== viewer.id);
  const ids = all.map((s) => s.id);
  const [facts, settings, rated, onboarding, certs, flags] = await Promise.all([
    recordFacts(ids, now),
    tierSettings(),
    ratingsFor(ids),
    onboardingProgress(ids),
    certExpiry(all, now),
    // "*" so the roster still loads before the Manual signed columns exist (they read as not signed).
    rows<SetupFlagRow>(supabase.from("staff_setup_flags").select("*").in("staff_id", ids.length ? ids : ["-"])),
  ]);
  const payroll = new Set(flags.rows.filter((f) => f.payroll_done).map((f) => f.staff_id));
  const manual = new Set(flags.rows.filter((f) => f.manual_done === true).map((f) => f.staff_id));
  const from = since90(now);
  // Admins and managers are listed only when they have worked an event.
  const listed = all.filter((s) => isFieldRole(s.role) || (facts.get(s.id)?.events.length ?? 0) > 0 || rated.ratings.some((r) => r.staff_id === s.id));
  const base = listed.map((s) => {
    const f = facts.get(s.id)!;
    const last90 = computeRecord(f, from);
    const allTime = computeRecord(f, null);
    const lastEnd = f.events.reduce<Date | null>((m, e) => (!m || e.end > m ? e.end : m), null);
    const result = tierFor(ratedEvents(rated.ratings, rated.sessions, s.id), settings);
    return {
      staffId: s.id,
      name: s.name || s.phone,
      role: s.role,
      markets: s.markets,
      marketLabel: s.markets.map((m) => marketLabel(m)).join(", ") || "No market",
      worked: allTime.eventsWorked,
      result,
      rank: null as number | null,
      ranks: {} as Record<string, number>,
      lastEvent: lastEnd ? chicagoToday(lastEnd) : null, // YYYY-MM-DD; pages show it with dateWords
      facts: { late: last90.lateArrivals, noClockOut: last90.missingClockOuts, declined: last90.declines, handedOff: last90.handoffs, noCloseout: last90.missingCloseouts },
      onboarding: { done: onboarding.get(s.id) ?? 0, total: ONBOARDING.length },
      cert: certs[s.id] ?? "",
      payrollDone: payroll.has(s.id),
      manualSigned: manual.has(s.id),
    } satisfies RosterRow;
  });
  const ranks = ranksByMarket(base.map((r) => ({ staffId: r.staffId, name: r.name, markets: r.markets, tier: r.result.tier, lastAvg: r.result.lastAvg, rated: r.result.rated })));
  for (const r of base) {
    for (const m of r.markets) {
      const n = ranks.get(m)?.get(r.staffId);
      if (n) r.ranks[m] = n;
    }
    r.rank = r.markets.length ? (r.ranks[r.markets[0]] ?? null) : null;
  }
  return { ready: rated.ready && flags.ok, settings, rows: base };
}

/** Tier badges for the staffing and assign screens: display only, never the viewer's own. Empty for anyone but admins and managers. */
export async function tierBadges(viewer: StaffMember, staffIds: string[]): Promise<Record<string, string>> {
  if (!canScore(viewer)) return {};
  const ids = [...new Set(staffIds)].filter((id) => id && id !== viewer.id);
  const [settings, rated] = await Promise.all([tierSettings(), ratingsFor(ids)]);
  if (!rated.ready) return {};
  return Object.fromEntries(ids.map((id) => [id, TIER_LABEL[tierFor(ratedEvents(rated.ratings, rated.sessions, id), settings).tier]]));
}

// ----- Worked lines and the To rate list -----

interface AsgWithSession {
  id: string;
  session_id: string;
  staff_id: string;
  status: string;
  session: SessionRow | SessionRow[] | null;
}

const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);

/** Accepted lines on submitted, not hidden events, with when service ended. Never the viewer's own. */
async function workedLines(viewer: StaffMember, staffIds?: string[]) {
  let q = supabase.from("event_assignments").select("id, session_id, staff_id, status, session:session_id (*)").eq("status", "accepted");
  if (staffIds) q = q.in("staff_id", staffIds);
  const [{ rows: asg }, hidden] = await Promise.all([rows<AsgWithSession>(q), hiddenEventIds()]);
  return asg.flatMap((a) => {
    const s = one(a.session);
    if (!s || !showsOnTeam(s) || hidden.has(a.session_id) || a.staff_id === viewer.id) return [];
    const sch = eventSchedule(eventData(s));
    const end = sch.end ?? sch.start;
    return end ? [{ assignmentId: a.id, sessionId: a.session_id, staffId: a.staff_id, end, session: s }] : [];
  });
}

export interface ToRateView {
  sessionId: string;
  title: string;
  day: string | null;
  endedAt: string;
  late: boolean;
  people: { staffId: string; name: string }[];
}

/** Events over in the last 14 days with people not yet rated, oldest first, flagged past 48 hours. */
export async function toRate(viewer: StaffMember, now: Date = new Date()): Promise<ToRateView[] | null> {
  if (!canScore(viewer)) return null;
  const lines = await workedLines(viewer);
  const recent = lines.filter((l) => l.end.getTime() <= now.getTime() && now.getTime() - l.end.getTime() <= 14 * 86_400_000);
  const sessionIds = [...new Set(recent.map((l) => l.sessionId))];
  const [{ rows: done }, staff] = await Promise.all([
    rows<{ session_id: string; staff_id: string }>(supabase.from("staff_ratings").select("session_id, staff_id").in("session_id", sessionIds.length ? sessionIds : ["-"])),
    listStaff(),
  ]);
  const names = new Map(staff.map((s) => [s.id, s.name || s.phone]));
  const list: ToRateEvent[] = toRateList(recent, new Set(done.map((d) => `${d.session_id}|${d.staff_id}`)), now);
  const bySession = new Map(recent.map((l) => [l.sessionId, l.session]));
  return list.map((e) => {
    const s = bySession.get(e.sessionId)!;
    return {
      sessionId: e.sessionId,
      title: adminEventTitle(eventData(s)),
      day: dayOf(s),
      endedAt: e.end.toISOString(),
      late: e.late,
      people: e.staffIds.map((id) => ({ staffId: id, name: names.get(id) ?? "Someone" })).sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
}

export interface RateTeamCard {
  over: boolean;
  people: { staffId: string; name: string; rated: boolean; average: number | null }[];
}

/** The "Rate the team" card on Day of: who worked it (never the viewer) and whether they are rated. */
export async function rateTeamCard(viewer: StaffMember, session: SessionRow, people: { staffId: string; name: string; status: string }[], now: Date = new Date()): Promise<RateTeamCard | null> {
  if (!canScore(viewer)) return null;
  const sch = eventSchedule(eventData(session));
  const end = sch.end ?? sch.start;
  const worked = people.filter((p) => p.status === "accepted" && p.staffId !== viewer.id);
  const { rows: r } = await rows<RatingRow>(supabase.from("staff_ratings").select("*").eq("session_id", session.id));
  return {
    over: !!end && end.getTime() <= now.getTime(),
    people: worked.map((p) => {
      const got = r.find((x) => x.staff_id === p.staffId);
      return { staffId: p.staffId, name: p.name, rated: !!got, average: got ? markAverage(marksOf(got)) : null };
    }),
  };
}

// ----- The rating form -----

export interface EventFacts {
  arrival: string | null; // ISO
  clockIn: string | null; // the corrected time, as the Time page and payroll have it
  clockOut: string | null;
  clockInCorrected: boolean; // an admin added or changed it on the Time page
  clockOutCorrected: boolean;
  arrivalText: string;
  missingClockOut: boolean;
  toolsConfirmedAt: string | null;
  suppliesConfirmedAt: string | null;
  barPhotoAt: string | null;
  closeoutAt: string | null;
  lowStock: { item: string; level: string; at: string }[];
  call: { done: boolean; outcome: Outcome | null; confidence: number | null; notes: string; by: string | null; at: string | null } | null;
}

export interface RateForm {
  ready: boolean;
  sessionId: string;
  staffId: string;
  name: string;
  title: string;
  day: string | null;
  timeZone: string;
  facts: EventFacts;
  suggested: Partial<Record<MarkKey, Suggestion>>;
  rating: (RatingRow & { average: number | null }) | null;
  history: { at: string; by: string; marks: Marks; clientFeedback: string; adminNotes: string }[];
}

async function workedOn(sessionId: string, staffId: string): Promise<{ session: SessionRow; end: Date | null; assignmentId: string } | null> {
  const [{ rows: s }, { rows: a }] = await Promise.all([
    rows<SessionRow>(supabase.from("sessions").select("*").eq("id", sessionId)),
    rows<{ id: string; status: string }>(supabase.from("event_assignments").select("id, status").eq("session_id", sessionId).eq("staff_id", staffId)),
  ]);
  const session = s[0];
  if (!session || !showsOnTeam(session) || a[0]?.status !== "accepted") return null;
  const sch = eventSchedule(eventData(session));
  return { session, end: sch.end ?? sch.start, assignmentId: a[0].id };
}

/** The facts the app already has for one person on one event, the suggestions, the rating and its history. */
export async function rateForm(viewer: StaffMember, sessionId: string, staffId: string, now: Date = new Date()): Promise<Result<{ form: RateForm }>> {
  const g = scoreGuard(viewer, staffId);
  if (!g.ok) return g;
  const w = await workedOn(sessionId, staffId);
  if (!w) return { ok: false, error: "They did not work that event.", status: 404 };
  if (!w.end || w.end.getTime() > now.getTime()) return { ok: false, error: "Rate after the event ends.", status: 409 };
  const ed = eventData(w.session);
  const sch = eventSchedule(ed);
  const by = (t: string, cols: string) => supabase.from(t).select(cols).eq("session_id", sessionId).eq("staff_id", staffId);
  const [clocks, tools, supplies, bars, closeouts, low, calls, rating, staff] = await Promise.all([
    correctedClocks({ assignmentIds: [w.assignmentId] }),
    rows<{ confirmed_at: string }>(by("staff_confirmations", "confirmed_at")),
    rows<{ confirmed_at: string }>(by("staff_supplies_confirmations", "confirmed_at")),
    rows<{ created_at: string }>(by("bar_ready_reports", "created_at")),
    rows<{ submitted_at: string; supplies?: unknown[] | null }>(by("event_closeouts", "*")),
    rows<{ item: string; level: string; created_at: string }>(by("low_stock_reports", "item, level, created_at")),
    rows<CallRow>(by("staff_checkin_calls", "*")),
    rows<RatingRow>(by("staff_ratings", "*")),
    listStaff(),
  ]);
  // The corrected clock in and out, the same values payroll uses.
  const clock = clocks[0];
  const firstIn = clock?.clockIn?.at ?? null;
  const lastOut = clock?.clockOut?.at ?? null;
  const closeout = closeouts.rows[0] ?? null;
  const call = calls.rows[0] ?? null;
  const facts: EventFacts = {
    arrival: sch.arrival?.toISOString() ?? null,
    clockIn: firstIn,
    clockOut: lastOut,
    clockInCorrected: !!clock?.clockIn?.corrected,
    clockOutCorrected: !!clock?.clockOut?.corrected,
    arrivalText: arrivalText(sch.arrival, firstIn ? new Date(firstIn) : null),
    missingClockOut: !!firstIn && !lastOut,
    toolsConfirmedAt: tools.rows[0]?.confirmed_at ?? null,
    suppliesConfirmedAt: supplies.rows[0]?.confirmed_at ?? null,
    barPhotoAt: bars.rows.map((b) => b.created_at).sort()[0] ?? null,
    closeoutAt: closeout?.submitted_at ?? null,
    lowStock: low.rows.map((l) => ({ item: l.item, level: l.level, at: l.created_at })).sort((a, b) => a.at.localeCompare(b.at)),
    call: call ? { done: call.done, outcome: call.outcome, confidence: call.confidence, notes: call.notes, by: call.called_by_name, at: call.called_at } : null,
  };
  const suggested: Partial<Record<MarkKey, Suggestion>> = {
    leftovers: leftoverSuggestion(closeout ? { at: new Date(closeout.submitted_at), counted: Array.isArray(closeout.supplies) && closeout.supplies.length > 0 } : null, w.end),
  };
  const conf = confidenceSuggestion(call);
  if (conf) suggested.confidence = conf;
  const r = rating.rows[0] ?? null;
  const versions = r ? await rows<VersionRow>(supabase.from("staff_rating_versions").select("*").eq("rating_id", r.id)) : { ok: true, rows: [] as VersionRow[] };
  const person = staff.find((s) => s.id === staffId);
  return {
    ok: true,
    form: {
      ready: rating.ok,
      sessionId,
      staffId,
      name: person?.name || person?.phone || "Someone",
      title: adminEventTitle(ed),
      day: sch.day,
      timeZone: sch.tz,
      facts,
      suggested,
      rating: r ? { ...r, average: markAverage(marksOf(r)) } : null,
      history: versions.rows
        .sort((a, b) => b.saved_at.localeCompare(a.saved_at))
        .map((v) => ({ at: v.saved_at, by: v.saved_by_name ?? "", marks: marksOf(v.data as Partial<Record<MarkKey, unknown>>), clientFeedback: String(v.data.client_feedback ?? ""), adminNotes: String(v.data.admin_notes ?? "") })),
    },
  };
}

/** Save a rating: the reviewer's own marks (suggestions only count once they are in the marks sent). */
export async function saveRating(viewer: StaffMember, body: Record<string, unknown>, now: Date = new Date()): Promise<Result<{ id: string }>> {
  const g = scoreGuard(viewer, body.staffId);
  if (!g.ok) return g;
  const sessionId = String(body.sessionId ?? "");
  const staffId = String(body.staffId);
  const v = validateRating(body);
  if (!v.ok) return { ok: false, error: v.error, status: 400 };
  const w = await workedOn(sessionId, staffId);
  if (!w) return { ok: false, error: "They did not work that event.", status: 404 };
  if (!w.end || w.end.getTime() > now.getTime()) return { ok: false, error: "Rate after the event ends.", status: 409 };
  const existing = await rows<RatingRow>(supabase.from("staff_ratings").select("*").eq("session_id", sessionId).eq("staff_id", staffId));
  if (!existing.ok) return NOT_READY_R;
  const at = now.toISOString();
  const fields = {
    ...v.value.marks,
    mark_notes: v.value.markNotes,
    client_feedback: v.value.clientFeedback,
    admin_notes: v.value.adminNotes,
    updated_by: viewer.id,
    updated_by_name: viewer.name,
    updated_at: at,
  };
  const old = existing.rows[0];
  if (old) {
    // The edit history: the save being replaced, with who saved it and when.
    const { id: _id, ...data } = old;
    void _id;
    const h = await supabase.from("staff_rating_versions").insert({ rating_id: old.id, data, saved_by: old.updated_by, saved_by_name: old.updated_by_name, saved_at: old.updated_at });
    if (h.error) return { ok: false, error: "Could not save. Try again.", status: 500 };
    const { error } = await supabase.from("staff_ratings").update(fields).eq("id", old.id);
    if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
    return { ok: true, id: old.id };
  }
  const { data, error } = await supabase
    .from("staff_ratings")
    .insert({ session_id: sessionId, staff_id: staffId, ...fields, rated_by: viewer.id, rated_by_name: viewer.name, rated_at: at })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Could not save. Try again.", status: 500 };
  return { ok: true, id: (data as { id: string }).id };
}

// ----- Reviews -----

export interface ReviewView {
  id: string;
  kind: ReviewKind;
  date: string;
  body: string;
  author: string;
  createdAt: string;
  editedBy: string | null;
  editedAt: string | null;
  canEdit: boolean;
}

const canEditReview = (viewer: StaffMember, r: Pick<ReviewRow, "author_id">) => isFullAdmin(viewer.role) || r.author_id === viewer.id;

export async function addReview(viewer: StaffMember, body: Record<string, unknown>, now: Date = new Date()): Promise<Result<{ id: string }>> {
  const g = scoreGuard(viewer, body.staffId);
  if (!g.ok) return g;
  const v = validateReview(body, chicagoToday(now));
  if (!v.ok) return { ok: false, error: v.error, status: 400 };
  const { data, error } = await supabase
    .from("staff_reviews")
    .insert({ staff_id: body.staffId, kind: v.value.kind, review_date: v.value.date, body: v.value.body, author_id: viewer.id, author_name: viewer.name, created_at: now.toISOString() })
    .select("id")
    .single();
  if (error || !data) return /relation|does not exist/i.test(String(error?.message)) ? NOT_READY_R : { ok: false, error: "Could not save. Try again.", status: 500 };
  return { ok: true, id: (data as { id: string }).id };
}

/** Editable by the author, and by admins. Never about the editor themselves. */
export async function editReview(viewer: StaffMember, body: Record<string, unknown>, now: Date = new Date()): Promise<Result> {
  if (!canScore(viewer)) return FORBIDDEN;
  const found = await rows<ReviewRow>(supabase.from("staff_reviews").select("*").eq("id", String(body.id ?? "")));
  if (!found.ok) return NOT_READY_R;
  const r = found.rows[0];
  if (!r) return { ok: false, error: "We could not find that review.", status: 404 };
  if (r.staff_id === viewer.id) return SELF;
  if (!canEditReview(viewer, r)) return { ok: false, error: "Only the author or an admin can edit this review.", status: 403 };
  const v = validateReview(body, chicagoToday(now));
  if (!v.ok) return { ok: false, error: v.error, status: 400 };
  const { error } = await supabase
    .from("staff_reviews")
    .update({ kind: v.value.kind, review_date: v.value.date, body: v.value.body, updated_by: viewer.id, updated_by_name: viewer.name, updated_at: now.toISOString() })
    .eq("id", r.id);
  if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
  return { ok: true };
}

// ----- Check in calls and Locked by Tuesday -----

export interface CallsEvent {
  sessionId: string;
  title: string;
  day: string | null;
  tuesday: string | null;
  lock: { locked: boolean; by: string | null; at: string | null };
  lockOverdue: boolean;
  people: {
    staffId: string;
    name: string;
    status: string;
    done: boolean;
    outcome: Outcome | null;
    confidence: number | null;
    notes: string;
    by: string | null;
    at: string | null;
    overdue: boolean;
  }[];
}

/** Every event in the next 14 days with each assigned person (never the viewer), soonest first. */
export async function callsView(viewer: StaffMember, now: Date = new Date()): Promise<{ ready: boolean; events: CallsEvent[] } | null> {
  if (!canScore(viewer)) return null;
  const today = chicagoToday(now);
  const end = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10) + CALL_DAYS - 1)).toISOString().slice(0, 10);
  const [{ rows: sessions }, hidden, staff] = await Promise.all([rows<SessionRow>(supabase.from("sessions").select("*").in("status", ["submitted", "in_progress"])), hiddenEventIds(), listStaff()]);
  const upcoming = teamRows(sessions)
    .filter((s) => !hidden.has(s.id))
    .map((s) => ({ s, day: dayOf(s) }))
    .filter((x) => x.day && x.day >= today && x.day <= end)
    .sort((a, b) => a.day!.localeCompare(b.day!));
  const ids = upcoming.map((x) => x.s.id);
  const inIds = ids.length ? ids : ["-"];
  const [{ rows: asg }, calls, locks] = await Promise.all([
    rows<{ session_id: string; staff_id: string; status: string }>(supabase.from("event_assignments").select("session_id, staff_id, status").in("session_id", inIds)),
    rows<CallRow>(supabase.from("staff_checkin_calls").select("*").in("session_id", inIds)),
    rows<LockRow>(supabase.from("event_week_locks").select("*").in("session_id", inIds)),
  ]);
  const names = new Map(staff.map((s) => [s.id, s.name || s.phone]));
  const events = upcoming.map(({ s, day }) => {
    const lock = locks.rows.find((l) => l.session_id === s.id);
    const locked = !!lock?.locked;
    return {
      sessionId: s.id,
      title: adminEventTitle(eventData(s)),
      day,
      tuesday: day ? tuesdayBefore(day) : null,
      lock: { locked, by: lock?.locked_by_name ?? null, at: lock?.locked_at ?? null },
      lockOverdue: lockOverdue(day, locked, today),
      people: asg
        .filter((a) => a.session_id === s.id && a.status !== "declined" && a.staff_id !== viewer.id)
        .map((a) => {
          const c = calls.rows.find((x) => x.session_id === s.id && x.staff_id === a.staff_id);
          return {
            staffId: a.staff_id,
            name: names.get(a.staff_id) ?? "Someone",
            status: a.status,
            done: !!c?.done,
            outcome: c?.outcome ?? null,
            confidence: c?.confidence ?? null,
            notes: c?.notes ?? "",
            by: c?.called_by_name ?? null,
            at: c?.called_at ?? null,
            overdue: callOverdue(day, !!c?.done, today),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  });
  return { ready: calls.ok && locks.ok, events };
}

/** Save one person's call on one event. Records who called and when. */
export async function saveCall(viewer: StaffMember, body: Record<string, unknown>, now: Date = new Date()): Promise<Result> {
  const g = scoreGuard(viewer, body.staffId);
  if (!g.ok) return g;
  const v = validateCall(body);
  if (!v.ok) return { ok: false, error: v.error, status: 400 };
  const sessionId = String(body.sessionId ?? "");
  const { rows: a } = await rows<{ status: string }>(supabase.from("event_assignments").select("status").eq("session_id", sessionId).eq("staff_id", body.staffId as string));
  if (!a[0] || a[0].status === "declined") return { ok: false, error: "They are not on that event.", status: 404 };
  const at = now.toISOString();
  const { error } = await supabase
    .from("staff_checkin_calls")
    .upsert({ session_id: sessionId, staff_id: body.staffId, ...v.value, called_by: viewer.id, called_by_name: viewer.name, called_at: at, updated_at: at }, { onConflict: "session_id,staff_id" });
  if (error) return /relation|does not exist/i.test(error.message) ? NOT_READY_R : { ok: false, error: "Could not save. Try again.", status: 500 };
  return { ok: true };
}

export async function saveLock(viewer: StaffMember, body: Record<string, unknown>, now: Date = new Date()): Promise<Result> {
  if (!canScore(viewer)) return FORBIDDEN;
  const sessionId = String(body.sessionId ?? "");
  const { rows: s } = await rows<{ id: string }>(supabase.from("sessions").select("id").eq("id", sessionId));
  if (!s[0]) return { ok: false, error: "We could not find that event.", status: 404 };
  const locked = body.locked === true;
  const { error } = await supabase
    .from("event_week_locks")
    .upsert({ session_id: sessionId, locked, locked_by: viewer.id, locked_by_name: viewer.name, locked_at: now.toISOString() }, { onConflict: "session_id" });
  if (error) return /relation|does not exist/i.test(error.message) ? NOT_READY_R : { ok: false, error: "Could not save. Try again.", status: 500 };
  return { ok: true };
}

// ----- Setup flags and settings (admins only) -----

/** A setup tick for one person, admins only, recording who and when. Never about yourself. */
async function setSetupFlag(viewer: StaffMember, body: Record<string, unknown>, prefix: "payroll" | "manual", now: Date): Promise<Result> {
  const g = scoreGuard(viewer, body.staffId);
  if (!g.ok) return g;
  if (!isFullAdmin(viewer.role)) return { ok: false, error: "Admins only.", status: 403 };
  const done = body.done === true;
  const { error } = await supabase
    .from("staff_setup_flags")
    .upsert({ staff_id: body.staffId, [`${prefix}_done`]: done, [`${prefix}_by`]: viewer.id, [`${prefix}_by_name`]: viewer.name, [`${prefix}_at`]: now.toISOString() }, { onConflict: "staff_id" });
  if (error) return /relation|does not exist|schema cache|column/i.test(error.message) ? NOT_READY_R : { ok: false, error: "Could not save. Try again.", status: 500 };
  return { ok: true };
}

export function setPayrollDone(viewer: StaffMember, body: Record<string, unknown>, now: Date = new Date()): Promise<Result> {
  return setSetupFlag(viewer, body, "payroll", now);
}

/** Manual signed: admins tick it; it drives the roster flag and the Manual Signed column of the ratings CSV. */
export function setManualSigned(viewer: StaffMember, body: Record<string, unknown>, now: Date = new Date()): Promise<Result> {
  return setSetupFlag(viewer, body, "manual", now);
}

export async function saveTierSettings(viewer: StaffMember, body: Record<string, unknown>, now: Date = new Date()): Promise<Result<{ settings: TierSettings }>> {
  if (!isFullAdmin(viewer.role)) return { ok: false, error: "Admins only.", status: 403 };
  const v = validateTierSettings(body);
  if (!v.ok) return { ok: false, error: v.error, status: 400 };
  const { error } = await supabase.from("team_settings").upsert({ key: SETTINGS_KEY, value: v.value, updated_by: viewer.id, updated_at: now.toISOString() }, { onConflict: "key" });
  if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
  return { ok: true, settings: v.value };
}

// ----- One person's page -----

export interface PersonRating {
  sessionId: string;
  title: string;
  day: string | null;
  marks: Marks;
  markNotes: Partial<Record<MarkKey, string>>;
  clientFeedback: string;
  adminNotes: string;
  ratedBy: string;
  ratedAt: string;
}

export interface PersonCard {
  ready: boolean;
  row: RosterRow;
  settings: TierSettings;
  ratings: PersonRating[];
  calls: { sessionId: string; title: string; day: string | null; done: boolean; outcome: Outcome | null; confidence: number | null; notes: string; by: string | null; at: string | null }[];
  reviews: ReviewView[];
  payroll: { done: boolean; by: string | null; at: string | null };
  manual: { done: boolean; by: string | null; at: string | null };
  canTick: boolean; // admins tick the setup flags; managers see them read only
}

/** One person's scorecard. Never the viewer's own; null for anyone but admins and managers. */
export async function personCard(viewer: StaffMember, staffId: string, now: Date = new Date()): Promise<Result<{ card: PersonCard }>> {
  const g = scoreGuard(viewer, staffId);
  if (!g.ok) return g;
  const r = await roster(viewer, now);
  const row = r?.rows.find((x) => x.staffId === staffId);
  if (!r || !row) return { ok: false, error: "We could not find that person.", status: 404 };
  const [rated, calls, reviews, flag] = await Promise.all([
    ratingsFor([staffId]),
    rows<CallRow>(supabase.from("staff_checkin_calls").select("*").eq("staff_id", staffId)),
    rows<ReviewRow>(supabase.from("staff_reviews").select("*").eq("staff_id", staffId)),
    rows<SetupFlagRow>(supabase.from("staff_setup_flags").select("*").eq("staff_id", staffId)),
  ]);
  const callSessions = await sessionsById(calls.rows.map((c) => c.session_id));
  const title = (s: SessionRow | undefined) => (s ? adminEventTitle(eventData(s)) : "Event");
  return {
    ok: true,
    card: {
      ready: r.ready && calls.ok && reviews.ok,
      row,
      settings: r.settings,
      ratings: rated.ratings.map((x) => ({
        sessionId: x.session_id,
        title: title(rated.sessions.get(x.session_id)),
        day: dayOf(rated.sessions.get(x.session_id)),
        marks: marksOf(x),
        markNotes: x.mark_notes ?? {},
        clientFeedback: x.client_feedback,
        adminNotes: x.admin_notes,
        ratedBy: x.rated_by_name ?? "",
        ratedAt: x.rated_at,
      })),
      calls: calls.rows
        .map((c) => ({ sessionId: c.session_id, title: title(callSessions.get(c.session_id)), day: dayOf(callSessions.get(c.session_id)), done: c.done, outcome: c.outcome, confidence: c.confidence, notes: c.notes, by: c.called_by_name, at: c.called_at }))
        .sort((a, b) => (b.day ?? "").localeCompare(a.day ?? "")),
      reviews: reviews.rows
        .sort((a, b) => b.review_date.localeCompare(a.review_date) || b.created_at.localeCompare(a.created_at))
        .map((x) => ({ id: x.id, kind: x.kind, date: x.review_date, body: x.body, author: x.author_name ?? "", createdAt: x.created_at, editedBy: x.updated_by_name, editedAt: x.updated_at, canEdit: canEditReview(viewer, x) })),
      payroll: { done: !!flag.rows[0]?.payroll_done, by: flag.rows[0]?.payroll_by_name ?? null, at: flag.rows[0]?.payroll_at ?? null },
      manual: { done: flag.rows[0]?.manual_done === true, by: flag.rows[0]?.manual_by_name ?? null, at: flag.rows[0]?.manual_at ?? null },
      canTick: isFullAdmin(viewer.role),
    },
  };
}

// ----- Exports -----

export async function rosterCsvFor(viewer: StaffMember, now: Date = new Date()): Promise<string | null> {
  const r = await roster(viewer, now);
  return r ? rosterCsv(r.rows) : null;
}

/** Every rating, one row per person per event, never the viewer's own. */
export async function ratingsCsvFor(viewer: StaffMember, now: Date = new Date()): Promise<string | null> {
  const r = await roster(viewer, now);
  if (!r) return null;
  const ids = r.rows.map((x) => x.staffId);
  const rated = await ratingsFor(ids);
  const sessionIds = [...new Set(rated.ratings.map((x) => x.session_id))];
  const inIds = sessionIds.length ? sessionIds : ["-"];
  const [calls, locks, closeouts] = await Promise.all([
    rows<CallRow>(supabase.from("staff_checkin_calls").select("session_id, staff_id, done").in("session_id", inIds)),
    rows<LockRow>(supabase.from("event_week_locks").select("session_id, locked").in("session_id", inIds)),
    rows<{ session_id: string; staff_id: string }>(supabase.from("event_closeouts").select("session_id, staff_id").in("session_id", inIds)),
  ]);
  const byId = new Map(r.rows.map((x) => [x.staffId, x]));
  const out: RatingCsvRow[] = rated.ratings
    .filter((x) => x.staff_id !== viewer.id && byId.has(x.staff_id))
    .map((x) => {
      const s = rated.sessions.get(x.session_id);
      const ed = s ? eventData(s) : {};
      const person = byId.get(x.staff_id)!;
      const call = calls.rows.find((c) => c.session_id === x.session_id && c.staff_id === x.staff_id);
      const lock = locks.rows.find((l) => l.session_id === x.session_id);
      return {
        day: dayOf(s),
        event: adminEventTitle(ed),
        pkg: scrub(ed.package) || scrub(s?.package_type),
        client: scrub(ed.client_name),
        person: person.name,
        callDone: call ? call.done : false,
        locked: lock ? lock.locked : false,
        manualSigned: person.manualSigned,
        marks: marksOf(x),
        tier: person.result.tier as Tier,
        clientFeedback: x.client_feedback,
        adminNotes: x.admin_notes,
        leftoverIn: closeouts.rows.some((c) => c.session_id === x.session_id && c.staff_id === x.staff_id),
      };
    })
    .sort((a, b) => (b.day ?? "").localeCompare(a.day ?? "") || a.person.localeCompare(b.person));
  return ratingsCsv(out);
}

