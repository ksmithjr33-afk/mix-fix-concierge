// Database side of open shifts, shift requests, and shift handoffs. Server only.
//
// Texts go through sendStaffText, which never throws, so a failed text never
// blocks or undoes the action that sent it. Bartenders only ever see a posted
// shift in one of their markets, built by shiftSummary() from an allowlist.

import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import { bartendersNeeded, firstName, type StaffMember } from "@/lib/team/event-view";
import { eventTitle } from "@/lib/team/event-list";
import { alertAdmins, getSubmittedSession } from "@/lib/team/events";
import { claimNotice, hasPunches, siteOrigin } from "@/lib/team/clock-db";
import { hiddenEventIds, isHidden } from "@/lib/team/hidden";
import { sendStaffText } from "@/lib/team/sms";
import { ensureMarket, staffMarkets } from "@/lib/team/markets-db";
import { eventData, sessionMarket, staffMarketsOf, type Market } from "@/lib/team/markets";
import { staffingCounts, type AssignmentStatus } from "@/lib/team/assignments";
import { eventDay, eventSchedule, formatClock, shortDate, todayIn } from "@/lib/team/time";
import {
  ACTIVE_HANDOFF,
  canSeePost,
  filledText,
  firstRequestText,
  gotShiftText,
  handoffAdminText,
  handoffAskText,
  handoffCancelledText,
  handoffError,
  isUrgent,
  noLongerNeededText,
  overlaps,
  postError,
  postText,
  releasedText,
  shiftSummary,
  shortAlertDue,
  shortShiftText,
  stillOnShiftText,
  teammateDeclinedText,
  teammateError,
  workWindow,
  type HandoffMode,
  type HandoffRow,
  type PostRow,
  type RequestStatus,
  type ShiftSummary,
} from "@/lib/team/shifts";

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number };

type StaffFull = StaffMember & { markets?: unknown };

const fail = (error: string, status = 409) => ({ ok: false as const, error, status });

// ----- Lookups -----

async function staffById(id: string): Promise<StaffFull | null> {
  const { data } = await supabase.from("staff").select("*").eq("id", id).maybeSingle();
  return (data as StaffFull | null) ?? null;
}

async function staffByIds(ids: string[]): Promise<Map<string, StaffFull>> {
  if (ids.length === 0) return new Map();
  const { data } = await supabase.from("staff").select("*").in("id", ids);
  return new Map(((data as StaffFull[]) ?? []).map((s) => [s.id, s]));
}

interface AssignmentLite {
  id?: string;
  session_id: string;
  staff_id: string;
  status: AssignmentStatus;
}

async function assignmentsOf(sessionId: string): Promise<AssignmentLite[]> {
  const { data, error } = await supabase.from("event_assignments").select("id, session_id, staff_id, status").eq("session_id", sessionId);
  if (error) throw new Error(`event_assignments lookup failed: ${error.message}`);
  return (data as AssignmentLite[]) ?? [];
}

/** Spots still open on an event: bartenders needed minus everyone offered or accepted. */
async function spotsOpen(session: SessionRow): Promise<number> {
  const rows = await assignmentsOf(session.id);
  return staffingCounts(bartendersNeeded(session), rows.map((r) => r.status)).stillNeeded;
}

function isPast(session: SessionRow, now: Date = new Date()): boolean {
  const ed = eventData(session);
  const s = eventSchedule(ed);
  return !!s.day && s.day < todayIn(s.tz, now);
}

async function postById(id: string): Promise<PostRow | null> {
  const { data, error } = await supabase.from("shift_posts").select("*").eq("id", id).maybeSingle();
  if (error) return null;
  return (data as PostRow | null) ?? null;
}

/** The event's posted open shift, if any. Null before the table exists. */
export async function activeOpenPost(sessionId: string): Promise<PostRow | null> {
  const { data, error } = await supabase.from("shift_posts").select("*").eq("session_id", sessionId).eq("kind", "open").eq("status", "posted").maybeSingle();
  if (error) return null;
  return (data as PostRow | null) ?? null;
}

async function handoffById(id: string): Promise<HandoffRow | null> {
  const { data, error } = await supabase.from("shift_handoffs").select("*").eq("id", id).maybeSingle();
  if (error) return null;
  return (data as HandoffRow | null) ?? null;
}

async function coverPostFor(handoffId: string): Promise<PostRow | null> {
  const { data } = await supabase.from("shift_posts").select("*").eq("handoff_id", handoffId).maybeSingle();
  return (data as PostRow | null) ?? null;
}

