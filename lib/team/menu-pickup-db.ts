// Database side of the cocktail menu pickup. Server only.
//
// One row per event in event_menu_pickups (no row means nobody is assigned),
// and every change in event_menu_pickup_log. Admins set the store and the
// person; a bartender can only check "Picked up" on their own assigned
// pickup; only an admin can undo it. A new assignee gets one text, held for
// quiet hours and sent by the cron at 8:00 AM.

import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import { firstName, type StaffMember } from "@/lib/team/event-view";
import { eventTitle } from "@/lib/team/event-list";
import { eventData } from "@/lib/team/markets";
import { eventSchedule, shortDate, todayIn } from "@/lib/team/time";
import { sendStaffText } from "@/lib/team/sms";
import { claimNotice, siteOrigin } from "@/lib/team/clock-db";
import { alertAdmins, getAssignment, getSubmittedSession } from "@/lib/team/events";
import { hiddenEventIds } from "@/lib/team/hidden";
import { inQuietHours, sendableAt } from "@/lib/team/shifts";
import {
  assignedText,
  canMarkPickedUp,
  cleanPickupInput,
  morningReminderDue,
  morningText,
  pickedUpLine,
  pickupBadge,
  pickupOutstanding,
  pickupState,
  storeName,
  unassignedAlertDue,
  unassignedText,
  undoneLine,
  type PickupRow,
  type PickupState,
} from "@/lib/team/menu-pickup";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number };

export interface PickupAdminView {
  sessionId: string;
  store: string; // "walmart" | "walgreens" | "other" | ""
  storeOther: string;
  locationNote: string;
  orderNumber: string;
  assigneeId: string;
  assigneeName: string;
  notNeeded: boolean;
  state: PickupState;
  pickedUpLine: string; // "Picked up by Taylor, Nov 12, 3:40 PM"
  undoneLine: string;
  outstanding: boolean; // inside 48 hours and not picked up or nobody assigned
}

export interface MyPickup {
  sessionId: string;
  title: string;
  date: string; // "Sat, Nov 14"
  store: string;
  note: string;
  order: string;
  eventHref: string | null; // their event page, when they are on the event
  printFileHref: string | null; // "Download print file": the approved menu, once it is uploaded
}

interface Person {
  id: string;
  name: string;
  phone: string;
  role: string;
  active: boolean;
}

export async function getPickup(sessionId: string): Promise<PickupRow | null> {
  const { data, error } = await supabase.from("event_menu_pickups").select("*").eq("session_id", sessionId).maybeSingle();
  if (error) return null; // before the table exists
  return (data as PickupRow | null) ?? null;
}

/** The pickup rows for these events. */
export async function pickupsFor(sessionIds: string[]): Promise<Map<string, PickupRow>> {
  if (sessionIds.length === 0) return new Map();
  const { data, error } = await supabase.from("event_menu_pickups").select("*").in("session_id", sessionIds);
  if (error || !data) return new Map();
  return new Map((data as PickupRow[]).map((r) => [r.session_id, r]));
}

async function person(id: string | null): Promise<Person | null> {
  if (!id) return null;
  const { data } = await supabase.from("staff").select("id, name, phone, role, active").eq("id", id).maybeSingle();
  return (data as Person | null) ?? null;
}

/** First names for the assignees, for list badges and calendar chips. */
export async function assigneeNames(rows: Iterable<PickupRow>): Promise<Map<string, string>> {
  const ids = [...new Set([...rows].map((r) => r.assignee_id).filter((x): x is string => !!x))];
  if (ids.length === 0) return new Map();
  const { data } = await supabase.from("staff").select("id, name").in("id", ids);
  return new Map(((data as { id: string; name: string }[]) ?? []).map((s) => [s.id, firstName(s.name) || s.name]));
}

/** The status shown on the admin events list and calendar chips, per event. */
export async function pickupBadges(sessionIds: string[]): Promise<Map<string, { state: PickupState; text: string } | null>> {
  const rows = await pickupsFor(sessionIds);
  const names = await assigneeNames(rows.values());
  return new Map(sessionIds.map((id) => [id, pickupBadge(rows.get(id) ?? null, names)]));
}

