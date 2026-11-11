// Database side of availability and time off. Server only.
//
// Unavailable days keep a bartender out of new shift texts and Open shifts
// for events on those days. They keep events they already accepted. Admins
// still see everyone and can assign someone who is unavailable after a
// confirm step.

import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import type { StaffMember } from "@/lib/team/event-view";
import { eventTitle } from "@/lib/team/event-list";
import { eventData, marketTz, sessionMarket, staffMarketsOf, type Market } from "@/lib/team/markets";
import { eventSchedule, todayIn } from "@/lib/team/time";
import { staffMarkets } from "@/lib/team/markets-db";
import { acceptedWarning, covers, removalPlan, validateUnavailable, type UnavailRow } from "@/lib/team/availability";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number };

/** The staff member's today, in their first market's time zone. */
export function staffToday(staff: { markets?: unknown }, now: Date = new Date()): string {
  return todayIn(marketTz(staffMarketsOf(staff)[0] ?? null), now);
}

/** The same, looking up the person's markets (the signed in record does not carry them). */
export async function todayFor(staffId: string, now: Date = new Date()): Promise<string> {
  return todayIn(marketTz((await staffMarkets(staffId))[0] ?? null), now);
}

/** Rows that overlap from..to (inclusive), for everyone or some people. Empty before the table exists. */
export async function unavailableBetween(from: string, to: string, staffIds?: string[]): Promise<UnavailRow[]> {
  if (staffIds && staffIds.length === 0) return [];
  let q = supabase.from("staff_unavailability").select("*").lte("start_day", to).gte("end_day", from);
  if (staffIds) q = q.in("staff_id", staffIds);
  const { data, error } = await q;
  if (error || !data) return [];
  return data as UnavailRow[];
}

/** Everyone unavailable on the day. */
export async function unavailableOn(day: string | null): Promise<Set<string>> {
  if (!day) return new Set();
  return new Set((await unavailableBetween(day, day)).map((r) => r.staff_id));
}

/** True when this person marked the day unavailable. */
export async function isUnavailable(staffId: string, day: string | null): Promise<boolean> {
  if (!day) return false;
  return (await unavailableBetween(day, day, [staffId])).length > 0;
}

/** The event's day in its market time zone. */
export function eventDayOf(session: SessionRow): string | null {
  return eventSchedule(eventData(session)).day;
}

/** This person's unavailable dates from today on, soonest first. */
export async function upcomingUnavailable(staffId: string, today: string): Promise<UnavailRow[]> {
  const { data, error } = await supabase.from("staff_unavailability").select("*").eq("staff_id", staffId).gte("end_day", today);
  if (error || !data) return [];
  return (data as UnavailRow[]).sort((a, b) => a.start_day.localeCompare(b.start_day));
}

/** Upcoming unavailable dates for everyone, by staff id, for the staff page. */
export async function upcomingUnavailableByStaff(today: string): Promise<Map<string, UnavailRow[]>> {
  const { data, error } = await supabase.from("staff_unavailability").select("*").gte("end_day", today);
  const out = new Map<string, UnavailRow[]>();
  if (error || !data) return out;
  for (const r of (data as UnavailRow[]).sort((a, b) => a.start_day.localeCompare(b.start_day))) out.set(r.staff_id, [...(out.get(r.staff_id) ?? []), r]);
  return out;
}

/** Events this person accepted on days inside the range: the reason for a warning. */
async function acceptedInRange(staffId: string, start: string, end: string): Promise<{ sessionId: string; title: string; day: string }[]> {
  const { data } = await supabase.from("event_assignments").select("session_id, status, session:session_id (*)").eq("staff_id", staffId).eq("status", "accepted");
  const out: { sessionId: string; title: string; day: string }[] = [];
  for (const a of (data as { session_id: string; session: SessionRow | SessionRow[] | null }[]) ?? []) {
    const s = Array.isArray(a.session) ? a.session[0] : a.session;
    if (!s || s.status !== "submitted") continue;
    const day = eventDayOf(s);
    if (day && covers({ start_day: start, end_day: end }, day)) out.push({ sessionId: s.id, title: eventTitle(eventData(s)), day });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day));
}

/** Mark a date or range unavailable. Saves even when they have an accepted event that day, with a warning. */
export async function addUnavailable(
  staff: StaffMember,
  raw: Record<string, unknown>,
  now: Date = new Date()
): Promise<Result<{ row: UnavailRow; warnings: string[]; events: { sessionId: string; title: string; day: string }[] }>> {
  const v = validateUnavailable(raw, await todayFor(staff.id, now));
  if (!v.ok) return { ok: false, error: v.error, status: 400 };
  const { data, error } = await supabase
    .from("staff_unavailability")
    .insert({ staff_id: staff.id, start_day: v.value.start, end_day: v.value.end, note: v.value.note || null, created_at: now.toISOString() })
    .select("*")
    .single();
  if (error || !data) return { ok: false, error: "Could not save. Try again.", status: 500 };
  const events = await acceptedInRange(staff.id, v.value.start, v.value.end);
  return { ok: true, row: data as UnavailRow, events, warnings: events.map((e) => acceptedWarning(e)) };
}

/** Remove one of this person's own rows. Days before today are kept. */
export async function removeUnavailable(staff: StaffMember, id: string, now: Date = new Date()): Promise<Result> {
  const { data } = await supabase.from("staff_unavailability").select("*").eq("id", id).maybeSingle();
  const row = data as UnavailRow | null;
  if (!row || row.staff_id !== staff.id) return { ok: false, error: "We could not find that date.", status: 404 };
  const plan = removalPlan(row, await todayFor(staff.id, now));
  if (plan.action === "past") return { ok: false, error: "Past dates cannot be changed.", status: 409 };
  const { error } =
    plan.action === "delete"
      ? await supabase.from("staff_unavailability").delete().eq("id", id).eq("staff_id", staff.id)
      : await supabase.from("staff_unavailability").update({ end_day: plan.end }).eq("id", id).eq("staff_id", staff.id);
  if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
  return { ok: true };
}

/**
 * Available bartenders per event: active bartenders in the event's market who
 * did not mark the event's day unavailable. Null for events with no market or
 * no date.
 */
export async function availableCounts(sessions: SessionRow[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const days = sessions.map((s) => eventDayOf(s)).filter((d): d is string => !!d).sort();
  const { data } = await supabase.from("staff").select("id, role, active, markets").eq("active", true).eq("role", "bartender");
  const bartenders = (data as { id: string; markets?: unknown }[]) ?? [];
  const rows = days.length ? await unavailableBetween(days[0], days[days.length - 1]) : [];
  for (const s of sessions) {
    const day = eventDayOf(s);
    const market = sessionMarket(s) as Market | null;
    if (!day || !market) {
      out.set(s.id, null);
      continue;
    }
    const away = new Set(rows.filter((r) => covers(r, day)).map((r) => r.staff_id));
    out.set(s.id, bartenders.filter((b) => staffMarketsOf(b).includes(market) && !away.has(b.id)).length);
  }
  return out;
}