async function activeHandoffRow(sessionId: string, staffId: string): Promise<HandoffRow | null> {
  const { data, error } = await supabase.from("shift_handoffs").select("*").eq("session_id", sessionId).eq("from_staff_id", staffId).in("status", ACTIVE_HANDOFF);
  if (error) return null;
  return ((data as HandoffRow[]) ?? [])[0] ?? null;
}

function facts(session: SessionRow) {
  const ed = eventData(session);
  const s = eventSchedule(ed);
  return { ed, date: shortDate(eventDay(ed.event_date)), arrival: s.arrivalMin === null ? "" : formatClock(s.arrivalMin), title: eventTitle(ed) };
}

const eventLink = (id: string) => `${siteOrigin()}/team/e/${id}`;
const adminLink = (id: string) => `${siteOrigin()}/team/admin/e/${id}`;
const shiftLink = (postId: string) => `${siteOrigin()}/team/shifts/${postId}`;
const handoffLink = (id: string) => `${siteOrigin()}/team/handoff/${id}`;

async function textAdmins(message: string): Promise<number> {
  const admins = await alertAdmins();
  const sent = await Promise.all(admins.map((a) => sendStaffText(a.phone, a.name, message)));
  return sent.filter(Boolean).length;
}

/** Text every active bartender in the post's market, except anyone already on the event (and whoever is handing it off). */
async function notifyMarket(post: PostRow, session: SessionRow, exclude: Set<string>): Promise<number> {
  const { data } = await supabase.from("staff").select("*").eq("active", true).eq("role", "bartender");
  const onEvent = new Set((await assignmentsOf(session.id)).filter((a) => a.status !== "declined").map((a) => a.staff_id));
  const people = ((data as StaffFull[]) ?? []).filter((s) => staffMarketsOf(s).includes(post.market) && !onEvent.has(s.id) && !exclude.has(s.id));
  if (people.length === 0) return 0;
  const message = postText(shiftSummary(session, post, post.kind === "cover" ? 1 : await spotsOpen(session)), shiftLink(post.id));
  const sent = await Promise.all(people.map((s) => sendStaffText(s.phone, s.name, message)));
  return sent.filter(Boolean).length;
}

/** Close a post as filled or unposted. Everyone still waiting is texted, except people now on the event. */
async function closePost(post: PostRow, session: SessionRow, status: "filled" | "unposted", by: string | null, text: "filled" | "gone" | "none"): Promise<void> {
  const { error } = await supabase.from("shift_posts").update({ status, closed_at: new Date().toISOString(), closed_by: by }).eq("id", post.id).eq("status", "posted");
  if (error) throw new Error(`closing the shift failed: ${error.message}`);
  const { data } = await supabase.from("shift_requests").select("staff_id, status").eq("post_id", post.id).eq("status", "requested");
  const waiting = ((data as { staff_id: string }[]) ?? []).map((r) => r.staff_id);
  await supabase
    .from("shift_requests")
    .update({ status: status === "filled" ? "not_chosen" : "closed", updated_at: new Date().toISOString() })
    .eq("post_id", post.id)
    .eq("status", "requested");
  if (text === "none" || waiting.length === 0) return;
  const onEvent = new Set((await assignmentsOf(session.id)).filter((a) => a.status !== "declined").map((a) => a.staff_id));
  const people = await staffByIds(waiting.filter((id) => !onEvent.has(id)));
  const date = facts(session).date;
  const message = text === "filled" ? filledText({ date }) : noLongerNeededText({ date });
  await Promise.all([...people.values()].filter((s) => s.active).map((s) => sendStaffText(s.phone, s.name, message)));
}

// ----- Posting -----

/** Post an event's unfilled spots to its market and text every active bartender there. */
export async function postShift(session: SessionRow, admin: StaffMember): Promise<Result<{ postId: string; notified: number }>> {
  const hidden = await isHidden(session.id);
  const market = hidden ? sessionMarket(session) : await ensureMarket(session);
  const err = postError({ hidden, market, spotsOpen: await spotsOpen(session), alreadyPosted: !!(await activeOpenPost(session.id)), past: isPast(session) });
  if (err) return fail(err);
  const { data, error } = await supabase
    .from("shift_posts")
    .insert({ session_id: session.id, market, kind: "open", status: "posted", posted_by: admin.id, posted_at: new Date().toISOString() })
    .select("*")
    .single();
  if (error) return fail(/duplicate key|unique/i.test(error.message) ? "This shift is already posted." : "Could not post. Try again.");
  const post = data as PostRow;
  const notified = await notifyMarket(post, session, new Set());
  return { ok: true, postId: post.id, notified };
}

