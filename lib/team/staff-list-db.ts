// Database side of the staff "Shopping list for this event" (rules in
// lib/team/staff-list.ts). Server only.
//
// - The lines are read through staffSheet (lib/order-sheet-db.ts), the same
//   lines the admin Shopping list shows, so there is one list.
// - Answers live in order_sheet_answers. Saving one never touches the sheet:
//   staff cannot change a line's source, quantity, or Ordered check.
// - The "list is ready" text goes once per person per event
//   (order_sheet_ready_texts), never in quiet hours, never for a past event.
//   The 5 minute cron queues it when most lines have a source and sends what is
//   due; "Text the team the list" on the admin tab queues and sends it by hand.
// Before supabase/migrations/20261230_staff_shopping_list.sql runs, answers
// read as none and saving one says the list is not set up yet.

import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import { staffSheet } from "@/lib/order-sheet-db";
import { eventData } from "@/lib/team/markets";
import { eventSchedule, shortDate, todayIn } from "@/lib/team/time";
import { eventTitle } from "@/lib/team/event-list";
import { siteOrigin } from "@/lib/team/clock-db";
import { sendStaffText } from "@/lib/team/sms";
import { inQuietHours, sendableAt } from "@/lib/team/shifts";
import type { ViewedStaff } from "@/lib/team/view-mode";
import { isAdminRole } from "@/lib/team/roles";
import {
  cleanAnswer,
  groupOf,
  LIST_PREVIEW,
  LIST_READ_ONLY,
  listLink,
  listReady,
  notReadyView,
  readyText,
  staffList,
  type AnswerRow,
  type StaffListView,
} from "@/lib/team/staff-list";

type SessionLike = Pick<SessionRow, "id" | "event_date" | "event_data"> & { status?: string };

export const NOT_SET_UP = "The shopping list answers are not set up yet. Ask an admin to run the latest database update.";

/** Over: after service ends, or after the event day when the end time is unknown. */
export function eventOver(session: SessionLike, now: Date = new Date()): boolean {
  const s = eventSchedule(eventData(session as SessionRow));
  if (s.end) return now.getTime() > s.end.getTime();
  return !!s.day && s.day < todayIn(s.tz, now);
}

/** Before the event day (in the event's time zone): texts go only to events that have not happened. */
function eventPast(session: SessionLike, now: Date): boolean {
  const s = eventSchedule(eventData(session as SessionRow));
  return !!s.day && s.day < todayIn(s.tz, now);
}

export async function answersFor(sessionId: string): Promise<AnswerRow[]> {
  const { data, error } = await supabase.from("order_sheet_answers").select("*").eq("session_id", sessionId);
  if (error) return [];
  return ((data as AnswerRow[]) ?? []).map((r) => ({ ...r, note: r.note ?? "" }));
}

export async function staffNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return new Map();
  const { data } = await supabase.from("staff").select("id, name").in("id", unique);
  return new Map(((data as { id: string; name: string }[]) ?? []).map((s) => [s.id, s.name ?? ""]));
}

async function assignmentStatus(sessionId: string, staffId: string): Promise<string | null> {
  const { data, error } = await supabase.from("event_assignments").select("status").eq("session_id", sessionId).eq("staff_id", staffId).maybeSingle();
  if (error || !data) return null;
  return (data as { status: string }).status;
}

/**
 * An admin looking at the staff event page in Bartender view. There are two
 * ways in: the view switch (a cookie: role becomes bartender, bartenderView
 * set) and the manager view's "Bartender view" link (?as=bartender: no cookie,
 * so the role stays admin or manager). Admins without either are sent to the
 * manager view before the page loads, so an admin role here means Bartender view.
 * Receipts decides the same way.
 */
export function inBartenderView(staff: Pick<ViewedStaff, "role" | "bartenderView">): boolean {
  return !!staff.bartenderView || isAdminRole(staff.role);
}

/** Accepted on the event (any role), or an admin in Bartender view. */
export function canSeeList(status: string | null | undefined, staff: Pick<ViewedStaff, "role" | "bartenderView">): boolean {
  return status === "accepted" || inBartenderView(staff);
}

/**
 * The list for this viewer, or null when they may not see it: accepted on the
 * event (any role), or an admin in Bartender view (read only unless they also
 * accepted). Offered, declined, and everyone else see nothing.
 * Pass `status` when the caller already read the assignment (the event page).
 * Once they may see it, a failure building the list is logged and the tab
 * gets the not ready line: it never hides the tab.
 */
export async function staffListFor(session: SessionLike, staff: ViewedStaff, now: Date = new Date(), status?: string | null): Promise<StaffListView | null> {
  const st = status !== undefined ? status : await assignmentStatus(session.id, staff.id);
  const accepted = st === "accepted";
  if (!canSeeList(st, staff)) return null;
  let over = false;
  try {
    over = eventOver(session, now);
  } catch (err) {
    console.error(`[shopping list] ${session.id}: could not read the event times:`, err);
  }
  const canAnswer = accepted && !over;
  const readOnlyNote = over ? LIST_READ_ONLY : accepted ? "" : LIST_PREVIEW;
  try {
    const [{ sheet, stores }, answers, textSent] = await Promise.all([staffSheet(session), answersFor(session.id), readyTextSent(session.id)]);
    const names = await staffNames(answers.map((a) => a.staff_id));
    return staffList({ sessionId: session.id, sheet, stores, answers, names, viewerId: staff.id, canAnswer, readOnlyNote, textSent });
  } catch (err) {
    console.error(`[shopping list] ${session.id}: could not build the list, showing not ready:`, err);
    return notReadyView({ sessionId: session.id, canAnswer, readOnlyNote });
  }
}

