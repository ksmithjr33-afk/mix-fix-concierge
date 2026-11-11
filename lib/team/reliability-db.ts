// Reliability record: gathering the facts. Server only.
//
// Read only: everything comes from rows the portal already keeps (assignments,
// clock punches, bar ready photos, closeouts, handoffs). The one new column is
// event_assignments.dropped_at, set when someone declines a shift they had
// accepted.

import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import { eventData } from "@/lib/team/markets";
import { eventDayStart, eventSchedule } from "@/lib/team/time";
import { hiddenEventIds } from "@/lib/team/hidden";
import { compactLine, computeRecord, emptyFacts, LOCATION_FLAGS, since90, type RecordFacts, type RecordStats, type WorkedEvent } from "@/lib/team/reliability";

export interface StaffRecord {
  last90: RecordStats;
  allTime: RecordStats;
}

interface AssignmentWithSession {
  session_id: string;
  staff_id: string;
  status: string;
  dropped_at?: string | null;
  session: SessionRow | SessionRow[] | null;
}

/** When the event is over: service end, else service start, else the end of the event day. Null with no date. */
function eventOver(session: SessionRow): { end: Date; arrival: Date | null; start: Date | null } | null {
  const ed = eventData(session);
  const s = eventSchedule(ed);
  const dayStart = eventDayStart(ed);
  const end = s.end ?? s.start ?? (dayStart ? new Date(dayStart.getTime() + 86_400_000) : null);
  return end ? { end, arrival: s.arrival, start: s.start } : null;
}

/** The raw facts for each person, for the record math. */
export async function recordFacts(staffIds: string[], now: Date = new Date()): Promise<Map<string, RecordFacts>> {
  const ids = [...new Set(staffIds)];
  const out = new Map(ids.map((id) => [id, emptyFacts()]));
  if (ids.length === 0) return out;

  const [{ data: asg }, { data: punches }, { data: bars }, { data: closeouts }, { data: handoffs }, hidden] = await Promise.all([
    supabase.from("event_assignments").select("session_id, staff_id, status, dropped_at, session:session_id (*)").in("staff_id", ids),
    supabase.from("time_punches").select("staff_id, session_id, type, punched_at, flags").in("staff_id", ids),
    supabase.from("bar_ready_reports").select("staff_id, session_id, created_at").in("staff_id", ids),
    supabase.from("event_closeouts").select("staff_id, session_id").in("staff_id", ids),
    supabase.from("shift_handoffs").select("from_staff_id, created_at, urgent").in("from_staff_id", ids),
    hiddenEventIds(),
  ]);

  const key = (staffId: string, sessionId: string) => `${staffId}|${sessionId}`;
  const clockIns = new Map<string, Date>();
  for (const p of (punches as { staff_id: string; session_id: string; type: string; punched_at: string; flags: string[] | null }[]) ?? []) {
    if (p.type === "in") clockIns.set(key(p.staff_id, p.session_id), new Date(p.punched_at));
    if ((p.flags ?? []).some((f) => LOCATION_FLAGS.includes(f))) out.get(p.staff_id)?.flaggedPunches.push(new Date(p.punched_at));
  }
  const firstBar = new Map<string, Date>();
  for (const b of (bars as { staff_id: string; session_id: string; created_at: string }[]) ?? []) {
    const k = key(b.staff_id, b.session_id);
    const at = new Date(b.created_at);
    if (!firstBar.has(k) || at < firstBar.get(k)!) firstBar.set(k, at);
  }
  const closed = new Set(((closeouts as { staff_id: string; session_id: string }[]) ?? []).map((c) => key(c.staff_id, c.session_id)));

  for (const a of (asg as AssignmentWithSession[]) ?? []) {
    const f = out.get(a.staff_id);
    if (!f) continue;
    if (a.dropped_at) f.drops.push(new Date(a.dropped_at));
    if (a.status !== "accepted" || hidden.has(a.session_id)) continue;
    const s = Array.isArray(a.session) ? a.session[0] : a.session;
    if (!s || s.status !== "submitted") continue;
    const when = eventOver(s);
    if (!when || when.end.getTime() > now.getTime()) continue; // not worked yet
    const k = key(a.staff_id, a.session_id);
    const e: WorkedEvent = { sessionId: a.session_id, ...when, clockIn: clockIns.get(k) ?? null, barReadyAt: firstBar.get(k) ?? null, closeout: closed.has(k) };
    f.events.push(e);
  }
  for (const h of (handoffs as { from_staff_id: string; created_at: string; urgent: boolean }[]) ?? []) {
    out.get(h.from_staff_id)?.handoffs.push({ at: new Date(h.created_at), urgent: !!h.urgent });
  }
  return out;
}

/** The last 90 days and all time, per person. */
export async function staffRecords(staffIds: string[], now: Date = new Date()): Promise<Map<string, StaffRecord>> {
  const facts = await recordFacts(staffIds, now);
  const from = since90(now);
  return new Map([...facts].map(([id, f]) => [id, { last90: computeRecord(f, from), allTime: computeRecord(f, null) }]));
}

export async function staffRecord(staffId: string, now: Date = new Date()): Promise<StaffRecord> {
  return (await staffRecords([staffId], now)).get(staffId)!;
}

/** The compact all time line per person, for admin lists: "12 events · 92% on time · 1 late drop". */
export async function compactLines(staffIds: string[], now: Date = new Date()): Promise<Record<string, string>> {
  const records = await staffRecords(staffIds, now);
  return Object.fromEntries([...records].map(([id, r]) => [id, compactLine(r.allTime)]));
}