/** Post every upcoming, visible event that still has open spots and is not posted yet (in one market, when given). */
export async function postAllUnstaffed(admin: StaffMember, market: Market | null = null): Promise<{ posted: number; notified: number; noMarket: number }> {
  const { data } = await supabase.from("sessions").select("*").eq("status", "submitted");
  const hidden = await hiddenEventIds();
  const out = { posted: 0, notified: 0, noMarket: 0 };
  for (const s of (data as SessionRow[]) ?? []) {
    if (hidden.has(s.id) || isPast(s) || !eventSchedule(eventData(s)).day) continue;
    if (market && (await ensureMarket(s)) !== market) continue;
    if ((await spotsOpen(s)) <= 0 || (await activeOpenPost(s.id))) continue;
    const r = await postShift(s, admin);
    if (r.ok) {
      out.posted++;
      out.notified += r.notified;
    } else if (/market/i.test(r.error)) out.noMarket++;
  }
  return out;
}

/** Take an open shift down. Requests close without a text. */
export async function unpostShift(postId: string, admin: StaffMember): Promise<Result> {
  const post = await postById(postId);
  if (!post || post.status !== "posted") return fail("This shift is not posted.", 404);
  if (post.kind === "cover") return fail("This is a cover request. Approve or decline the handoff instead.");
  const session = await getSubmittedSession(post.session_id);
  if (!session) return fail("We could not find that event.", 404);
  await closePost(post, session, "unposted", admin.id, "none");
  return { ok: true };
}

/** After someone is assigned directly: if that filled the last spot, the open shift closes and everyone waiting is texted. */
export async function closeIfFilled(session: SessionRow): Promise<boolean> {
  const post = await activeOpenPost(session.id);
  if (!post || (await spotsOpen(session)) > 0) return false;
  await closePost(post, session, "filled", null, "filled");
  return true;
}

// ----- Bartender side -----

export interface SameDayEvent {
  title: string;
  arrival: string;
  overlaps: boolean;
}

export interface OpenShiftItem {
  shift: ShiftSummary;
  myRequest: RequestStatus | null;
  sameDay: SameDayEvent[];
}

/** The staff member's own events on that day (offered or accepted), and whether each overlaps the shift. */
async function sameDayEvents(staffId: string, shift: ShiftSummary): Promise<SameDayEvent[]> {
  if (!shift.day) return [];
  const { data } = await supabase.from("event_assignments").select("session_id, status, session:session_id (*)").eq("staff_id", staffId).neq("status", "declined");
  const out: SameDayEvent[] = [];
  for (const a of (data as { session_id: string; session: SessionRow | SessionRow[] | null }[]) ?? []) {
    const s = Array.isArray(a.session) ? a.session[0] : a.session;
    if (!s || s.id === shift.sessionId || s.status !== "submitted") continue;
    const ed = eventData(s);
    const sch = eventSchedule(ed);
    if (sch.day !== shift.day) continue;
    const w = workWindow(ed);
    out.push({
      title: eventTitle(ed),
      arrival: sch.arrivalMin === null ? "" : formatClock(sch.arrivalMin),
      overlaps: overlaps(shift.window, { from: w.from?.toISOString() ?? null, to: w.to?.toISOString() ?? null }),
    });
  }
  return out;
}

/**
 * Whether this staff member may see and request the post. Posted to one of
 * their markets, a visible upcoming event, not already on it, and not their
 * own handoff.
 */
async function visiblePost(post: PostRow, staff: StaffFull): Promise<{ session: SessionRow; spots: number } | null> {
  const markets = await staffMarkets(staff.id);
  if (!canSeePost({ ...staff, markets }, post)) return null;
  const session = await getSubmittedSession(post.session_id);
  if (!session || (await isHidden(session.id)) || isPast(session)) return null;
  const mine = (await assignmentsOf(session.id)).find((a) => a.staff_id === staff.id);
  if (mine && mine.status !== "declined") return null;
  let spots = 1;
  if (post.kind === "cover") {
    const h = post.handoff_id ? await handoffById(post.handoff_id) : null;
    if (!h || h.status !== "open" || h.from_staff_id === staff.id) return null;
  } else {
    spots = await spotsOpen(session);
    if (spots <= 0) return null;
  }
  return { session, spots };
}

async function myRequestStatus(postId: string, staffId: string): Promise<RequestStatus | null> {
  const { data } = await supabase.from("shift_requests").select("status").eq("post_id", postId).eq("staff_id", staffId).maybeSingle();
  return ((data as { status: RequestStatus } | null)?.status as RequestStatus) ?? null;
}

