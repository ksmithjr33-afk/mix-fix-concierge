// Database side of the ice pickup. Server only. Rules in lib/team/ice-pickup.ts.
//
// event_ice_pickups holds the recommended location, total bags and notes (one
// row per event); event_ice_pickup_people holds who is picking up ice (many per
// event), each with an optional bag count and their own "Picked up". Every
// change goes in event_ice_pickup_log.
//
// Who can do what (checked here, on the server):
// - Admins: set the location, total and notes; add, change and remove people
//   (any active staff or admin, on the event or not); mark picked up or undo
//   for anyone.
// - A person picking up ice: mark their own row picked up.
// - Someone on the event (accepted) who is not picking up ice: "I picked up the
//   ice instead". Covering for someone still not picked up marks that person's
//   row picked up, "Covered by [name]", so the ice can be complete without an
//   admin removing anyone; "Nobody, this is extra" adds them, picked up.
// Bartender view counts as a bartender (getCurrentStaff sets the role).

import { supabase } from "@/lib/supabase";
import type { SessionRow } from "@/lib/event-updates";
import { firstName, type StaffMember } from "@/lib/team/event-view";
import { eventTitle } from "@/lib/team/event-list";
import { eventData } from "@/lib/team/markets";
import { eventSchedule, shortDate, todayIn } from "@/lib/team/time";
import { sendStaffText } from "@/lib/team/sms";
import { siteOrigin } from "@/lib/team/clock-db";
import { getAssignment, getSubmittedSession } from "@/lib/team/events";
import { hiddenEventIds } from "@/lib/team/hidden";
import { inQuietHours, sendableAt } from "@/lib/team/shifts";
import { getSheetView } from "@/lib/order-sheet-db";
import {
  bagSummary,
  cleanBags,
  cleanIceInput,
  cleanPickedUp,
  effectiveBags,
  icePickedUpLine,
  iceState,
  iceOutstanding,
  iceText,
  iceUnassignedFlag,
  locationText,
  needsText,
  shoppingIceBags,
  type IcePersonRow,
  type IceRow,
  type IceState,
} from "@/lib/team/ice-pickup";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number };

export interface IcePersonView {
  staffId: string;
  name: string; // first name
  bags: number | null; // their count, or the total when they are the only one
  bagsSet: number | null; // the count an admin typed, for the manager's box
  pickedUp: boolean;
  line: string; // "Picked up, checked by Taylor, Dec 4, 3:40 PM · Kroger · 6 bags"
  selfAdded: boolean;
  coveredBy: string | null; // first name of whoever covered this person
  mine: boolean;
}

export interface IceView {
  sessionId: string;
  title: string;
  date: string; // "Sat, Dec 5"
  locationName: string;
  locationAddress: string;
  location: string; // "Kroger, 123 Main St"
  totalBags: number | null; // the saved total, else the Shopping list's
  savedTotal: number | null;
  listBags: number | null; // the Shopping list's ice, when it is calculated
  notes: string;
  people: IcePersonView[];
  state: IceState;
  bagLine: string; // "6 of 12 bags assigned"
  bagWarning: string;
  outstanding: boolean; // the Details count: inside 24 hours, not complete
  canEdit: boolean; // admins
  canInstead: boolean; // on the event and not picking up ice yet
  eventHref: string | null; // for the home screen card
}

export interface Place {
  name: string;
  address: string;
}

interface Person {
  id: string;
  name: string;
  phone: string;
  role: string;
  active: boolean;
}

export async function getIce(sessionId: string): Promise<IceRow | null> {
  const { data, error } = await supabase.from("event_ice_pickups").select("*").eq("session_id", sessionId).maybeSingle();
  if (error) return null; // before the table exists
  return (data as IceRow | null) ?? null;
}

export async function icePeople(sessionId: string): Promise<IcePersonRow[]> {
  const { data, error } = await supabase.from("event_ice_pickup_people").select("*").eq("session_id", sessionId).order("created_at", { ascending: true });
  if (error || !data) return [];
  return data as IcePersonRow[];
}