/** A "list is ready" text already went out to someone on this event (by the cron or Text the team the list). */
async function readyTextSent(sessionId: string): Promise<boolean> {
  const { data, error } = await supabase.from("order_sheet_ready_texts").select("id").eq("session_id", sessionId).eq("status", "sent").limit(1);
  return !error && ((data as unknown[] | null) ?? []).length > 0;
}

export type SaveResult = { ok: true; view: StaffListView } | { ok: false; error: string; status: number };

/** Save, change, or undo one person's answer or note on one line. Never touches the line itself. */
export async function saveAnswer(session: SessionLike, staff: ViewedStaff, raw: { ref?: unknown; answer?: unknown; note?: unknown }, now: Date = new Date()): Promise<SaveResult> {
  if ((await assignmentStatus(session.id, staff.id)) !== "accepted") return { ok: false, error: "Only people who accepted this event can answer.", status: 403 };
  if (eventOver(session, now)) return { ok: false, error: LIST_READ_ONLY, status: 409 };
  if (typeof raw.ref !== "string") return { ok: false, error: "Bad request", status: 400 };
  const { sheet, stores } = await staffSheet(session);
  const line = sheet.sections.flatMap((s) => s.lines).find((l) => l.ref === raw.ref);
  if (!line) return { ok: false, error: "That item is no longer on the list. Reload the page.", status: 404 };
  const { data: existing, error: readErr } = await supabase.from("order_sheet_answers").select("*").eq("session_id", session.id).eq("line_ref", line.ref).eq("staff_id", staff.id).maybeSingle();
  if (readErr) return { ok: false, error: NOT_SET_UP, status: 503 };
  const saved = (existing as AnswerRow | null) ?? null;
  const change = cleanAnswer(groupOf(line, stores), { answer: raw.answer, note: raw.note }, saved);
  if (!change.ok) return { ok: false, error: change.error, status: 400 };
  const at = now.toISOString();
  if (!change.answer && !change.note) {
    if (saved) await supabase.from("order_sheet_answers").delete().eq("session_id", session.id).eq("line_ref", line.ref).eq("staff_id", staff.id);
  } else {
    const answerChanged = (saved?.answer ?? null) !== change.answer;
    const row = {
      session_id: session.id,
      line_ref: line.ref,
      staff_id: staff.id,
      answer: change.answer,
      note: change.note,
      // A new answer is about the line as it is now, and is not dismissed.
      store: answerChanged || !saved ? line.store : saved.store,
      dismissed_at: answerChanged ? null : (saved?.dismissed_at ?? null),
      dismissed_by_name: answerChanged ? null : (saved?.dismissed_by_name ?? null),
      updated_at: answerChanged || !saved ? at : saved.updated_at,
    };
    const { error } = await supabase.from("order_sheet_answers").upsert(row, { onConflict: "session_id,line_ref,staff_id" });
    if (error) return { ok: false, error: NOT_SET_UP, status: 503 };
  }
  const view = await staffListFor(session, staff, now);
  return view ? { ok: true, view } : { ok: false, error: "Only people who accepted this event can answer.", status: 403 };
}

// ----- The "list is ready" text -----

interface ReadyRow {
  id: string;
  session_id: string;
  staff_id: string;
  status: "pending" | "sent" | "skipped" | "failed";
  send_after: string;
}

async function acceptedPeople(sessionId: string): Promise<{ id: string; name: string; phone: string; active: boolean }[]> {
  const { data } = await supabase.from("event_assignments").select("staff_id, status, staff:staff_id (id, name, phone, active)").eq("session_id", sessionId).eq("status", "accepted");
  return ((data ?? []) as { staff: unknown }[])
    .map((r) => (Array.isArray(r.staff) ? r.staff[0] : r.staff) as { id: string; name: string; phone: string; active: boolean } | null)
    .filter((s): s is { id: string; name: string; phone: string; active: boolean } => !!s && s.active !== false);
}

export interface QueueResult {
  queued: number; // new texts, sent now or at 8 AM
  already: number; // people who already got it
  held: boolean; // quiet hours: the new ones go out at 8 AM
  error?: string;
}