/** Posted shifts in the staff member's markets that they can request. */
export async function openShiftsFor(staff: StaffMember): Promise<OpenShiftItem[]> {
  const markets = await staffMarkets(staff.id);
  const { data, error } = await supabase.from("shift_posts").select("*").eq("status", "posted").in("market", markets);
  if (error) return []; // before the tables exist
  const out: OpenShiftItem[] = [];
  for (const post of (data as PostRow[]) ?? []) {
    const v = await visiblePost(post, staff);
    if (!v) continue;
    const shift = shiftSummary(v.session, post, v.spots);
    out.push({ shift, myRequest: await myRequestStatus(post.id, staff.id), sameDay: await sameDayEvents(staff.id, shift) });
  }
  return out.sort((a, b) => (a.shift.window.from ?? "9").localeCompare(b.shift.window.from ?? "9"));
}

export type ShiftPage = { state: "open"; item: OpenShiftItem } | { state: "got"; sessionId: string } | { state: "gone" };

/** One posted shift for the detail page. "gone" when it is not open to this staff member. */
export async function shiftForStaff(postId: string, staff: StaffMember): Promise<ShiftPage> {
  const post = await postById(postId);
  if (!post) return { state: "gone" };
  const mine = await myRequestStatus(postId, staff.id);
  if (mine === "approved") return { state: "got", sessionId: post.session_id };
  const v = await visiblePost(post, staff);
  if (!v) return { state: "gone" };
  const shift = shiftSummary(v.session, post, v.spots);
  return { state: "open", item: { shift, myRequest: mine, sameDay: await sameDayEvents(staff.id, shift) } };
}

/** Ask for a shift. Allowed with a warning when it overlaps another event they are on. Admins hear about the first request. */
export async function requestShift(postId: string, staff: StaffMember): Promise<Result<{ overlap: boolean }>> {
  const post = await postById(postId);
  const v = post ? await visiblePost(post, staff) : null;
  if (!post || !v) return fail("This shift is no longer open.", 404);
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("shift_requests")
    .upsert({ post_id: postId, staff_id: staff.id, status: "requested", requested_at: now, updated_at: now }, { onConflict: "post_id,staff_id" });
  if (error) throw new Error(`shift request failed: ${error.message}`);
  const shift = shiftSummary(v.session, post, v.spots);
  const overlap = (await sameDayEvents(staff.id, shift)).some((e) => e.overlaps);
  if (await claimNotice(`shift_first_request:${postId}`, "shift_first_request")) {
    const f = facts(v.session);
    await textAdmins(firstRequestText({ name: staff.name, title: f.title, date: f.date, link: adminLink(v.session.id) }));
  }
  return { ok: true, overlap };
}

export async function withdrawRequest(postId: string, staff: StaffMember): Promise<Result> {
  const { data, error } = await supabase
    .from("shift_requests")
    .update({ status: "withdrawn", updated_at: new Date().toISOString() })
    .eq("post_id", postId)
    .eq("staff_id", staff.id)
    .eq("status", "requested")
    .select("id");
  if (error) throw new Error(`withdraw failed: ${error.message}`);
  if (!data || (data as unknown[]).length === 0) return fail("You have not requested this shift.", 404);
  return { ok: true };
}

// ----- Admin side -----

export interface Requester {
  staffId: string;
  name: string;
  requestedAt: string;
  eventsWorked: number;
  sameDay: string[]; // "Maria · Wedding, arrive 3:00 PM"
  onEvent: boolean;
}

export interface PostPanel {
  post: PostRow | null; // the posted open shift
  requesters: Requester[];
  spotsOpen: number;
  market: Market | null;
  hidden: boolean;
}

export interface HandoffPanelRow {
  id: string;
  mode: HandoffMode;
  status: HandoffRow["status"];
  urgent: boolean;
  reason: string;
  fromName: string;
  teammateName: string;
  createdAt: string;
  postId: string | null;
  requesters: Requester[];
}

async function requestersFor(post: PostRow, session: SessionRow): Promise<Requester[]> {
  const { data } = await supabase.from("shift_requests").select("staff_id, status, requested_at").eq("post_id", post.id).eq("status", "requested");
  const reqs = ((data as { staff_id: string; requested_at: string }[]) ?? []).sort((a, b) => a.requested_at.localeCompare(b.requested_at));
  if (reqs.length === 0) return [];
  const people = await staffByIds(reqs.map((r) => r.staff_id));
  const onEvent = new Set((await assignmentsOf(session.id)).filter((a) => a.status !== "declined").map((a) => a.staff_id));
  const day = eventSchedule(eventData(session)).day;
  const out: Requester[] = [];
  for (const r of reqs) {
    const { data: theirs } = await supabase.from("event_assignments").select("session_id, status, session:session_id (*)").eq("staff_id", r.staff_id).eq("status", "accepted");
    let worked = 0;
    const sameDay: string[] = [];
    for (const a of (theirs as { session: SessionRow | SessionRow[] | null }[]) ?? []) {
      const s = Array.isArray(a.session) ? a.session[0] : a.session;
      if (!s || s.id === session.id) continue;
      const ed = eventData(s);
      const sch = eventSchedule(ed);
      if (sch.day && sch.day < todayIn(sch.tz)) worked++;
      if (day && sch.day === day) sameDay.push([eventTitle(ed), sch.arrivalMin === null ? "" : `arrive ${formatClock(sch.arrivalMin)}`].filter(Boolean).join(", "));
    }
    out.push({ staffId: r.staff_id, name: people.get(r.staff_id)?.name || "Unknown staff member", requestedAt: r.requested_at, eventsWorked: worked, sameDay, onEvent: onEvent.has(r.staff_id) });
  }
  return out;
}

