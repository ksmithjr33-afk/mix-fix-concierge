// Order window: the database side. Server only. Rules in lib/team/order-window.ts.
//
// One row per person per event in event_order_windows (migration
// 20270107_order_windows.sql). Who is asked comes from event_assignments
// (accepted, any role). The order counts as placed once any line on the order
// sheet is marked ordered; after that the answer is read only. Reminders are
// claimed in team_notices, so each goes out once.
//
// Before the migration runs: reads come back empty, saving says it could not
// save, no reminders or alerts go out, and nothing else breaks.

import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import { firstName, type StaffMember } from "@/lib/team/event-view";
import { claimNotice, siteOrigin } from "@/lib/team/clock-db";
import { sendStaffText } from "@/lib/team/sms";
import { inQuietHours } from "@/lib/team/shifts";
import { eventData, marketTz, staffMarketsOf } from "@/lib/team/markets";
import { hiddenEventIds } from "@/lib/team/hidden";
import { adminEventTitle, eventTitle } from "@/lib/team/event-list";
import { eventSchedule, todayIn, TZ } from "@/lib/team/time";
import { isServiceFeeBartenderOnly, withPricingModel } from "@/lib/bartender-only";
import { readWeek, HOME_LABEL, HANDOFF_LABEL, type HomeType, type HandoffPref } from "@/lib/team/delivery-availability";
import {
  answerSummary,
  cleanAnswer,
  dayChoices,
  dayLabel,
  noticeKey,
  prefill,
  readAnswer,
  reminderDue,
  reminderText,
  urgent,
  usualWindows,
  windowLabel,
  type Answer,
  type Method,
  type OrderWindowRow,
  type Window,
} from "@/lib/team/order-window";

const TABLE = "event_order_windows";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number };

interface AssignmentRow {
  id: string;
  session_id: string;
  staff_id: string;
  status: string;
  responded_at?: string | null;
}

interface ProfileBits {
  staff_id: string;
  delivery_windows?: unknown;
  handoff_pref?: string | null;
  home_type?: string | null;
  delivery_notes?: string | null;
}

/** Events where we buy nothing skip the item: the new Bartender Only (the client buys every line). */
export function buysNothing(ed: Record<string, unknown>): boolean {
  return isServiceFeeBartenderOnly(ed as { package?: unknown; pricing_model?: unknown });
}

/** The event's day and whether it is asked at all (it has a day and we buy something). */
function eventFacts(session: SessionRow): { day: string | null; asks: boolean } {
  const ed = withPricingModel(eventData(session), session as { pricing_model?: unknown });
  const day = eventSchedule(ed).day;
  return { day, asks: !!day && !buysNothing(ed) };
}

/** Rows for an event, by staff id. Empty before the migration. */
async function rowsForEvent(sessionId: string): Promise<Map<string, OrderWindowRow>> {
  const { data, error } = await supabase.from(TABLE).select("*").eq("session_id", sessionId);
  if (error || !data) return new Map();
  return new Map((data as OrderWindowRow[]).map((r) => [r.staff_id, r]));
}

async function profileOf(staffId: string): Promise<ProfileBits | null> {
  const { data, error } = await supabase.from("staff_profiles").select("*").eq("staff_id", staffId).maybeSingle();
  if (error) return null;
  return (data as ProfileBits | null) ?? null;
}

async function profilesOf(ids: string[]): Promise<Map<string, ProfileBits>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from("staff_profiles").select("*").in("staff_id", ids);
  if (error || !data) return new Map();
  return new Map((data as ProfileBits[]).map((r) => [r.staff_id, r]));
}

/** The order is placed once any line still on the sheet is marked ordered. */
export async function orderPlaced(sessionId: string): Promise<boolean> {
  const { data, error } = await supabase.from("order_sheet_lines").select("id, ordered, removed").eq("session_id", sessionId).eq("ordered", true);
  if (error || !data) return false;
  return (data as { removed?: boolean }[]).some((r) => !r.removed);
}