async function person(id: string | null): Promise<Person | null> {
  if (!id) return null;
  const { data } = await supabase.from("staff").select("id, name, phone, role, active").eq("id", id).maybeSingle();
  return (data as Person | null) ?? null;
}

async function names(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data } = await supabase.from("staff").select("id, name").in("id", unique);
  return new Map(((data as { id: string; name: string }[]) ?? []).map((s) => [s.id, firstName(s.name) || s.name]));
}

/**
 * The Shopping list's ice bags for this event, with any hand edits. Null when
 * there is no ice line, or no guest count to calculate it from (the list then
 * uses a default guest count, which is not a real ice amount).
 */
export async function listIceBags(session: SessionRow): Promise<number | null> {
  if (!hasGuestCount(session)) return null;
  try {
    return shoppingIceBags((await getSheetView(session)).sheet.sections);
  } catch {
    return null;
  }
}

function hasGuestCount(session: SessionRow): boolean {
  const guests = parseInt(String(eventData(session).guest_count ?? (session as { guest_count?: unknown }).guest_count ?? ""), 10);
  return Number.isFinite(guests) && guests > 0;
}

/** The same, from a Shopping list the caller already has (the manager view). */
export function sheetIceBags(session: SessionRow, sections: Parameters<typeof shoppingIceBags>[0]): number | null {
  return hasGuestCount(session) ? shoppingIceBags(sections) : null;
}

/** Accepted on the event, or an admin. Who may use "I picked up the ice instead". */
async function onEvent(sessionId: string, staff: StaffMember): Promise<boolean> {
  if (staff.role === "admin") return true;
  const a = await getAssignment(sessionId, staff.id);
  return a?.status === "accepted";
}

/**
 * The ice card's view for one viewer. listBags: pass it when the caller already
 * has it (the manager view reads the Shopping list anyway); otherwise it is
 * read only when no total is saved.
 */
export async function iceView(
  session: SessionRow,
  viewer: StaffMember,
  opts: { now?: Date; listBags?: number | null; eventHref?: string | null } = {}
): Promise<IceView> {
  const now = opts.now ?? new Date();
  const [row, people] = await Promise.all([getIce(session.id), icePeople(session.id)]);
  const listBags = opts.listBags !== undefined ? opts.listBags : row?.total_bags !== null && row?.total_bags !== undefined ? null : await listIceBags(session);
  const ed = eventData(session);
  const tz = eventSchedule(ed).tz;
  const who = await names(people.map((p) => p.staff_id));
  const total = row?.total_bags ?? listBags ?? null;
  const summary = bagSummary(people, total);
  const mine = people.some((p) => p.staff_id === viewer.id);
  return {
    sessionId: session.id,
    title: eventTitle(ed),
    date: shortDate(eventSchedule(ed).day),
    locationName: row?.location_name ?? "",
    locationAddress: row?.location_address ?? "",
    location: locationText(row),
    totalBags: total,
    savedTotal: row?.total_bags ?? null,
    listBags,
    notes: row?.notes ?? "",
    people: people.map((p) => ({
      staffId: p.staff_id,
      name: who.get(p.staff_id) ?? "Someone",
      bags: effectiveBags(p, people.length, total),
      bagsSet: p.bags_assigned,
      pickedUp: !!p.picked_up_at,
      line: icePickedUpLine(p, tz),
      selfAdded: !!p.self_added,
      coveredBy: p.covered_by_name ?? null,
      mine: p.staff_id === viewer.id,
    })),
    state: iceState(people),
    bagLine: summary.line,
    bagWarning: summary.warning,
    outstanding: iceOutstanding(people, ed, now),
    canEdit: viewer.role === "admin",
    canInstead: !mine && (await onEvent(session.id, viewer)),
    eventHref: opts.eventHref ?? null,
  };
}