export async function postPanel(session: SessionRow): Promise<PostPanel> {
  const post = await activeOpenPost(session.id);
  return {
    post,
    requesters: post ? await requestersFor(post, session) : [],
    spotsOpen: await spotsOpen(session),
    market: sessionMarket(session),
    hidden: await isHidden(session.id),
  };
}

/** Handoffs still waiting on someone, for the admin event page. */
export async function handoffPanel(session: SessionRow): Promise<HandoffPanelRow[]> {
  const { data, error } = await supabase.from("shift_handoffs").select("*").eq("session_id", session.id).in("status", ACTIVE_HANDOFF);
  if (error) return [];
  const rows = (data as HandoffRow[]) ?? [];
  const people = await staffByIds([...new Set(rows.flatMap((h) => [h.from_staff_id, h.to_staff_id].filter((x): x is string => !!x)))]);
  return Promise.all(
    rows.map(async (h) => {
      const post = h.mode === "market" ? await coverPostFor(h.id) : null;
      return {
        id: h.id,
        mode: h.mode,
        status: h.status,
        urgent: h.urgent,
        reason: h.reason,
        fromName: people.get(h.from_staff_id)?.name || "Unknown staff member",
        teammateName: h.to_staff_id ? people.get(h.to_staff_id)?.name || "" : "",
        createdAt: h.created_at,
        postId: post?.status === "posted" ? post.id : null,
        requesters: post?.status === "posted" ? await requestersFor(post, session) : [],
      };
    })
  );
}

/**
 * Approve a requester. For an open shift they become an accepted assignment
 * (no accept step) and get a text; when the last spot fills the shift closes
 * and everyone else who asked is texted. For a cover post this approves the
 * handoff to them.
 */
export async function approveRequest(admin: StaffMember, postId: string, staffId: string): Promise<Result> {
  const post = await postById(postId);
  if (!post || post.status !== "posted") return fail("This shift is not posted any more.", 404);
  const req = await myRequestStatus(postId, staffId);
  if (req !== "requested") return fail("That person has not requested this shift.", 404);
  const session = await getSubmittedSession(post.session_id);
  if (!session) return fail("We could not find that event.", 404);
  if (post.kind === "cover") {
    const h = post.handoff_id ? await handoffById(post.handoff_id) : null;
    if (!h || h.status !== "open") return fail("This handoff is not open any more.");
    return completeHandoff(h, staffId, admin);
  }
  if ((await spotsOpen(session)) <= 0) return fail("No open spots left on this event.");
  const person = await staffById(staffId);
  if (!person || !person.active) return fail("That person is not on the active team.", 404);
  const existing = (await assignmentsOf(session.id)).find((a) => a.staff_id === staffId);
  if (existing && existing.status !== "declined") return fail(`${firstName(person.name) || "They"} is already on this event.`);

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("event_assignments")
    .upsert({ session_id: session.id, staff_id: staffId, status: "accepted", assigned_at: now, responded_at: now, assigned_by: admin.id }, { onConflict: "session_id,staff_id" });
  if (error) throw new Error(`assign failed: ${error.message}`);
  await supabase.from("shift_requests").update({ status: "approved", updated_at: now }).eq("post_id", postId).eq("staff_id", staffId);
  await sendStaffText(person.phone, person.name, gotShiftText({ date: facts(session).date, link: eventLink(session.id) }));
  if ((await spotsOpen(session)) <= 0) await closePost(post, session, "filled", admin.id, "filled");
  return { ok: true };
}

// ----- Handoffs -----

export interface MyHandoff {
  id: string;
  mode: HandoffMode;
  status: HandoffRow["status"];
  teammateName: string;
  requests: number;
}