async function acceptedAssignment(sessionId: string, staffId: string): Promise<AssignmentRow | null> {
  const { data } = await supabase.from("event_assignments").select("*").eq("session_id", sessionId).eq("staff_id", staffId).maybeSingle();
  const a = (data as AssignmentRow | null) ?? null;
  return a && a.status === "accepted" ? a : null;
}

export interface OrderWindowView {
  sessionId: string;
  days: { value: string; label: string }[];
  answer: Answer | null; // null while open
  prefill: Answer; // the usual windows, for the first answer
  usual: Record<Method, Window[]>; // the usual windows for each method, when switching
  locked: boolean; // the order has been placed
  urgent: boolean; // open and the event is within 5 days
  summary: string; // "Delivery: Thu, Nov 26 9a–5p", or ""
}

/**
 * The item for the person on their event page (and right after accepting).
 * Null when they have not accepted, the event has no date or is past, or we
 * buy nothing for it.
 */
export async function orderWindowView(session: SessionRow, staffId: string, now: Date = new Date()): Promise<OrderWindowView | null> {
  const f = eventFacts(session);
  if (!f.asks || !f.day) return null;
  const today = todayIn(TZ, now);
  if (f.day < today) return null;
  const [a, rows, profile, locked] = await Promise.all([acceptedAssignment(session.id, staffId), rowsForEvent(session.id), profileOf(staffId), orderPlaced(session.id)]);
  if (!a) return null;
  const answer = readAnswer(rows.get(staffId));
  const week = readWeek(profile?.delivery_windows);
  return {
    sessionId: session.id,
    days: dayChoices(f.day, today).map((d) => ({ value: d, label: d === f.day ? `${dayLabel(d)} (event day)` : dayLabel(d) })),
    answer,
    prefill: prefill(profile, f.day, today),
    usual: { delivery: usualWindows(week, "delivery", f.day, today), pickup: usualWindows(week, "pickup", f.day, today) },
    locked,
    urgent: !answer && urgent(f.day, now),
    summary: answer ? answerSummary(answer) : "",
  };
}

/** Save the person's own answer. Only someone who accepted, only until the order is placed. */
export async function saveOrderWindow(session: SessionRow, staff: StaffMember, raw: Record<string, unknown>, now: Date = new Date()): Promise<Result<{ view: OrderWindowView }>> {
  const f = eventFacts(session);
  if (!f.asks || !f.day) return { ok: false, error: "This event does not need an order window.", status: 400 };
  const today = todayIn(TZ, now);
  if (f.day < today) return { ok: false, error: "This event has passed.", status: 400 };
  if (!(await acceptedAssignment(session.id, staff.id))) return { ok: false, error: "Only people who accepted this event answer this.", status: 403 };
  if (await orderPlaced(session.id)) return { ok: false, error: "The order has been placed. Text the office if something changed.", status: 409 };
  const c = cleanAnswer(raw, dayChoices(f.day, today));
  if (!c.ok) return { ok: false, error: c.error, status: 400 };
  const at = now.toISOString();
  const { error } = await supabase
    .from(TABLE)
    .upsert({ session_id: session.id, staff_id: staff.id, method: c.value.method, windows: c.value.windows, note: c.value.note || null, answered_at: at, updated_at: at }, { onConflict: "session_id,staff_id" });
  if (error) {
    console.error("[order window] save failed:", error.message);
    return { ok: false, error: "Could not save. Try again.", status: 500 };
  }
  const view = await orderWindowView(session, staff.id, now);
  if (!view) return { ok: false, error: "Could not save. Try again.", status: 500 };
  return { ok: true, view };
}

export interface PersonOrderWindow {
  staffId: string;
  name: string;
  accepted: boolean;
  needed: boolean; // accepted and not answered
  urgent: boolean; // needed and the event is within 5 days
  method: string; // "Delivery", or ""
  windows: string[]; // "Thu, Nov 26 9a–5p"
  note: string;
  answeredAt: string | null;
  home: string; // from the profile: "Apartment", or ""
  pref: string; // from the profile: "Prefers pickup", or ""
  profileNote: string; // the usual note on the profile (gate code and so on)
}

