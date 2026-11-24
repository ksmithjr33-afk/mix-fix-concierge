// Admin edits held from the team: the database side. Server only.
//
// event_updates.staff_notice (migration 20270102_delivery_availability.sql):
// null for client changes and older rows, 'held' for an admin or manager edit
// staff have not been told about, then 'sent' (Notify the team) or 'skipped'
// (Do not notify). Before the migration, holding fails and the edit texts
// staff right away, as it always did.

import { supabase } from "@/lib/supabase";
import type { EventUpdateRow } from "@/lib/event-updates";
import type { StaffMember } from "@/lib/team/event-view";
import { firstName } from "@/lib/team/event-view";
import { isAdminRole } from "@/lib/team/roles";
import { notifyStaffOfUpdate, textAssignedStaff } from "@/lib/team/assignments-db";
import { getSubmittedSession } from "@/lib/team/events";
import { adminEventTitle } from "@/lib/team/event-list";
import { eventData } from "@/lib/team/markets";
import { eventDay, eventSchedule, shortDate } from "@/lib/team/time";
import { inQuietHours } from "@/lib/team/shifts";
import { sendStaffText } from "@/lib/team/sms";
import { siteOrigin } from "@/lib/team/clock-db";
import { reminderDue, reminderText, staffVisible, summarize, teamText, type HeldRow, type HeldSummary } from "@/lib/team/held-changes";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number };

/**
 * After an admin edit saves: hold the rows that change something staff see.
 * Returns how they were handled: "held", "none" (nothing staff see), or
 * "texted" (before the migration: staff texted right away like before).
 */
export async function holdForTeam(session: { id: string; event_date?: string | null; event_data: Record<string, unknown> | null }, rows: EventUpdateRow[], origin: string): Promise<"held" | "none" | "texted"> {
  const ids = rows.filter((r) => r.applied && staffVisible(r.changes ?? []).length > 0).map((r) => r.id);
  if (ids.length === 0) return "none";
  const { error } = await supabase.from("event_updates").update({ staff_notice: "held" }).in("id", ids);
  if (!error) return "held";
  console.error(`[held changes] ${session.id}: could not hold, texting staff as before:`, error.message);
  const fields = rows.filter((r) => r.applied).flatMap((r) => (r.changes ?? []).map((c) => c.field));
  await notifyStaffOfUpdate(session, fields, origin).catch(() => 0);
  return "texted";
}

async function heldRows(sessionId: string): Promise<HeldRow[]> {
  const { data, error } = await supabase.from("event_updates").select("*").eq("session_id", sessionId).eq("staff_notice", "held").eq("applied", true);
  if (error || !data) return [];
  return data as HeldRow[];
}

/** The bar on the event: admins and managers only. Null when nothing is held. */
export async function heldSummary(viewer: StaffMember, sessionId: string): Promise<HeldSummary | null> {
  if (!isAdminRole(viewer.role)) return null;
  const rows = await heldRows(sessionId);
  if (rows.length === 0) return null;
  const s = summarize(rows);
  return s.count > 0 ? s : null;
}

async function mark(rowIds: string[], status: "sent" | "skipped", by: StaffMember, now: Date): Promise<boolean> {
  if (rowIds.length === 0) return true;
  const { error } = await supabase.from("event_updates").update({ staff_notice: status, staff_notice_at: now.toISOString(), staff_notice_by: by.id }).in("id", rowIds).eq("staff_notice", "held");
  return !error;
}