export async function adminPickupView(session: SessionRow, now: Date = new Date()): Promise<PickupAdminView> {
  const row = await getPickup(session.id);
  const ed = eventData(session);
  const tz = eventSchedule(ed).tz;
  const who = await person(row?.assignee_id ?? null);
  return {
    sessionId: session.id,
    store: row?.store ?? "",
    storeOther: row?.store_other ?? "",
    locationNote: row?.location_note ?? "",
    orderNumber: row?.order_number ?? "",
    assigneeId: row?.assignee_id ?? "",
    assigneeName: firstName(who?.name) || who?.name || "",
    notNeeded: !!row?.not_needed,
    state: pickupState(row),
    pickedUpLine: pickedUpLine(row, tz),
    undoneLine: undoneLine(row, tz),
    outstanding: pickupOutstanding(row, ed, now),
  };
}

async function log(sessionId: string, action: string, by: StaffMember, detail: string, now: Date): Promise<void> {
  const { error } = await supabase
    .from("event_menu_pickup_log")
    .insert({ session_id: sessionId, action, detail: detail || null, by_id: by.id, by_name: firstName(by.name) || by.name, created_at: now.toISOString() });
  if (error) console.error("[menu-pickup] log failed:", error.message);
}

function textFields(session: SessionRow, row: Pick<PickupRow, "store" | "store_other" | "location_note" | "order_number">) {
  const ed = eventData(session);
  return {
    title: eventTitle(ed),
    date: shortDate(eventSchedule(ed).day),
    store: storeName(row),
    note: row.location_note ?? "",
    order: row.order_number ?? "",
    link: `${siteOrigin()}/team/events`,
  };
}

/** Send the assignment text now, unless it is quiet hours: then the cron sends it at 8:00 AM. */
async function notifyAssignee(session: SessionRow, row: PickupRow, now: Date): Promise<void> {
  const tz = eventSchedule(eventData(session)).tz;
  if (inQuietHours(now, tz)) {
    await supabase.from("event_menu_pickups").update({ notify_after: sendableAt(now, tz).toISOString(), notified_at: null }).eq("session_id", session.id);
    return;
  }
  const p = await person(row.assignee_id);
  if (!p || !p.active) return;
  await supabase.from("event_menu_pickups").update({ notify_after: null, notified_at: now.toISOString() }).eq("session_id", session.id);
  await sendStaffText(p.phone, p.name, assignedText({ firstName: firstName(p.name), ...textFields(session, row) }));
}

/** Admin: save the store, note, order number, person, and "No printed menu". Admins only: the caller checks. */
export async function savePickup(sessionId: string, admin: StaffMember, raw: Record<string, unknown>, now: Date = new Date()): Promise<Result<{ view: PickupAdminView }>> {
  if (admin.role !== "admin") return { ok: false, error: "Admins only.", status: 403 };
  const session = await getSubmittedSession(sessionId);
  if (!session) return { ok: false, error: "We could not find that event.", status: 404 };
  const { data: active } = await supabase.from("staff").select("id").eq("active", true);
  const clean = cleanPickupInput(raw, new Set(((active as { id: string }[]) ?? []).map((s) => s.id)));
  if (!clean.ok) return { ok: false, error: clean.error, status: 400 };
  const before = await getPickup(sessionId);
  const v = clean.value;
  const newAssignee = !!v.assignee_id && v.assignee_id !== (before?.assignee_id ?? null);
  const patch: Record<string, unknown> = {
    session_id: sessionId,
    ...v,
    updated_at: now.toISOString(),
    ...(newAssignee ? { assigned_by: admin.id, assigned_at: now.toISOString(), notified_at: null, notify_after: null } : {}),
    ...(!v.assignee_id ? { assigned_by: null, assigned_at: null, notify_after: null } : {}),
  };
  const { data, error } = await supabase.from("event_menu_pickups").upsert(patch, { onConflict: "session_id" }).select("*");
  const row = ((data as PickupRow[]) ?? [])[0];
  if (error || !row) return { ok: false, error: "Could not save. Try again.", status: 500 };

  if (!!before?.not_needed !== v.not_needed) await log(sessionId, v.not_needed ? "not_needed" : "needed", admin, "", now);
  if (newAssignee) {
    const p = await person(v.assignee_id);
    await log(sessionId, "assigned", admin, firstName(p?.name) || p?.name || "", now);
  } else {
    await log(sessionId, "saved", admin, "", now);
  }
  // One text to a new assignee, unless the menu is not needed or already picked up.
  if (newAssignee && !v.not_needed && !row.picked_up_at) {
    try {
      await notifyAssignee(session, row, now);
    } catch (err) {
      console.error("[menu-pickup] assignment text failed:", err instanceof Error ? err.message : String(err));
    }
  }
  return { ok: true, view: await adminPickupView(session, now) };
}