export interface EventOrderWindows {
  asks: boolean; // false when we buy nothing for this event
  placed: boolean;
  people: PersonOrderWindow[];
}

/** Admins and managers: each person's answer, for the Team tab and the order sheet. */
export async function orderWindowsFor(session: SessionRow, people: { staffId: string; name: string; status: string }[], now: Date = new Date()): Promise<EventOrderWindows> {
  const f = eventFacts(session);
  if (!f.asks) return { asks: false, placed: false, people: [] };
  const on = people.filter((p) => p.status !== "declined");
  const [rows, profiles, placed] = await Promise.all([rowsForEvent(session.id), profilesOf(on.map((p) => p.staffId)), orderPlaced(session.id)]);
  const isUrgent = urgent(f.day, now);
  return {
    asks: true,
    placed,
    people: on.map((p) => {
      const ans = readAnswer(rows.get(p.staffId));
      const prof = profiles.get(p.staffId);
      const accepted = p.status === "accepted";
      return {
        staffId: p.staffId,
        name: p.name,
        accepted,
        needed: accepted && !ans,
        urgent: accepted && !ans && isUrgent,
        method: ans ? (ans.method === "delivery" ? "Delivery" : "Pickup") : "",
        windows: ans ? ans.windows.map(windowLabel) : [],
        note: ans?.note ?? "",
        answeredAt: rows.get(p.staffId)?.answered_at ?? null,
        home: prof?.home_type && prof.home_type in HOME_LABEL ? HOME_LABEL[prof.home_type as HomeType] : "",
        pref: prof?.handoff_pref && prof.handoff_pref in HANDOFF_LABEL ? HANDOFF_LABEL[prof.handoff_pref as HandoffPref] : "",
        profileNote: prof?.delivery_notes ?? "",
      };
    }),
  };
}

interface OpenItem {
  session: SessionRow;
  day: string;
  assignment: AssignmentRow;
}

/** Every open item on an upcoming event: accepted, not answered, order not placed, not hidden, we buy something. */
async function openItems(now: Date): Promise<OpenItem[] | null> {
  const probe = await supabase.from(TABLE).select("session_id").limit(1);
  if (probe.error) return null; // before the migration
  const { data: rows, error } = await supabase.from("event_assignments").select("*").eq("status", "accepted");
  if (error || !rows) return [];
  const bySession = new Map<string, AssignmentRow[]>();
  for (const r of rows as AssignmentRow[]) bySession.set(r.session_id, [...(bySession.get(r.session_id) ?? []), r]);
  if (bySession.size === 0) return [];
  const today = todayIn(TZ, now);
  const hidden = await hiddenEventIds();
  const ids = [...bySession.keys()];
  const sessions: SessionRow[] = [];
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await supabase.from("sessions").select("*").in("id", ids.slice(i, i + 150)).eq("status", "submitted");
    sessions.push(...((data as SessionRow[]) ?? []));
  }
  const upcoming = sessions.filter((s) => {
    if (hidden.has(s.id)) return false;
    const f = eventFacts(s);
    return f.asks && !!f.day && f.day >= today;
  });
  // Two reads for every upcoming event at once: answers, and lines marked ordered.
  const upIds = upcoming.map((s) => s.id);
  const answered = new Map<string, OrderWindowRow>();
  const placed = new Set<string>();
  for (let i = 0; i < upIds.length; i += 150) {
    const chunk = upIds.slice(i, i + 150);
    const [a, o] = await Promise.all([supabase.from(TABLE).select("*").in("session_id", chunk), supabase.from("order_sheet_lines").select("session_id, removed").in("session_id", chunk).eq("ordered", true)]);
    for (const r of (a.data as OrderWindowRow[]) ?? []) answered.set(`${r.session_id}:${r.staff_id}`, r);
    for (const r of (o.data as { session_id: string; removed?: boolean }[]) ?? []) if (!r.removed) placed.add(r.session_id);
  }
  const out: OpenItem[] = [];
  for (const s of upcoming) {
    if (placed.has(s.id)) continue;
    const day = eventFacts(s).day!;
    for (const a of bySession.get(s.id) ?? []) if (!readAnswer(answered.get(`${s.id}:${a.staff_id}`))) out.push({ session: s, day, assignment: a });
  }
  return out;
}