/** Locations used before, most used first, for the manager's tap to reuse list. */
export async function pastPlaces(limit = 12): Promise<Place[]> {
  const [{ data: ice }, { data: people }] = await Promise.all([
    supabase.from("event_ice_pickups").select("location_name, location_address, updated_at"),
    supabase.from("event_ice_pickup_people").select("actual_location, picked_up_at"),
  ]);
  const seen = new Map<string, { place: Place; n: number; last: string }>();
  const add = (name: string | null, address: string | null, at: string | null) => {
    const n = (name ?? "").trim();
    if (!n) return;
    const key = n.toLowerCase();
    const e = seen.get(key);
    if (e) {
      e.n++;
      if (!e.place.address && address) e.place.address = address.trim();
      if ((at ?? "") > e.last) e.last = at ?? "";
    } else seen.set(key, { place: { name: n, address: (address ?? "").trim() }, n: 1, last: at ?? "" });
  };
  for (const r of (ice as { location_name: string | null; location_address: string | null; updated_at: string | null }[]) ?? []) add(r.location_name, r.location_address, r.updated_at);
  for (const r of (people as { actual_location: string | null; picked_up_at: string | null }[]) ?? []) add(r.actual_location, null, r.picked_up_at);
  return [...seen.values()]
    .sort((a, b) => b.n - a.n || b.last.localeCompare(a.last))
    .slice(0, limit)
    .map((e) => e.place);
}

async function log(sessionId: string, action: string, by: StaffMember, detail: string, now: Date): Promise<void> {
  const { error } = await supabase
    .from("event_ice_pickup_log")
    .insert({ session_id: sessionId, action, detail: detail || null, by_id: by.id, by_name: firstName(by.name) || by.name, created_at: now.toISOString() });
  if (error) console.error("[ice-pickup] log failed:", error.message);
}

const link = () => `${siteOrigin()}/team/events`;

/** Send one person's text now with what it says, recorded so it is not sent again. */
async function textPerson(session: SessionRow, p: IcePersonRow, bags: number | null, location: string, now: Date): Promise<boolean> {
  const who = await person(p.staff_id);
  if (!who || !who.active) return false;
  const update = !!p.notified_at;
  await supabase
    .from("event_ice_pickup_people")
    .update({ notify_after: null, notified_at: now.toISOString(), notified_bags: bags, notified_location: location })
    .eq("id", p.id);
  const ed = eventData(session);
  return sendStaffText(who.phone, who.name, iceText({ firstName: firstName(who.name), title: eventTitle(ed), date: shortDate(eventSchedule(ed).day), bags, location, update, link: link() }));
}

/**
 * Text everyone who needs it: new people, and people whose bag count or the
 * location changed since their last text. In quiet hours the text waits, and
 * the cron sends it at 8:00 AM with whatever is current then.
 */
async function notifyPeople(session: SessionRow, now: Date, listBags?: number | null): Promise<void> {
  try {
    const [row, people] = await Promise.all([getIce(session.id), icePeople(session.id)]);
    const total = row?.total_bags ?? (listBags !== undefined ? listBags : await listIceBags(session));
    const location = locationText(row);
    const tz = eventSchedule(eventData(session)).tz;
    for (const p of people) {
      const bags = effectiveBags(p, people.length, total);
      if (!needsText(p, bags, location)) continue;
      if (inQuietHours(now, tz)) {
        await supabase.from("event_ice_pickup_people").update({ notify_after: sendableAt(now, tz).toISOString() }).eq("id", p.id);
        continue;
      }
      await textPerson(session, p, bags, location, now);
    }
  } catch (err) {
    console.error("[ice-pickup] text failed:", err instanceof Error ? err.message : String(err));
  }
}

async function adminOnly(sessionId: string, admin: StaffMember): Promise<Result<{ session: SessionRow }>> {
  if (admin.role !== "admin") return { ok: false, error: "Admins only.", status: 403 };
  const session = await getSubmittedSession(sessionId);
  if (!session) return { ok: false, error: "We could not find that event.", status: 404 };
  return { ok: true, session };
}

/** Admin: the recommended location, address, total bags and notes. */
export async function saveIce(sessionId: string, admin: StaffMember, raw: Record<string, unknown>, now: Date = new Date()): Promise<Result<{ view: IceView }>> {
  const a = await adminOnly(sessionId, admin);
  if (!a.ok) return a;
  const clean = cleanIceInput(raw);
  if (!clean.ok) return { ok: false, error: clean.error, status: 400 };
  const { error } = await supabase
    .from("event_ice_pickups")
    .upsert({ session_id: sessionId, ...clean.value, updated_by: admin.id, updated_by_name: firstName(admin.name) || admin.name, updated_at: now.toISOString() }, { onConflict: "session_id" });
  if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
  await log(sessionId, "saved", admin, [clean.value.location_name, clean.value.total_bags !== null ? `${clean.value.total_bags} bags` : ""].filter(Boolean).join(", "), now);
  await notifyPeople(a.session, now);
  return { ok: true, view: await iceView(a.session, admin, { now }) };
}