/** Notify the team: one text to everyone on the event listing every held change. */
export async function notifyTeam(viewer: StaffMember, sessionId: string, origin: string = siteOrigin(), now: Date = new Date()): Promise<Result<{ texted: number; summary: null }>> {
  if (!isAdminRole(viewer.role)) return { ok: false, error: "Admins and managers only.", status: 403 };
  const session = await getSubmittedSession(sessionId);
  if (!session) return { ok: false, error: "We could not find that event.", status: 404 };
  const rows = await heldRows(sessionId);
  const s = summarize(rows);
  if (rows.length === 0 || s.count === 0) return { ok: false, error: "There are no changes waiting to be sent.", status: 409 };
  // Claim the rows first, so two presses never text the team twice.
  if (!(await mark(s.rowIds, "sent", viewer, now))) return { ok: false, error: "Could not save. Try again.", status: 500 };
  const ed = session.event_data ?? {};
  const message = teamText({ date: shortDate(eventDay(ed.event_date ?? session.event_date)), lines: s.lines, link: `${origin}/team/e/${session.id}` });
  const texted = await textAssignedStaff(session.id, message);
  return { ok: true, texted, summary: null };
}

/** Do not notify: the changes stay saved, the team is not texted. */
export async function skipNotify(viewer: StaffMember, sessionId: string, now: Date = new Date()): Promise<Result<{ summary: null }>> {
  if (!isAdminRole(viewer.role)) return { ok: false, error: "Admins and managers only.", status: 403 };
  const rows = await heldRows(sessionId);
  if (rows.length === 0) return { ok: false, error: "There are no changes waiting to be sent.", status: 409 };
  if (!(await mark(rows.map((r) => r.id), "skipped", viewer, now))) return { ok: false, error: "Could not save. Try again.", status: 500 };
  return { ok: true, summary: null };
}

/**
 * Cron, every 5 minutes: the safety net. Held changes unsent for 2 hours, or
 * on an event within 48 hours (after a 15 minute grace), get one reminder to
 * the admin or manager who made them, with a link to the event. Never in
 * quiet hours. Staff are never texted here. Returns texts sent.
 */
export async function sendHeldReminders(now: Date = new Date()): Promise<number> {
  const { data, error } = await supabase.from("event_updates").select("*").eq("staff_notice", "held").eq("applied", true);
  if (error || !data) return 0; // before the migration
  const rows = (data as HeldRow[]).filter((r) => r.updated_by_staff_id);
  const groups = new Map<string, HeldRow[]>();
  for (const r of rows) groups.set(`${r.session_id}|${r.updated_by_staff_id}`, [...(groups.get(`${r.session_id}|${r.updated_by_staff_id}`) ?? []), r]);
  let sent = 0;
  for (const [key, mine] of groups) {
    const [sessionId, editorId] = key.split("|");
    const session = await getSubmittedSession(sessionId);
    if (!session) continue;
    const ed = eventData(session);
    const sched = eventSchedule(ed);
    const start = sched.start ?? null;
    if (start && start.getTime() < now.getTime()) continue; // the event has started: nothing to remind about
    if (!reminderDue(mine, now, start)) continue;
    if (inQuietHours(now, sched.tz)) continue;
    const { data: who } = await supabase.from("staff").select("id, name, phone, role, active").eq("id", editorId).maybeSingle();
    const editor = who as { id: string; name: string; phone: string; role: string; active: boolean } | null;
    const open = mine.filter((r) => !r.held_reminded_at);
    // Claimed before the text, so a slow run never reminds twice.
    const { error: claimErr } = await supabase.from("event_updates").update({ held_reminded_at: now.toISOString() }).in("id", open.map((r) => r.id)).is("held_reminded_at", null);
    if (claimErr) continue;
    if (!editor || !editor.active || !isAdminRole(editor.role) || !editor.phone) continue;
    const all = summarize(await heldRows(sessionId));
    if (all.count === 0) continue;
    const ok = await sendStaffText(
      editor.phone,
      editor.name,
      reminderText({ firstName: firstName(editor.name), count: all.count, title: adminEventTitle(ed), date: shortDate(sched.day), timePlace: all.timePlace, link: `${siteOrigin()}/team/admin/e/${encodeURIComponent(sessionId)}` })
    );
    if (ok) sent++;
  }
  return sent;
}
