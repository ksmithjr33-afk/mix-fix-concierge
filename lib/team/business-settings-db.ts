// Business settings from team_settings. Server only. Reading is for any server
// code that figures pay; saving is admins only (never managers).

import { supabase } from "@/lib/supabase";
import type { StaffMember } from "@/lib/team/event-view";
import { isFullAdmin } from "@/lib/team/roles";
import type { MileageSettings } from "@/lib/team/pay";
import { COSTS_KEY, MILEAGE_KEY, readCosts, readMileage, validateCosts, validateMileage, type CostSettings } from "@/lib/team/business-settings";

async function raw(key: string): Promise<unknown> {
  const { data, error } = await supabase.from("team_settings").select("value").eq("key", key).maybeSingle();
  if (error || !data) return null;
  return (data as { value: unknown }).value;
}

export async function mileageSettings(): Promise<MileageSettings> {
  return readMileage(await raw(MILEAGE_KEY));
}

/** Costs feed the Business area only. Admins only: anyone else gets nothing. */
export async function costSettings(admin: StaffMember): Promise<CostSettings | null> {
  if (!isFullAdmin(admin.role)) return null;
  return readCosts(await raw(COSTS_KEY));
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string; status: number };

export async function saveBusinessSettings(admin: StaffMember, which: unknown, body: Record<string, unknown>): Promise<Result<MileageSettings | CostSettings>> {
  if (!isFullAdmin(admin.role)) return { ok: false, error: "Admins only.", status: 403 };
  const v = which === "mileage" ? validateMileage(body) : which === "costs" ? validateCosts(body) : null;
  if (!v) return { ok: false, error: "Unknown setting.", status: 400 };
  if (!v.ok) return { ok: false, error: v.error, status: 400 };
  const { error } = await supabase
    .from("team_settings")
    .upsert({ key: which === "mileage" ? MILEAGE_KEY : COSTS_KEY, value: v.value, updated_by: admin.id, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
  return { ok: true, value: v.value };
}