/** Admin: add a person, or change their bag count. Any active staff member or admin. */
export async function assignIce(sessionId: string, admin: StaffMember, staffId: unknown, rawBags: unknown, now: Date = new Date()): Promise<Result<{ view: IceView }>> {
  const a = await adminOnly(sessionId, admin);
  if (!a.ok) return a;
  const bags = cleanBags(rawBags);
  if (!bags.ok) return { ok: false, error: "Bags must be a whole number.", status: 400 };
  const who = typeof staffId === "string" ? await person(staffId) : null;
  if (!who || !who.active) return { ok: false, error: "Pick an active team member.", status: 400 };
  const existing = (await icePeople(sessionId)).find((p) => p.staff_id === who.id);
  if (existing) {
    if (existing.bags_assigned !== bags.value) {
      const { error } = await supabase.from("event_ice_pickup_people").update({ bags_assigned: bags.value, updated_at: now.toISOString() }).eq("id", existing.id);
      if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
      await log(sessionId, "bags", admin, `${firstName(who.name)}: ${bags.value ?? "no count"}`, now);
    }
  } else {
    const { error } = await supabase.from("event_ice_pickup_people").insert({
      session_id: sessionId,
      staff_id: who.id,
      bags_assigned: bags.value,
      self_added: false,
      assigned_by: admin.id,
      assigned_by_name: firstName(admin.name) || admin.name,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    });
    if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
    await log(sessionId, "assigned", admin, firstName(who.name) || who.name, now);
  }
  await notifyPeople(a.session, now);
  return { ok: true, view: await iceView(a.session, admin, { now }) };
}

/** Admin: take a person off the ice pickup. */
export async function removeIce(sessionId: string, admin: StaffMember, staffId: unknown, now: Date = new Date()): Promise<Result<{ view: IceView }>> {
  const a = await adminOnly(sessionId, admin);
  if (!a.ok) return a;
  const row = (await icePeople(sessionId)).find((p) => p.staff_id === staffId);
  if (row) {
    const { error } = await supabase.from("event_ice_pickup_people").delete().eq("id", row.id);
    if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
    const n = await names([row.staff_id]);
    await log(sessionId, "removed", admin, n.get(row.staff_id) ?? "", now);
    // The one left may now carry the total as their count.
    await notifyPeople(a.session, now);
  }
  return { ok: true, view: await iceView(a.session, admin, { now }) };
}

/**
 * "I picked up the ice": a person marks their own row, or an admin marks
 * anyone's (staffId). Where and how many bags are optional.
 */
export async function markIce(sessionId: string, staff: StaffMember, raw: Record<string, unknown>, now: Date = new Date()): Promise<Result<{ view: IceView }>> {
  const session = await getSubmittedSession(sessionId);
  if (!session) return { ok: false, error: "We could not find that event.", status: 404 };
  const target = typeof raw.staffId === "string" && raw.staffId ? raw.staffId : staff.id;
  if (target !== staff.id && staff.role !== "admin") return { ok: false, error: "Only that person or an admin can mark this.", status: 403 };
  const clean = cleanPickedUp(raw);
  if (!clean.ok) return { ok: false, error: clean.error, status: 400 };
  const row = (await icePeople(sessionId)).find((p) => p.staff_id === target);
  if (!row) return { ok: false, error: target === staff.id ? "You are not picking up ice for this event." : "That person is not picking up ice for this event.", status: 403 };
  if (!row.picked_up_at) {
    const { error } = await supabase
      .from("event_ice_pickup_people")
      .update({
        picked_up_at: now.toISOString(),
        picked_up_by: staff.id,
        picked_up_by_name: firstName(staff.name) || staff.name,
        actual_location: clean.location,
        actual_bags: clean.bags,
        notify_after: null,
        updated_at: now.toISOString(),
      })
      .eq("id", row.id)
      .is("picked_up_at", null);
    if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
    const n = await names([target]);
    await log(sessionId, "picked_up", staff, target === staff.id ? "" : `for ${n.get(target) ?? "someone"}`, now);
  }
  return { ok: true, view: await iceView(session, staff, { now }) };
}