export interface OrderWindowAlert {
  sessionId: string;
  name: string;
  date: string;
  people: string[];
  urgent: boolean;
}

/** The admin events list alert: upcoming events with someone's order window still needed. */
export async function orderWindowAlerts(now: Date = new Date()): Promise<OrderWindowAlert[]> {
  const items = await openItems(now);
  if (!items || items.length === 0) return [];
  const { data } = await supabase.from("staff").select("id, name").in("id", [...new Set(items.map((i) => i.assignment.staff_id))]);
  const names = new Map(((data as { id: string; name: string }[]) ?? []).map((s) => [s.id, s.name]));
  const bySession = new Map<string, OrderWindowAlert>();
  for (const i of items) {
    const cur = bySession.get(i.session.id) ?? { sessionId: i.session.id, name: adminEventTitle(eventData(i.session)), date: dayLabel(i.day), people: [], urgent: urgent(i.day, now) };
    cur.people.push(names.get(i.assignment.staff_id) ?? "Someone");
    bySession.set(i.session.id, cur);
  }
  return [...bySession.values()].sort((a, b) => Number(b.urgent) - Number(a.urgent));
}

/**
 * Cron, every 5 minutes. One text 24 hours after accepting if the order
 * window is still open, and one more once the event is within 5 days and it is
 * still open. Never in quiet hours where the person lives. Returns texts sent.
 */
export async function sendOrderWindowReminders(now: Date = new Date()): Promise<number> {
  const items = await openItems(now);
  if (!items || items.length === 0) return 0;
  const { data } = await supabase.from("staff").select("*").in("id", [...new Set(items.map((i) => i.assignment.staff_id))]);
  const staff = new Map(((data as (StaffMember & { markets?: unknown })[]) ?? []).filter((s) => s.active).map((s) => [s.id, s]));
  const sentKeys = await claimedKeys(items);
  let sent = 0;
  for (const i of items) {
    const s = staff.get(i.assignment.staff_id);
    if (!s?.phone) continue;
    const keys = { first: noticeKey("first", i.session.id, s.id), urgent: noticeKey("urgent", i.session.id, s.id) };
    // Asked from when they accepted, or from when the client finished planning if they accepted before that.
    const asked = [i.assignment.responded_at, i.session.submitted_at].filter((x): x is string => !!x).sort().at(-1) ?? null;
    const due = reminderDue({ respondedAt: asked, eventYmd: i.day, now, sent: { first: sentKeys.has(keys.first), urgent: sentKeys.has(keys.urgent) } });
    if (!due) continue;
    if (inQuietHours(now, marketTz(staffMarketsOf(s)[0] ?? null))) continue;
    if (!(await claimNotice(keys[due], "order_window"))) continue;
    // The urgent text covers the first one too, so the first never follows it.
    if (due === "urgent") await claimNotice(keys.first, "order_window");
    const ed = eventData(i.session);
    const ok = await sendStaffText(s.phone, s.name, reminderText({ firstName: firstName(s.name), title: eventTitle(ed), date: dayLabel(i.day), kind: due, link: `${siteOrigin()}/team/e/${i.session.id}` }));
    if (ok) sent++;
  }
  return sent;
}

async function claimedKeys(items: OpenItem[]): Promise<Set<string>> {
  const keys = items.flatMap((i) => [noticeKey("first", i.session.id, i.assignment.staff_id), noticeKey("urgent", i.session.id, i.assignment.staff_id)]);
  const out = new Set<string>();
  for (let i = 0; i < keys.length; i += 150) {
    const { data } = await supabase.from("team_notices").select("key").in("key", keys.slice(i, i + 150));
    for (const r of (data as { key: string }[]) ?? []) out.add(r.key);
  }
  return out;
}
