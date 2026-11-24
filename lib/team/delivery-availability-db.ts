// Deliveries and pickups: the database side. Server only.
//
// The windows live on staff_profiles (delivery_windows, home_type,
// handoff_pref, delivery_notes, availability_confirmed_at), migration
// 20270102_delivery_availability.sql. The weekly deadline is a team setting
// (delivery_confirm_deadline). Before the migration runs, reads come back
// empty and saves say they could not save: nothing else breaks.

import { supabase } from "@/lib/supabase";
import type { StaffMember } from "@/lib/team/event-view";
import { firstName } from "@/lib/team/event-view";
import { canEditProfile } from "@/lib/team/profile";
import { isAdminRole, isFullAdmin } from "@/lib/team/roles";
import { claimNotice, siteOrigin } from "@/lib/team/clock-db";
import { sendStaffText } from "@/lib/team/sms";
import { inQuietHours } from "@/lib/team/shifts";
import { marketTz, staffMarketsOf } from "@/lib/team/markets";
import {
  cleanDeadline,
  cleanDelivery,
  DEADLINE_KEY,
  deadlineRule,
  eventAvailability,
  mustConfirm,
  readDeadline,
  readWeek,
  reminderDue,
  reminderKey,
  reminderText,
  weekStatus,
  type Deadline,
  type DeliveryColumns,
  type EventAvailability,
  type HandoffPref,
  type HomeType,
  type WeekStatus,
  type WeekWindows,
} from "@/lib/team/delivery-availability";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number };

interface Person {
  id: string;
  name: string;
  phone: string;
  role: string;
  active: boolean;
  markets?: unknown;
}

type Row = DeliveryColumns & { staff_id: string; dropoff_time?: string | null };

export async function deliveryDeadline(): Promise<Deadline> {
  const { data, error } = await supabase.from("team_settings").select("value").eq("key", DEADLINE_KEY).maybeSingle();
  if (error || !data) return readDeadline(null);
  return readDeadline((data as { value: unknown }).value);
}