/** Check "Picked up": records who and when. Bartenders only on their own assigned pickup. */
export async function markPickedUp(sessionId: string, staff: StaffMember, now: Date = new Date()): Promise<Result<{ line: string }>> {
  const session = await getSubmittedSession(sessionId);
  if (!session) return { ok: false, error: "We could not find that event.", status: 404 };
  const row = await getPickup(sessionId);
  const tz = eventSchedule(eventData(session)).tz;
  if (!canMarkPickedUp(staff, row)) {
    return { ok: false, error: !row?.assignee_id || row.not_needed ? "There is no menu pickup to mark on this event." : "Only the person picking it up or an admin can mark this.", status: 403 };
  }
  if (row!.picked_up_at) return { ok: true, line: pickedUpLine(row, tz) };
  const name = firstName(staff.name) || staff.name;
  const { data, error } = await supabase
    .from("event_menu_pickups")
    .update({ picked_up_at: now.toISOString(), picked_up_by: staff.id, picked_up_by_name: name, updated_at: now.toISOString() })
    .eq("session_id", sessionId)
    .is("picked_up_at", null)
    .select("*");
  const updated = ((data as PickupRow[]) ?? [])[0];
  if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
  if (!updated) return { ok: true, line: pickedUpLine(await getPickup(sessionId), tz) }; // someone else got there first
  await log(sessionId, "picked_up", staff, "", now);
  return { ok: true, line: pickedUpLine(updated, tz) };
}

/** Admin: undo "Picked up". The undo is recorded on the row and in the log. */
export async function undoPickedUp(sessionId: string, admin: StaffMember, now: Date = new Date()): Promise<Result<{ view: PickupAdminView }>> {
  if (admin.role !== "admin") return { ok: false, error: "Only an admin can undo this.", status: 403 };
  const session = await getSubmittedSession(sessionId);
  if (!session) return { ok: false, error: "We could not find that event.", status: 404 };
  const row = await getPickup(sessionId);
  if (!row?.picked_up_at) return { ok: true, view: await adminPickupView(session, now) };
  const name = firstName(admin.name) || admin.name;
  const { error } = await supabase
    .from("event_menu_pickups")
    .update({ picked_up_at: null, picked_up_by: null, picked_up_by_name: null, undone_at: now.toISOString(), undone_by: admin.id, undone_by_name: name, updated_at: now.toISOString() })
    .eq("session_id", sessionId);
  if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
  await log(sessionId, "undo", admin, `was picked up by ${row.picked_up_by_name ?? "someone"}`, now);
  return { ok: true, view: await adminPickupView(session, now) };
}

/** This person's pickups still to do: assigned to them, not picked up, event today or later and not hidden. */
export async function myPickups(staff: StaffMember, now: Date = new Date()): Promise<MyPickup[]> {
  const { data, error } = await supabase.from("event_menu_pickups").select("*").eq("assignee_id", staff.id);
  if (error || !data) return [];
  const rows = (data as PickupRow[]).filter((r) => pickupState(r) === "assigned");
  if (rows.length === 0) return [];
  const hidden = await hiddenEventIds();
  // Events with an approved menu uploaded (read here directly: the approved menu module reads pickups).
  const { data: files } = await supabase.from("event_menu_files").select("session_id, status").in("session_id", rows.map((r) => r.session_id)).eq("status", "current");
  const withFile = new Set(((files as { session_id: string }[]) ?? []).map((f) => f.session_id));
  const out: (MyPickup & { day: string })[] = [];
  for (const r of rows) {
    if (hidden.has(r.session_id)) continue;
    const session = await getSubmittedSession(r.session_id);
    if (!session) continue;
    const ed = eventData(session);
    const s = eventSchedule(ed);
    if (!s.day || s.day < todayIn(s.tz, now)) continue;
    const a = staff.role === "admin" ? null : await getAssignment(r.session_id, staff.id);
    const onEvent = staff.role === "admin" || (!!a && a.status !== "declined");
    const f = textFields(session, r);
    out.push({
      sessionId: r.session_id,
      title: f.title,
      date: f.date,
      store: f.store,
      note: f.note,
      order: f.order,
      eventHref: onEvent ? (staff.role === "admin" ? `/team/admin/e/${encodeURIComponent(r.session_id)}` : `/team/e/${encodeURIComponent(r.session_id)}`) : null,
      printFileHref: withFile.has(r.session_id) ? `/api/team/menu-file?sessionId=${encodeURIComponent(r.session_id)}&download=1` : null,
      day: s.day,
    });
  }
  out.sort((a, b) => a.day.localeCompare(b.day));
  return out.map((p) => ({ sessionId: p.sessionId, title: p.title, date: p.date, store: p.store, note: p.note, order: p.order, eventHref: p.eventHref, printFileHref: p.printFileHref }));
}