/**
 * "I picked up the ice instead": someone on the event who is not picking up
 * ice. coveringFor: the staff id of a person still not picked up, whose row is
 * marked picked up and covered by this person; blank ("Nobody, this is extra")
 * adds this person, picked up.
 */
export async function iceInstead(sessionId: string, staff: StaffMember, raw: Record<string, unknown>, now: Date = new Date()): Promise<Result<{ view: IceView }>> {
  const session = await getSubmittedSession(sessionId);
  if (!session) return { ok: false, error: "We could not find that event.", status: 404 };
  if (!staff.active || !(await onEvent(sessionId, staff))) return { ok: false, error: "Only people working this event can mark the ice.", status: 403 };
  const clean = cleanPickedUp(raw);
  if (!clean.ok) return { ok: false, error: clean.error, status: 400 };
  const people = await icePeople(sessionId);
  const existing = people.find((p) => p.staff_id === staff.id);
  if (existing) return markIce(sessionId, staff, { location: clean.location, bags: clean.bags }, now);
  const name = firstName(staff.name) || staff.name;
  const coveringFor = typeof raw.coveringFor === "string" ? raw.coveringFor.trim() : "";
  if (coveringFor) {
    const row = people.find((p) => p.staff_id === coveringFor);
    if (!row) return { ok: false, error: "That person is not picking up ice for this event.", status: 400 };
    const n = await names([row.staff_id]);
    const who = n.get(row.staff_id) ?? "That person";
    if (row.picked_up_at) return { ok: false, error: `${who} is already picked up. Refresh to see.`, status: 409 };
    const { data, error } = await supabase
      .from("event_ice_pickup_people")
      .update({
        picked_up_at: now.toISOString(),
        picked_up_by: staff.id,
        picked_up_by_name: name,
        covered_by: staff.id,
        covered_by_name: name,
        actual_location: clean.location,
        actual_bags: clean.bags,
        notify_after: null,
        updated_at: now.toISOString(),
      })
      .eq("id", row.id)
      .is("picked_up_at", null)
      .select("id");
    if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
    if (((data as unknown[]) ?? []).length === 0) return { ok: false, error: `${who} is already picked up. Refresh to see.`, status: 409 };
    await log(sessionId, "covered", staff, `for ${who}`, now);
    return { ok: true, view: await iceView(session, staff, { now }) };
  }
  const { error } = await supabase.from("event_ice_pickup_people").insert({
    session_id: sessionId,
    staff_id: staff.id,
    bags_assigned: null,
    self_added: true,
    picked_up_at: now.toISOString(),
    picked_up_by: staff.id,
    picked_up_by_name: name,
    actual_location: clean.location,
    actual_bags: clean.bags,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  });
  if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
  await log(sessionId, "picked_up_instead", staff, "", now);
  return { ok: true, view: await iceView(session, staff, { now }) };
}

/** Admin: undo one person's "Picked up". */
export async function undoIce(sessionId: string, admin: StaffMember, staffId: unknown, now: Date = new Date()): Promise<Result<{ view: IceView }>> {
  const a = await adminOnly(sessionId, admin);
  if (!a.ok) return a;
  const row = (await icePeople(sessionId)).find((p) => p.staff_id === staffId);
  if (row?.picked_up_at) {
    const { error } = await supabase
      .from("event_ice_pickup_people")
      .update({ picked_up_at: null, picked_up_by: null, picked_up_by_name: null, covered_by: null, covered_by_name: null, actual_location: null, actual_bags: null, updated_at: now.toISOString() })
      .eq("id", row.id);
    if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
    await log(sessionId, "undo", admin, row.covered_by_name ? `was covered by ${row.covered_by_name}` : `was checked by ${row.picked_up_by_name ?? "someone"}`, now);
  }
  return { ok: true, view: await iceView(a.session, admin, { now }) };
}