/** One pending text for each accepted person who has none yet. Never for a past event. */
export async function queueReadyTexts(session: SessionLike, now: Date, manual: boolean): Promise<QueueResult> {
  if (eventPast(session, now)) return { queued: 0, already: 0, held: false, error: "This event is over." };
  const tz = eventSchedule(eventData(session as SessionRow)).tz;
  const [people, { data: rows, error }] = await Promise.all([acceptedPeople(session.id), supabase.from("order_sheet_ready_texts").select("staff_id").eq("session_id", session.id)]);
  if (error) return { queued: 0, already: 0, held: false, error: NOT_SET_UP };
  const had = new Set(((rows as { staff_id: string }[]) ?? []).map((r) => r.staff_id));
  const fresh = people.filter((p) => !had.has(p.id));
  const sendAfter = sendableAt(now, tz).toISOString();
  for (const p of fresh) {
    // The unique (session_id, staff_id) row is the guard: a second queue never adds another.
    await supabase.from("order_sheet_ready_texts").insert({ session_id: session.id, staff_id: p.id, status: "pending", manual, send_after: sendAfter });
  }
  return { queued: fresh.length, already: people.length - fresh.length, held: inQuietHours(now, tz) };
}

/** Send every pending text that is due. Each row is claimed before it is sent, so it goes once. */
export async function deliverReadyTexts(now: Date, only?: string): Promise<number> {
  let q = supabase.from("order_sheet_ready_texts").select("*").eq("status", "pending").lte("send_after", now.toISOString());
  if (only) q = q.eq("session_id", only);
  const { data, error } = await q;
  if (error || !data) return 0;
  let sent = 0;
  for (const r of data as ReadyRow[]) {
    const { data: claimed } = await supabase.from("order_sheet_ready_texts").update({ status: "sent", sent_at: now.toISOString() }).eq("id", r.id).eq("status", "pending").select("id");
    if (!claimed || claimed.length === 0) continue;
    const { data: s } = await supabase.from("sessions").select("*").eq("id", r.session_id).maybeSingle();
    const session = s as (SessionLike & { status?: string }) | null;
    const person = (await acceptedPeople(r.session_id)).find((p) => p.id === r.staff_id);
    // Still on the event, the event still ahead, and still in the day's waking hours.
    const tz = session ? eventSchedule(eventData(session as SessionRow)).tz : "America/Chicago";
    if (!session || session.status !== "submitted" || !person || eventPast(session, now)) {
      await supabase.from("order_sheet_ready_texts").update({ status: "skipped" }).eq("id", r.id);
      continue;
    }
    if (inQuietHours(now, tz)) {
      await supabase.from("order_sheet_ready_texts").update({ status: "pending", sent_at: null, send_after: sendableAt(now, tz).toISOString() }).eq("id", r.id);
      continue;
    }
    const ed = eventData(session as SessionRow);
    const message = readyText({ title: eventTitle(ed), date: shortDate(eventSchedule(ed).day), link: listLink(siteOrigin(), r.session_id) });
    if (await sendStaffText(person.phone, person.name, message)) sent++;
    else await supabase.from("order_sheet_ready_texts").update({ status: "failed" }).eq("id", r.id);
  }
  return sent;
}

/**
 * The cron: queue the text for upcoming events whose list is now mostly
 * sourced and that have someone accepted who has not had it, then send what
 * is due. Returns texts sent.
 */
export async function sendListReadyTexts(now: Date = new Date()): Promise<number> {
  const [{ data: acc }, { data: had, error }] = await Promise.all([
    supabase.from("event_assignments").select("session_id, staff_id").eq("status", "accepted"),
    supabase.from("order_sheet_ready_texts").select("session_id, staff_id"),
  ]);
  if (error) return 0; // before the migration
  const done = new Set(((had as { session_id: string; staff_id: string }[]) ?? []).map((r) => `${r.session_id}|${r.staff_id}`));
  const waiting = [...new Set(((acc as { session_id: string; staff_id: string }[]) ?? []).filter((a) => !done.has(`${a.session_id}|${a.staff_id}`)).map((a) => a.session_id))];
  if (waiting.length > 0) {
    const { data: sessions } = await supabase.from("sessions").select("*").in("id", waiting).eq("status", "submitted");
    for (const s of (sessions as SessionLike[]) ?? []) {
      if (eventPast(s, now)) continue;
      try {
        if (listReady((await staffSheet(s)).sheet)) await queueReadyTexts(s, now, false);
      } catch (err) {
        console.error(`[shopping list] ${s.id}: ready check failed:`, err);
      }
    }
  }
  return deliverReadyTexts(now);
}

/** "Text the team the list": queue it for everyone accepted who has not had it, and send it now unless it is quiet hours. */
export async function textTeamTheList(session: SessionLike, now: Date = new Date()): Promise<QueueResult & { sent: number; message: string }> {
  const q = await queueReadyTexts(session, now, true);
  if (q.error) return { ...q, sent: 0, message: q.error };
  const sent = q.held ? 0 : await deliverReadyTexts(now, session.id);
  const message =
    q.queued === 0
      ? q.already > 0
        ? "Everyone on the event already has the text."
        : "Nobody has accepted this event yet."
      : q.held
        ? `${q.queued === 1 ? "1 text goes" : `${q.queued} texts go`} out at 8 AM, after quiet hours.`
        : `Texted ${sent === 1 ? "1 person" : `${sent} people`}.`;
  return { ...q, sent, message };
}
