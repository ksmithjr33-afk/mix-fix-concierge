// Usual order windows on the staff profile: the database side. Server only.
//
// The windows live on staff_profiles (delivery_windows, home_type,
// handoff_pref, delivery_notes), migration 20270102_delivery_availability.sql.
// Optional: they only prefill the per event Order window item
// (lib/team/order-window-db.ts). There is no weekly confirm any more. Before
// the migration runs, reads come back empty and saves say they could not
// save: nothing else breaks.

import { supabase } from "@/lib/supabase";
import type { StaffMember } from "@/lib/team/event-view";
import { canEditProfile } from "@/lib/team/profile";
import { cleanDelivery, readWeek, type DeliveryColumns, type HandoffPref, type HomeType, type WeekWindows } from "@/lib/team/delivery-availability";

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string; status: number };

type Row = DeliveryColumns & { staff_id: string; dropoff_time?: string | null };

async function rowFor(staffId: string): Promise<Row | null> {
  const { data, error } = await supabase.from("staff_profiles").select("*").eq("staff_id", staffId).maybeSingle();
  if (error) return null;
  return (data as Row | null) ?? null;
}

async function exists(id: string): Promise<boolean> {
  const { data } = await supabase.from("staff").select("id").eq("id", id).maybeSingle();
  return !!data;
}

export interface DeliveryView {
  staffId: string;
  windows: WeekWindows | null;
  homeType: HomeType | null;
  handoffPref: HandoffPref | null;
  notes: string;
  oldNote: string; // the old free text drop off time, shown until this section is saved
  self: boolean; // the viewer is the person
}

function toView(viewer: { id: string }, staffId: string, row: Row | null): DeliveryView {
  return {
    staffId,
    windows: readWeek(row?.delivery_windows),
    homeType: (row?.home_type as HomeType | null) ?? null,
    handoffPref: (row?.handoff_pref as HandoffPref | null) ?? null,
    notes: row?.delivery_notes ?? "",
    oldNote: row?.dropoff_time ?? "",
    self: viewer.id === staffId,
  };
}

/** The section as the person or an admin sees it. Null for anyone else. */
export async function viewDelivery(viewer: StaffMember, staffId: string): Promise<DeliveryView | null> {
  if (!canEditProfile(viewer, staffId)) return null;
  const [found, row] = await Promise.all([exists(staffId), rowFor(staffId)]);
  if (!found) return null;
  return toView(viewer, staffId, row);
}

/** Save the section (the person, or an admin for them). Saving replaces the old free text drop off note. */
export async function saveDelivery(actor: StaffMember, staffId: string, raw: Record<string, unknown>, now: Date = new Date()): Promise<Result<{ delivery: DeliveryView }>> {
  if (!canEditProfile(actor, staffId)) return { ok: false, error: "You can only change your own profile.", status: 403 };
  if (!(await exists(staffId))) return { ok: false, error: "We could not find that person.", status: 404 };
  const c = cleanDelivery(raw);
  if (!c.ok) return { ok: false, error: c.error, status: 400 };
  const patch: Record<string, unknown> = { staff_id: staffId, ...c.value, dropoff_time: null, updated_by: actor.id, updated_at: now.toISOString() };
  const { error } = await supabase.from("staff_profiles").upsert(patch, { onConflict: "staff_id" });
  if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
  return { ok: true, delivery: toView(actor, staffId, await rowFor(staffId)) };
}