/** The staff member's open handoff on this event, for their event page. */
export async function myHandoff(sessionId: string, staffId: string): Promise<MyHandoff | null> {
  const h = await activeHandoffRow(sessionId, staffId);
  if (!h) return null;
  const teammate = h.to_staff_id ? await staffById(h.to_staff_id) : null;
  let requests = 0;
  if (h.mode === "market") {
    const post = await coverPostFor(h.id);
    if (post) {
      const { data } = await supabase.from("shift_requests").select("id").eq("post_id", post.id).eq("status", "requested");
      requests = ((data as unknown[]) ?? []).length;
    }
  }
  return { id: h.id, mode: h.mode, status: h.status, teammateName: teammate?.name ?? "", requests };
}

/** Teammates a bartender can offer the shift to: active, in the event's market, not already on the event. */
export async function teammateChoices(session: SessionRow, staffId: string): Promise<{ id: string; name: string }[]> {
  const market = sessionMarket(session);
  if (!market) return [];
  const { data } = await supabase.from("staff").select("*").eq("active", true);
  const onEvent = new Set((await assignmentsOf(session.id)).filter((a) => a.status !== "declined").map((a) => a.staff_id));
  return ((data as StaffFull[]) ?? [])
    .filter((s) => s.id !== staffId && !onEvent.has(s.id) && staffMarketsOf(s).includes(market) && s.name)
    .map((s) => ({ id: s.id, name: s.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * "Give up this shift": offer it to a named teammate, or open it to the
 * market. The bartender stays assigned and responsible until an admin
 * approves a replacement. Not allowed after clocking in.
 */
export async function startHandoff(
  session: SessionRow,
  staff: StaffMember,
  o: { mode: unknown; reason: unknown; teammateId?: unknown },
  now: Date = new Date()
): Promise<Result<{ handoffId: string }>> {
  const mine = (await assignmentsOf(session.id)).find((a) => a.staff_id === staff.id);
  const reason = String(o.reason ?? "").trim().slice(0, 500);
  const err = handoffError({
    status: mine?.status ?? null,
    hasPunches: await hasPunches(session.id, staff.id),
    activeHandoff: !!(await activeHandoffRow(session.id, staff.id)),
    reason,
    mode: o.mode,
    past: isPast(session, now),
  });
  if (err) return fail(err, mine?.status === "accepted" ? 409 : 403);
  const mode = o.mode as HandoffMode;
  const market = await ensureMarket(session);
  let teammate: StaffFull | null = null;
  if (mode === "teammate") {
    teammate = typeof o.teammateId === "string" ? await staffById(o.teammateId) : null;
    const onEvent = !!teammate && (await assignmentsOf(session.id)).some((a) => a.staff_id === teammate!.id && a.status !== "declined");
    const tErr = teammateError({ teammate, market, onEvent, self: o.teammateId === staff.id });
    if (tErr) return fail(tErr, 400);
  } else if (!market) {
    return fail("This event has no market yet, so it cannot be opened to the market. Text us at 469 754 8512.");
  }
  const ed = eventData(session);
  const urgent = isUrgent(ed, now);
  const { data, error } = await supabase
    .from("shift_handoffs")
    .insert({
      session_id: session.id,
      from_staff_id: staff.id,
      mode,
      to_staff_id: teammate?.id ?? null,
      reason,
      status: mode === "teammate" ? "asked" : "open",
      urgent,
      created_at: now.toISOString(),
    })
    .select("*")
    .single();
  if (error) return fail(/duplicate key|unique/i.test(error.message) ? "You already asked to give up this shift." : "Could not save. Try again.");
  const h = data as HandoffRow;
  const f = facts(session);

  if (teammate) {
    await sendStaffText(teammate.phone, teammate.name, handoffAskText({ teammate: teammate.name, from: staff.name, date: f.date, arrival: f.arrival, link: handoffLink(h.id) }));
  } else {
    const { data: postRow, error: postErr } = await supabase
      .from("shift_posts")
      .insert({ session_id: session.id, market, kind: "cover", handoff_id: h.id, status: "posted", posted_by: null, posted_at: now.toISOString() })
      .select("*")
      .single();
    if (postErr) {
      await supabase.from("shift_handoffs").update({ status: "cancelled" }).eq("id", h.id);
      return fail("Could not open it to the market. Try again.");
    }
    await notifyMarket(postRow as PostRow, session, new Set([staff.id]));
    await textAdmins(handoffAdminText({ urgent, mode, from: staff.name, title: f.title, date: f.date, reason, link: adminLink(session.id) }));
  }
  return { ok: true, handoffId: h.id };
}

/** What the named teammate sees: the same allowlisted shift summary as an open shift. */
export async function handoffForTeammate(
  handoffId: string,
  staff: StaffMember
): Promise<{ handoff: HandoffRow; shift: ShiftSummary; fromName: string; sameDay: SameDayEvent[] } | null> {
  const h = await handoffById(handoffId);
  if (!h || h.mode !== "teammate" || h.to_staff_id !== staff.id || !staff.active) return null;
  const session = await getSubmittedSession(h.session_id);
  if (!session || !sessionMarket(session)) return null;
  const from = await staffById(h.from_staff_id);
  const shift = shiftSummary(session, { id: h.id, kind: "cover", market: sessionMarket(session)! }, 1);
  return { handoff: h, shift, fromName: firstName(from?.name), sameDay: await sameDayEvents(staff.id, shift) };
}

/** The named teammate accepts (admins with alerts on are texted to approve) or declines (the original bartender is texted). */
export async function respondHandoff(handoffId: string, staff: StaffMember, response: unknown, now: Date = new Date()): Promise<Result> {
  if (response !== "accept" && response !== "decline") return fail("Bad request", 400);
  const h = await handoffById(handoffId);
  if (!h || h.mode !== "teammate" || h.to_staff_id !== staff.id) return fail("This request is not for you.", 403);
  if (h.status !== "asked") return fail("This request was already answered or cancelled.");
  const session = await getSubmittedSession(h.session_id);
  if (!session) return fail("We could not find that event.", 404);
  const from = await staffById(h.from_staff_id);
  const f = facts(session);
  if (response === "decline") {
    await supabase.from("shift_handoffs").update({ status: "teammate_declined", responded_at: now.toISOString() }).eq("id", h.id).eq("status", "asked");
    if (from) await sendStaffText(from.phone, from.name, teammateDeclinedText({ from: from.name, teammate: staff.name, date: f.date }));
    return { ok: true };
  }
  const onEvent = (await assignmentsOf(session.id)).some((a) => a.staff_id === staff.id && a.status !== "declined");
  if (onEvent) return fail("You are already on this event.");
  await supabase.from("shift_handoffs").update({ status: "teammate_accepted", responded_at: now.toISOString() }).eq("id", h.id).eq("status", "asked");
  const urgent = h.urgent || isUrgent(eventData(session), now);
  await textAdmins(handoffAdminText({ urgent, mode: "teammate", from: from?.name ?? "", teammate: staff.name, title: f.title, date: f.date, reason: h.reason, link: adminLink(session.id) }));
  return { ok: true };
}

/** Close a handoff that will not happen: its cover post comes down and anyone waiting is told. */
async function closeHandoff(h: HandoffRow, session: SessionRow | null, status: "cancelled" | "admin_declined", by: string | null): Promise<void> {
  await supabase.from("shift_handoffs").update({ status, decided_by: by, decided_at: new Date().toISOString() }).eq("id", h.id);
  if (!session) return;
  const post = h.mode === "market" ? await coverPostFor(h.id) : null;
  if (post && post.status === "posted") await closePost(post, session, "unposted", by, "gone");
  if (h.mode === "teammate" && h.to_staff_id) {
    const [teammate, from] = await Promise.all([staffById(h.to_staff_id), staffById(h.from_staff_id)]);
    if (teammate && teammate.active) await sendStaffText(teammate.phone, teammate.name, handoffCancelledText({ teammate: teammate.name, from: from?.name ?? "", date: facts(session).date }));
  }
}

/** The bartender cancels their own handoff before it is approved. */
export async function cancelHandoff(handoffId: string, staff: StaffMember): Promise<Result> {
  const h = await handoffById(handoffId);
  if (!h || h.from_staff_id !== staff.id) return fail("This is not your request.", 403);
  if (!ACTIVE_HANDOFF.includes(h.status)) return fail(h.status === "approved" ? "This handoff was already approved." : "This request is already closed.");
  await closeHandoff(h, await getSubmittedSession(h.session_id), "cancelled", null);
  return { ok: true };
}

/** An admin declines a handoff: the original bartender is texted that they are still on the shift. */
export async function declineHandoff(handoffId: string, admin: StaffMember): Promise<Result> {
  const h = await handoffById(handoffId);
  if (!h || !ACTIVE_HANDOFF.includes(h.status)) return fail("This handoff is not open.", 404);
  const session = await getSubmittedSession(h.session_id);
  await closeHandoff(h, session, "admin_declined", admin.id);
  const from = await staffById(h.from_staff_id);
  if (from && session) await sendStaffText(from.phone, from.name, stillOnShiftText({ from: from.name, date: facts(session).date }));
  return { ok: true };
}

/** An admin approves the teammate who accepted. */
export async function approveHandoff(handoffId: string, admin: StaffMember): Promise<Result> {
  const h = await handoffById(handoffId);
  if (!h || h.mode !== "teammate") return fail("This handoff is not waiting for approval.", 404);
  if (h.status !== "teammate_accepted" || !h.to_staff_id) {
    return fail(h.status === "asked" ? "The teammate has not accepted yet." : "This handoff is not waiting for approval.");
  }
  return completeHandoff(h, h.to_staff_id, admin);
}

/**
 * Move the assignment to the replacement. The original bartender is
 * released and texted, the replacement becomes an accepted assignment with
 * no checklist progress, and gets the event page link.
 */
async function completeHandoff(h: HandoffRow, replacementId: string, admin: StaffMember): Promise<Result> {
  const session = await getSubmittedSession(h.session_id);
  if (!session) return fail("We could not find that event.", 404);
  const rows = await assignmentsOf(session.id);
  const original = rows.find((a) => a.staff_id === h.from_staff_id);
  if (!original || original.status !== "accepted") return fail("The original bartender is no longer on this event.");
  if (await hasPunches(session.id, h.from_staff_id)) return fail("The original bartender has clocked in, so the shift cannot move.");
  const replacement = await staffById(replacementId);
  if (!replacement || !replacement.active) return fail("That person is not on the active team.", 404);
  const theirs = rows.find((a) => a.staff_id === replacementId);
  if (theirs && theirs.status !== "declined") return fail(`${firstName(replacement.name) || "They"} is already on this event.`);

  const now = new Date().toISOString();
  // The replacement first, so the event is never left with nobody if a step fails.
  const { error: upErr } = await supabase
    .from("event_assignments")
    .upsert({ session_id: session.id, staff_id: replacementId, status: "accepted", assigned_at: now, responded_at: now, assigned_by: admin.id }, { onConflict: "session_id,staff_id" });
  if (upErr) throw new Error(`handoff assign failed: ${upErr.message}`);
  const { error: delErr } = await supabase.from("event_assignments").delete().eq("session_id", session.id).eq("staff_id", h.from_staff_id);
  if (delErr) {
    await supabase.from("event_assignments").delete().eq("session_id", session.id).eq("staff_id", replacementId);
    return fail("Could not move the shift. Try again.");
  }
  // Checklist progress never carries over: the replacement starts with a clean list.
  await supabase.from("staff_checks").delete().eq("session_id", session.id).eq("staff_id", replacementId);
  await supabase.from("staff_confirmations").delete().eq("session_id", session.id).eq("staff_id", replacementId);

  await supabase.from("shift_handoffs").update({ status: "approved", to_staff_id: replacementId, decided_by: admin.id, decided_at: now }).eq("id", h.id);
  const post = await coverPostFor(h.id);
  if (post && post.status === "posted") {
    await supabase.from("shift_requests").update({ status: "approved", updated_at: now }).eq("post_id", post.id).eq("staff_id", replacementId);
    await closePost(post, session, "filled", admin.id, "filled");
  }
  const f = facts(session);
  const from = await staffById(h.from_staff_id);
  if (from) await sendStaffText(from.phone, from.name, releasedText({ from: from.name, date: f.date }));
  await sendStaffText(replacement.phone, replacement.name, gotShiftText({ date: f.date, link: eventLink(session.id) }));
  return { ok: true };
}

/** When a bartender declines or is removed, any handoff they had open closes quietly. */
export async function cancelHandoffsFor(sessionId: string, staffId: string): Promise<void> {
  const h = await activeHandoffRow(sessionId, staffId);
  if (h) await closeHandoff(h, await getSubmittedSession(sessionId), "cancelled", null);
}

// ----- Cron: posted shifts still short 5 days out -----

export async function sendShortShiftAlerts(now: Date = new Date()): Promise<number> {
  const { data, error } = await supabase.from("shift_posts").select("*").eq("status", "posted").eq("kind", "open");
  if (error || !data) return 0;
  const hidden = await hiddenEventIds();
  let sent = 0;
  for (const post of data as PostRow[]) {
    if (hidden.has(post.session_id)) continue;
    const session = await getSubmittedSession(post.session_id);
    if (!session) continue;
    const short = await spotsOpen(session);
    if (!shortAlertDue(eventData(session), now, short)) continue;
    if (!(await claimNotice(`shift_short:${post.id}`, "shift_short"))) continue;
    const { data: reqs } = await supabase.from("shift_requests").select("id").eq("post_id", post.id).eq("status", "requested");
    const f = facts(session);
    if ((await textAdmins(shortShiftText({ title: f.title, date: f.date, short, requests: ((reqs as unknown[]) ?? []).length, link: adminLink(session.id) }))) > 0) sent++;
  }
  return sent;
}