/** Events with "Ice not assigned": inside 48 hours of service start and nobody picking up ice. */
export async function iceUnassignedIds(sessions: SessionRow[], now: Date = new Date()): Promise<Set<string>> {
  const near = sessions.filter((s) => iceUnassignedFlag([], eventData(s), now));
  if (near.length === 0) return new Set();
  const { data, error } = await supabase.from("event_ice_pickup_people").select("session_id").in("session_id", near.map((s) => s.id));
  if (error) return new Set(); // before the table exists: no flag rather than a wrong one
  const has = new Set(((data as { session_id: string }[]) ?? []).map((r) => r.session_id));
  return new Set(near.filter((s) => !has.has(s.id)).map((s) => s.id));
}

/** The ice card on the bartender event page, for people on the event. */
export async function staffIceView(session: SessionRow, staff: StaffMember, now: Date = new Date()): Promise<IceView | null> {
  if (staff.role !== "admin") {
    const a = await getAssignment(session.id, staff.id);
    const assigned = (await icePeople(session.id)).some((p) => p.staff_id === staff.id);
    if (!assigned && (!a || a.status === "declined")) return null;
  }
  return iceView(session, staff, { now });
}

/** The home screen: this person's ice pickups still to do, event today or later and not hidden. */
export async function myIcePickups(staff: StaffMember, now: Date = new Date()): Promise<IceView[]> {
  const { data, error } = await supabase.from("event_ice_pickup_people").select("*").eq("staff_id", staff.id);
  if (error || !data) return [];
  const open = (data as IcePersonRow[]).filter((r) => !r.picked_up_at);
  if (open.length === 0) return [];
  const hidden = await hiddenEventIds();
  const out: { view: IceView; day: string }[] = [];
  for (const r of open) {
    if (hidden.has(r.session_id)) continue;
    const session = await getSubmittedSession(r.session_id);
    if (!session) continue;
    const s = eventSchedule(eventData(session));
    if (!s.day || s.day < todayIn(s.tz, now)) continue;
    const a = staff.role === "admin" ? null : await getAssignment(r.session_id, staff.id);
    const href = staff.role === "admin" ? `/team/admin/e/${encodeURIComponent(r.session_id)}` : a && a.status !== "declined" ? `/team/e/${encodeURIComponent(r.session_id)}` : null;
    out.push({ view: await iceView(session, staff, { now, eventHref: href }), day: s.day });
  }
  return out.sort((a, b) => a.day.localeCompare(b.day)).map((o) => o.view);
}

/** Cron, every 5 minutes: the ice texts held for quiet hours. Returns texts sent. */
export async function sendIcePickupNotices(now: Date = new Date()): Promise<number> {
  const { data, error } = await supabase.from("event_ice_pickup_people").select("*");
  if (error || !data) return 0; // before the table exists
  const due = (data as IcePersonRow[]).filter((r) => r.notify_after && !r.picked_up_at && new Date(r.notify_after).getTime() <= now.getTime());
  if (due.length === 0) return 0;
  const hidden = await hiddenEventIds();
  let sent = 0;
  for (const r of due) {
    // Claim it so two cron runs never both send.
    const { data: claimed } = await supabase.from("event_ice_pickup_people").update({ notify_after: null }).eq("id", r.id).eq("notify_after", r.notify_after).select("id");
    if (((claimed as unknown[]) ?? []).length === 0) continue;
    if (hidden.has(r.session_id)) continue;
    const session = await getSubmittedSession(r.session_id);
    if (!session) continue;
    const [row, people] = await Promise.all([getIce(r.session_id), icePeople(r.session_id)]);
    const total = row?.total_bags ?? (await listIceBags(session));
    const bags = effectiveBags(r, people.length, total);
    const location = locationText(row);
    // Changed back to what the last text said while it waited: nothing to send.
    if (r.notified_at && (r.notified_bags ?? null) === (bags ?? null) && (r.notified_location ?? "") === location) continue;
    if (await textPerson(session, r, bags, location, now)) sent++;
  }
  return sent;
}
