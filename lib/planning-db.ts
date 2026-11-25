// Database side of bookings the client has not finished planning
// (lib/planning.ts). Server only.
//
// When the client finishes (recordSubmission), on an event that was showing on
// the team side:
//   - everyone assigned and not declined at that moment is queued for one
//     text, "Details are in for [event].", with the date or start time change
//     when the client moved it from what the booking said;
//   - a date or start time change also queues one text to every admin and
//     manager with alerts on, and shows in red on the event;
//   - everyone who accepted has their mileage worked out now that the address is in.
// Texts never go out in quiet hours (9 PM to 8 AM in the event's market): the
// cron sends what is held at 8 AM. Each person gets the text once (team_notices).

import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import { eventData } from "@/lib/team/markets";
import { eventSchedule } from "@/lib/team/time";
import { eventTitle, adminEventTitle } from "@/lib/team/event-list";
import { claimNotice, siteOrigin } from "@/lib/team/clock-db";
import { sendStaffText } from "@/lib/team/sms";
import { inQuietHours } from "@/lib/team/shifts";
import { alertAdmins } from "@/lib/team/events";
import { lockMileage } from "@/lib/team/pay-db";
import { managerHref } from "@/lib/team/manager-tabs";
import { detailsInText, finishChangeAdminText, finishChanges, isPlanning, showsOnTeam, type FinishChange } from "@/lib/planning";

const DUE = "details_due";
const SENT = "details_in";
const CHANGE = "finish_change";
const CHANGE_SENT = "finish_change_sent";
const LOOKBACK_MS = 7 * 86_400_000;

const dueKey = (sessionId: string, staffId: string) => `${DUE}:${sessionId}:${staffId}`;
const sentKey = (sessionId: string, staffId: string) => `${SENT}:${sessionId}:${staffId}`;
const changeKey = (sessionId: string) => `${CHANGE}:${sessionId}`;
const changeSentKey = (sessionId: string) => `${CHANGE_SENT}:${sessionId}`;

async function noticeExists(key: string): Promise<boolean> {
  const { data, error } = await supabase.from("team_notices").select("key").eq("key", key).maybeSingle();
  return !error && !!data;
}

/** True once the client has typed anything in the concierge. Never throws. */
export async function conciergeStarted(sessionId: string): Promise<boolean> {
  try {
    const { data } = await supabase.from("conversation_logs").select("messages").eq("session_id", sessionId);
    return ((data as { messages?: { role?: string }[] | null }[]) ?? []).some((r) => (r.messages ?? []).some((m) => m?.role === "user"));
  } catch {
    return false;
  }
}

/**
 * Called by recordSubmission right after the client's answers are saved.
 * `booked` is the row as it was before the save (still in_progress). Never throws.
 */
export async function afterPlanningFinished(booked: { id: string; status?: unknown }, saved: Record<string, unknown>, now: Date = new Date()): Promise<void> {
  try {
    if (!isPlanning(booked) || !showsOnTeam(booked)) return;
    const sessionId = booked.id;
    const change = finishChanges(booked, saved);
    const { data } = await supabase.from("event_assignments").select("staff_id, status").eq("session_id", sessionId).neq("status", "declined");
    const people = (data as { staff_id: string; status: string }[]) ?? [];
    for (const p of people) await claimNotice(dueKey(sessionId, p.staff_id), DUE);
    if (change.date || change.start) await claimNotice(changeKey(sessionId), CHANGE);
    // The address is in now: work out mileage for everyone who accepted (kept once stored).
    for (const p of people.filter((x) => x.status === "accepted")) await lockMileage(sessionId, p.staff_id, now);
    await deliverDetailsIn(now, sessionId);
  } catch (err) {
    console.error("[planning] after finish failed:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * The date or start time the client changed at finish, for the red card on the
 * event: the booking's columns (never changed by the concierge) against what
 * the client saved first. Null when nothing changed or the event never showed
 * as unfinished.
 */
export async function finishChangeFor(session: SessionRow): Promise<FinishChange | null> {
  if (isPlanning(session) || !(await noticeExists(changeKey(session.id)))) return null;
  const { data } = await supabase.from("event_updates").select("changes").eq("session_id", session.id).eq("version", 1).eq("applied", true).maybeSingle();
  const first: Record<string, unknown> = {};
  for (const c of ((data as { changes?: { field: string; new: unknown }[] } | null)?.changes ?? [])) first[c.field] = c.new;
  const change = finishChanges(session as unknown as Record<string, unknown> & { id: string }, Object.keys(first).length ? first : (session.event_data ?? {}));
  return change.date || change.start ? change : null;
}

/** Send the held "Details are in" texts and admin alerts that are due, outside quiet hours. Returns how many went out. */
export async function deliverDetailsIn(now: Date = new Date(), onlySession?: string): Promise<number> {
  const since = new Date(now.getTime() - LOOKBACK_MS).toISOString();
  const q = supabase.from("team_notices").select("key, kind").in("kind", [DUE, CHANGE]).gte("sent_at", since);
  const { data, error } = await q;
  if (error) return 0;
  const due = ((data as { key: string; kind: string }[]) ?? []).filter((n) => !onlySession || n.key.split(":")[1] === onlySession);
  if (due.length === 0) return 0;
  const bySession = new Map<string, { staff: string[]; change: boolean }>();
  for (const n of due) {
    const [, sid, staffId] = n.key.split(":");
    const e = bySession.get(sid) ?? { staff: [], change: false };
    if (n.kind === DUE && staffId) e.staff.push(staffId);
    if (n.kind === CHANGE) e.change = true;
    bySession.set(sid, e);
  }
  let sent = 0;
  for (const [sid, e] of bySession) {
    const { data: row } = await supabase.from("sessions").select("*").eq("id", sid).maybeSingle();
    const session = row as SessionRow | null;
    if (!session || session.status !== "submitted" || !session.event_data) continue;
    const ed = eventData(session);
    const tz = eventSchedule(ed).tz;
    if (inQuietHours(now, tz)) continue; // held until 8 AM
    const change = e.change ? await finishChangeFor(session) : null;
    const nothing: FinishChange = { date: null, start: null };
    const link = (path: string) => `${siteOrigin()}${path}`;
    if (e.staff.length > 0) {
      const { data: staffRows } = await supabase.from("staff").select("id, name, phone, active").in("id", e.staff);
      const { data: still } = await supabase.from("event_assignments").select("staff_id").eq("session_id", sid).neq("status", "declined");
      const on = new Set(((still as { staff_id: string }[]) ?? []).map((r) => r.staff_id));
      for (const p of (staffRows as { id: string; name: string; phone: string; active: boolean }[]) ?? []) {
        if (!p.active || !p.phone || !on.has(p.id)) continue;
        if (!(await claimNotice(sentKey(sid, p.id), SENT))) continue;
        if (await sendStaffText(p.phone, p.name, detailsInText(eventTitle(ed), change ?? nothing, link(`/team/e/${encodeURIComponent(sid)}`)))) sent++;
      }
    }
    if (change && (await claimNotice(changeSentKey(sid), CHANGE_SENT))) {
      for (const a of await alertAdmins()) {
        if (a.phone && (await sendStaffText(a.phone, a.name, finishChangeAdminText(adminEventTitle(ed), change, link(managerHref(sid)))))) sent++;
      }
    }
  }
  return sent;
}
