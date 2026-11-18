// Business settings from team_settings. Server only. Reading is for any server
// code that figures pay; saving is admins only (never managers).

import { supabase } from "@/lib/supabase";
import type { StaffMember } from "@/lib/team/event-view";
import { isFullAdmin } from "@/lib/team/roles";
import type { MileageSettings, PackageRates } from "@/lib/team/pay";
import {
  COSTS_KEY,
  MILEAGE_KEY,
  RATES_KEY,
  SUPPLIES_KEY,
  readCosts,
  readMileage,
  readPackageRates,
  readSupplies,
  validateCosts,
  validateMileage,
  validatePackageRates,
  validateSupplies,
  type CostSettings,
  type SuppliesPerGuest,
} from "@/lib/team/business-settings";

async function raw(key: string): Promise<unknown> {
  const { data, error } = await supabase.from("team_settings").select("value").eq("key", key).maybeSingle();
  if (error || !data) return null;
  return (data as { value: unknown }).value;
}

export async function mileageSettings(): Promise<MileageSettings> {
  return readMileage(await raw(MILEAGE_KEY));
}

/** The hourly rate by package. Read by any server code that figures pay, like mileage. */
export async function packageRates(): Promise<PackageRates> {
  return readPackageRates(await raw(RATES_KEY));
}

/** Costs feed the Business area only. Admins only: anyone else gets nothing. */
export async function costSettings(admin: StaffMember): Promise<CostSettings | null> {
  if (!isFullAdmin(admin.role)) return null;
  return readCosts(await raw(COSTS_KEY));
}

/** Supplies per guest, per package. Admins only: anyone else gets nothing. */
export async function suppliesSettings(admin: StaffMember): Promise<SuppliesPerGuest | null> {
  if (!isFullAdmin(admin.role)) return null;
  return readSupplies(await raw(SUPPLIES_KEY));
}

type Result<T> = { ok: true; value: T } | { ok: false; error: string; status: number };

const SETTING_KEY: Record<string, string> = { mileage: MILEAGE_KEY, costs: COSTS_KEY, supplies: SUPPLIES_KEY, rates: RATES_KEY };

export async function saveBusinessSettings(admin: StaffMember, which: unknown, body: Record<string, unknown>): Promise<Result<MileageSettings | CostSettings | SuppliesPerGuest | PackageRates>> {
  if (!isFullAdmin(admin.role)) return { ok: false, error: "Admins only.", status: 403 };
  const v = which === "mileage" ? validateMileage(body) : which === "costs" ? validateCosts(body) : which === "supplies" ? validateSupplies(body) : which === "rates" ? validatePackageRates(body) : null;
  if (!v) return { ok: false, error: "Unknown setting.", status: 400 };
  if (!v.ok) return { ok: false, error: v.error, status: 400 };
  const { error } = await supabase
    .from("team_settings")
    .upsert({ key: SETTING_KEY[String(which)], value: v.value, updated_by: admin.id, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) return { ok: false, error: "Could not save. Try again.", status: 500 };
  return { ok: true, value: v.value };
}