/** One of this person's pickups, for their event page. */
export async function myPickupFor(sessionId: string, staff: StaffMember, now: Date = new Date()): Promise<MyPickup | null> {
  return (await myPickups(staff, now)).find((p) => p.sessionId === sessionId) ?? null;
}

/**
 * Cron, every 5 minutes. Sends assignment texts held for quiet hours, one
 * reminder to the assigned person the morning of the event when the menu is
 * still not picked up, and one alert to admins when nobody is assigned 24
 * hours before the event. Returns texts sent.
 */
export async function sendMenuPickupNotices(now: Date = new Date()): Promise<number> {
  const { data: rowData, error } = await supabase.from("event_menu_pickups").select("*");
  if (error) return 0; // before the table exists
  const rows = new Map(((rowData as PickupRow[]) ?? []).map((r) => [r.session_id, r]));
  const hidden = await hiddenEventIds();
  let sent = 0;

  // 1. Assignment texts held for quiet hours.
  for (const r of rows.values()) {
    if (!r.notify_after || r.notified_at || new Date(r.notify_after).getTime() > now.getTime()) continue;
    if (pickupState(r) !== "assigned") continue;
    const { data: claimed } = await supabase
      .from("event_menu_pickups")
      .update({ notify_after: null, notified_at: now.toISOString() })
      .eq("session_id", r.session_id)
      .eq("notify_after", r.notify_after)
      .select("session_id");
    if (((claimed as unknown[]) ?? []).length === 0) continue;
    const session = await getSubmittedSession(r.session_id);
    const p = await person(r.assignee_id);
    if (!session || !p || !p.active || hidden.has(r.session_id)) continue;
    if (await sendStaffText(p.phone, p.name, assignedText({ firstName: firstName(p.name), ...textFields(session, r) }))) sent++;
  }

  // 2 and 3 look at upcoming events only.
  const { data: sessionData } = await supabase.from("sessions").select("*").eq("status", "submitted");
  for (const session of (sessionData as SessionRow[]) ?? []) {
    if (hidden.has(session.id)) continue;
    const ed = eventData(session);
    const row = rows.get(session.id) ?? null;
    if (morningReminderDue(row, ed, now)) {
      const day = eventSchedule(ed).day;
      if (!(await claimNotice(`menu_pickup_morning:${session.id}:${row!.assignee_id}:${day}`, "menu_pickup_morning"))) continue;
      const p = await person(row!.assignee_id);
      if (!p || !p.active) continue;
      const f = textFields(session, row!);
      if (await sendStaffText(p.phone, p.name, morningText({ firstName: firstName(p.name), title: f.title, store: f.store, note: f.note, order: f.order, link: f.link }))) sent++;
    } else if (unassignedAlertDue(row, ed, now)) {
      if (!(await claimNotice(`menu_pickup_unassigned:${session.id}:${eventSchedule(ed).day}`, "menu_pickup_unassigned"))) continue;
      const message = unassignedText({ title: eventTitle(ed), date: shortDate(eventSchedule(ed).day), link: `${siteOrigin()}/team/admin/e/${encodeURIComponent(session.id)}` });
      const admins = await alertAdmins();
      const results = await Promise.all(admins.map((a) => sendStaffText(a.phone, a.name, message)));
      sent += results.filter(Boolean).length;
    }
  }
  return sent;
}