/** Admins only (not managers): change the weekly deadline. */
export async function saveDeliveryDeadline(admin: StaffMember, raw: Record<string, unknown>): Promise<Result<{ deadline: Deadline; rule: string }>> {
  if (!isFullAdmin(admin.role)) return { ok: false, error: "Admins only.", status: 403 };
  const c = cleanDeadline(raw);
  if (!c.ok) return { ok: false, error: c.error, status: 400 };
  const { error } = await supabase.from("team_settings").upsert({ key: DEADLINE_KEY, value: c.value, updated_by: admin.id, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
  return { ok: true, deadline: c.value, rule: deadlineRule(c.value) };
}

async function rowFor(staffId: string): Promise<Row | null> {
  const { data, error } = await supabase.from("staff_profiles").select("*").eq("staff_id", staffId).maybeSingle();
  if (error) return null;
  return (data as Row | null) ?? null;
}

async function rowsFor(ids: string[]): Promise<Map<string, Row>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase.from("staff_profiles").select("*").in("staff_id", ids);
  if (error || !data) return new Map();
  return new Map((data as Row[]).map((r) => [r.staff_id, r]));
}

async function person(id: string): Promise<Person | null> {
  const { data } = await supabase.from("staff").select("*").eq("id", id).maybeSingle();
  return (data as Person | null) ?? null;
}

export interface DeliveryView {
  staffId: string;
  windows: WeekWindows | null;
  homeType: HomeType | null;
  handoffPref: HandoffPref | null;
  notes: string;
  oldNote: string; // the old free text drop off time, shown until this section is saved
  status: WeekStatus;
  asked: boolean; // this person is asked to confirm each week
  self: boolean; // the viewer is the person (only they confirm)
}

function toView(viewer: { id: string }, p: Person, row: Row | null, now: Date, d: Deadline): DeliveryView {
  return {
    staffId: p.id,
    windows: readWeek(row?.delivery_windows),
    homeType: (row?.home_type as HomeType | null) ?? null,
    handoffPref: (row?.handoff_pref as HandoffPref | null) ?? null,
    notes: row?.delivery_notes ?? "",
    oldNote: row?.dropoff_time ?? "",
    status: weekStatus(row, now, d),
    asked: mustConfirm(p),
    self: viewer.id === p.id,
  };
}

/** The section as the person or an admin sees it. Null for anyone else. */
export async function viewDelivery(viewer: StaffMember, staffId: string, now: Date = new Date()): Promise<DeliveryView | null> {
  if (!canEditProfile(viewer, staffId)) return null;
  const [p, row, d] = await Promise.all([person(staffId), rowFor(staffId), deliveryDeadline()]);
  if (!p) return null;
  return toView(viewer, p, row, now, d);
}

/**
 * Save the section. The person saving their own confirms the week; an admin
 * saving someone's does not confirm for them. Saving replaces the old free
 * text drop off note.
 */
export async function saveDelivery(actor: StaffMember, staffId: string, raw: Record<string, unknown>, now: Date = new Date()): Promise<Result<{ delivery: DeliveryView }>> {
  if (!canEditProfile(actor, staffId)) return { ok: false, error: "You can only change your own profile.", status: 403 };
  const p = await person(staffId);
  if (!p) return { ok: false, error: "We could not find that person.", status: 404 };
  const c = cleanDelivery(raw);
  if (!c.ok) return { ok: false, error: c.error, status: 400 };
  const patch: Record<string, unknown> = { staff_id: staffId, ...c.value, dropoff_time: null, updated_by: actor.id, updated_at: now.toISOString() };
  if (actor.id === staffId) patch.availability_confirmed_at = now.toISOString();
  const { error } = await supabase.from("staff_profiles").upsert(patch, { onConflict: "staff_id" });
  if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
  return { ok: true, delivery: toView(actor, p, await rowFor(staffId), now, await deliveryDeadline()) };
}

/** "Still correct for this week": the person themself, once their times are filled in. */
export async function confirmDelivery(actor: StaffMember, now: Date = new Date()): Promise<Result<{ delivery: DeliveryView }>> {
  const p = await person(actor.id);
  if (!p) return { ok: false, error: "Sign in again.", status: 401 };
  const row = await rowFor(actor.id);
  if (!readWeek(row?.delivery_windows)) return { ok: false, error: "Fill in your deliveries and pickups times first, then save.", status: 400 };
  const { error } = await supabase.from("staff_profiles").update({ availability_confirmed_at: now.toISOString() }).eq("staff_id", actor.id);
  if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
  return { ok: true, delivery: toView(actor, p, await rowFor(actor.id), now, await deliveryDeadline()) };
}

/** The home screen card: only for people asked to confirm, and only until they do. */
export async function myDeliveryReminder(staff: StaffMember, now: Date = new Date()): Promise<WeekStatus | null> {
  if (!mustConfirm(staff)) return null;
  const [row, d] = await Promise.all([rowFor(staff.id), deliveryDeadline()]);
  const s = weekStatus(row, now, d);
  return s.confirmed ? null : s;
}

export interface ConfirmationList {
  deadline: string;
  rule: string;
  deadlineSetting: Deadline;
  confirmed: { id: string; name: string; at: string }[];
  notConfirmed: { id: string; name: string; set: boolean }[];
}

/** Admins and managers: who has and has not confirmed this week. Nobody is reassigned. */
export async function confirmationList(viewer: StaffMember, now: Date = new Date()): Promise<ConfirmationList | null> {
  if (!isAdminRole(viewer.role)) return null;
  const { data } = await supabase.from("staff").select("*").eq("active", true).order("name");
  const staff = ((data as Person[]) ?? []).filter(mustConfirm);
  const [rows, d] = await Promise.all([rowsFor(staff.map((s) => s.id)), deliveryDeadline()]);
  const out: ConfirmationList = { deadline: weekStatus(null, now, d).deadline, rule: deadlineRule(d), deadlineSetting: d, confirmed: [], notConfirmed: [] };
  for (const s of staff) {
    const st = weekStatus(rows.get(s.id) ?? null, now, d);
    if (st.confirmed) out.confirmed.push({ id: s.id, name: s.name, at: st.confirmedAt! });
    else out.notConfirmed.push({ id: s.id, name: s.name, set: st.set });
  }
  return out;
}

/** For the event's Team tab and order sheet: each assigned person's windows. Admin side only. */
export async function availabilityFor(staffIds: string[], eventYmd: string | null, now: Date = new Date()): Promise<Map<string, EventAvailability>> {
  const rows = await rowsFor(staffIds);
  return new Map(staffIds.map((id) => [id, eventAvailability(id, rows.get(id) ?? null, eventYmd, now)]));
}

/**
 * Cron, every 5 minutes. On Wednesday from 9 AM Central: one text, once a
 * week, to each person asked to confirm who has not. Held while it is quiet
 * hours where they live (8 AM in Los Angeles). Returns texts sent.
 */
export async function sendDeliveryReminders(now: Date = new Date()): Promise<number> {
  if (!reminderDue(now)) return 0;
  const { data, error } = await supabase.from("staff").select("*").eq("active", true);
  if (error || !data) return 0;
  const staff = (data as Person[]).filter(mustConfirm);
  const { error: tableErr } = await supabase.from("staff_profiles").select("availability_confirmed_at").limit(1);
  if (tableErr) return 0; // before the migration
  const [rows, d] = await Promise.all([rowsFor(staff.map((s) => s.id)), deliveryDeadline()]);
  let sent = 0;
  for (const s of staff) {
    const st = weekStatus(rows.get(s.id) ?? null, now, d);
    if (st.confirmed || !s.phone) continue;
    if (inQuietHours(now, marketTz(staffMarketsOf(s)[0] ?? null))) continue;
    if (!(await claimNotice(reminderKey(now, s.id), "delivery_confirm"))) continue;
    const ok = await sendStaffText(s.phone, s.name, reminderText({ firstName: firstName(s.name), deadline: st.deadline, link: `${siteOrigin()}/team/me/profile#deliveries` }));
    if (ok) sent++;
  }
  return sent;
}
