// Business settings: mileage, costs, supplies per guest, and the hourly rate
// by package. Pure, no database. Stored in team_settings as JSON values. Only a real admin (role admin,
// never a manager) changes them, from the Business settings section.

import {
  MAX_NEW_HIRE_EVENTS,
  MAX_RATE_CENTS,
  MILEAGE_DEFAULTS,
  PACKAGE_RATE_DEFAULTS,
  PAY_PACKAGES,
  PAY_PACKAGE_LABEL,
  SERVICE_FEE_RATE_DEFAULTS,
  SERVICE_FEE_RATE_KEYS,
  SERVICE_FEE_RATE_LABEL,
  type MileageSettings,
  type PackageRates,
  type ServiceFeeRates,
} from "@/lib/team/pay";

export const MILEAGE_KEY = "business_mileage";
export const COSTS_KEY = "business_costs";
export const SUPPLIES_KEY = "business_supplies_per_guest";
export const RATES_KEY = "business_pay_rates";
export const SF_RATES_KEY = "business_service_fee_rates";

export interface CostSettings {
  burdenPct: number; // payroll burden, a percent of labor
  cardPct: number; // card processing percent
  cardFixedCents: number; // card processing fixed fee per charge
}

export const COST_DEFAULTS: CostSettings = { burdenPct: 15, cardPct: 2.9, cardFixedCents: 30 };

const num = (v: unknown): number | null => {
  const s = String(v ?? "").trim().replace(/^\$/, "").replace(/%$/, "");
  if (!s || !/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/** Saved values over the defaults; anything missing or broken falls back. */
export function readMileage(v: unknown): MileageSettings {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const pick = (k: keyof MileageSettings) => (typeof o[k] === "number" && (o[k] as number) >= 0 ? (o[k] as number) : MILEAGE_DEFAULTS[k]);
  return { thresholdMiles: pick("thresholdMiles"), deductionMiles: pick("deductionMiles"), rateCents: pick("rateCents"), caRateCents: pick("caRateCents") };
}

export function readCosts(v: unknown): CostSettings {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const pick = (k: keyof CostSettings) => (typeof o[k] === "number" && (o[k] as number) >= 0 ? (o[k] as number) : COST_DEFAULTS[k]);
  return { burdenPct: pick("burdenPct"), cardPct: pick("cardPct"), cardFixedCents: pick("cardFixedCents") };
}

type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/** The form: miles, and rates in dollars a mile ("0.30"). */
export function validateMileage(raw: Record<string, unknown>): Checked<MileageSettings> {
  const threshold = num(raw.thresholdMiles);
  const deduction = num(raw.deductionMiles);
  const rate = num(raw.rate);
  const ca = num(raw.caRate);
  if (threshold === null || threshold > 500) return { ok: false, error: "Enter the threshold in miles, 0 to 500." };
  if (deduction === null || deduction > 1000) return { ok: false, error: "Enter the deduction in miles, 0 to 1000." };
  if (rate === null || rate > 5) return { ok: false, error: "Enter the rate in dollars a mile, like 0.30." };
  if (ca === null || ca > 5) return { ok: false, error: "Enter the California rate in dollars a mile, like 0.40." };
  return { ok: true, value: { thresholdMiles: threshold, deductionMiles: deduction, rateCents: Math.round(rate * 1000) / 10, caRateCents: Math.round(ca * 1000) / 10 } };
}

export function validateCosts(raw: Record<string, unknown>): Checked<CostSettings> {
  const burden = num(raw.burdenPct);
  const pct = num(raw.cardPct);
  const fixed = num(raw.cardFixed);
  if (burden === null || burden > 100) return { ok: false, error: "Enter payroll burden as a percent, 0 to 100." };
  if (pct === null || pct > 20) return { ok: false, error: "Enter the card percent, 0 to 20." };
  if (fixed === null || fixed > 10) return { ok: false, error: "Enter the card fixed fee in dollars, like 0.30." };
  return { ok: true, value: { burdenPct: burden, cardPct: pct, cardFixedCents: Math.round(fixed * 100) } };
}

// ----- Supplies per guest -----
// The fallback when an event's Shopping list has no catalog costs: one dollar
// amount a guest per package. Blank by default; nothing here invents a value.

export type SupplyPackage = "beerwine" | "dive" | "wedding" | "full" | "premium" | "legacy";
export const SUPPLY_PACKAGES: SupplyPackage[] = ["beerwine", "dive", "wedding", "full", "premium", "legacy"];
export const SUPPLY_PACKAGE_LABEL: Record<SupplyPackage, string> = {
  beerwine: "Beer and Wine",
  dive: "Dive Bar",
  wedding: "The Big Day Bar",
  full: "Full Bar",
  premium: "Premium Bar",
  legacy: "legacy packages",
};
export type SuppliesPerGuest = Record<SupplyPackage, number | null>; // cents a guest, null when blank

export function readSupplies(v: unknown): SuppliesPerGuest {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return Object.fromEntries(SUPPLY_PACKAGES.map((k) => [k, typeof o[k] === "number" && (o[k] as number) >= 0 ? (o[k] as number) : null])) as SuppliesPerGuest;
}

/** The form: dollars a guest per package ("3.00"), each one may be blank. */
export function validateSupplies(raw: Record<string, unknown>): Checked<SuppliesPerGuest> {
  const out = {} as SuppliesPerGuest;
  for (const k of SUPPLY_PACKAGES) {
    const s = String(raw[k] ?? "").trim();
    if (!s) {
      out[k] = null;
      continue;
    }
    const n = num(s);
    if (n === null || n > 500) return { ok: false, error: `Enter ${SUPPLY_PACKAGE_LABEL[k]} in dollars a guest, like 3.00, or leave it blank.` };
    out[k] = Math.round(n * 100);
  }
  return { ok: true, value: out };
}

/** "$0.30" a mile, from cents (which may carry a tenth of a cent). */
export const perMile = (cents: number) => `$${(cents / 100).toFixed(Number.isInteger(cents) ? 2 : 3)}`;

// ----- Hourly rate by package -----
// Saved cents an hour per package over the defaults ($25 Beer and Wine,
// Bartender Only, Tailored; $30 the rest). lineRate in lib/team/pay.ts uses them.

export function readPackageRates(v: unknown): PackageRates {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return Object.fromEntries(PAY_PACKAGES.map((k) => [k, typeof o[k] === "number" && (o[k] as number) > 0 && (o[k] as number) <= MAX_RATE_CENTS ? (o[k] as number) : PACKAGE_RATE_DEFAULTS[k]])) as unknown as PackageRates;
}

/** The form: dollars an hour per package ("25" or "27.50"). Every package needs a rate. */
export function validatePackageRates(raw: Record<string, unknown>): Checked<PackageRates> {
  const out = {} as PackageRates;
  for (const k of PAY_PACKAGES) {
    const n = num(raw[k]);
    if (n === null || n <= 0 || n * 100 > MAX_RATE_CENTS) return { ok: false, error: `Enter the ${PAY_PACKAGE_LABEL[k]} rate in dollars an hour, like 25 or 27.50.` };
    out[k] = Math.round(n * 100);
  }
  return { ok: true, value: out };
}

// ----- Hourly rate on service fee events -----
// Bartenders by tier (Top $45, Core $40, Developing $35), the new hire rate
// ($30) and how many approved events someone is a new hire for (1; 0 turns it
// off), and one support rate for barbacks, servers and event helpers ($25).
// lineRate uses them. The old per package rates saved under the same key are ignored.

const validCount = (n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= MAX_NEW_HIRE_EVENTS;

export function readServiceFeeRates(v: unknown): ServiceFeeRates {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return Object.fromEntries(
    SERVICE_FEE_RATE_KEYS.map((k) => [
      k,
      k === "newHireEvents"
        ? validCount(o[k]) ? (o[k] as number) : SERVICE_FEE_RATE_DEFAULTS[k]
        : typeof o[k] === "number" && (o[k] as number) > 0 && (o[k] as number) <= MAX_RATE_CENTS ? (o[k] as number) : SERVICE_FEE_RATE_DEFAULTS[k],
    ])
  ) as unknown as ServiceFeeRates;
}

export function validateServiceFeeRates(raw: Record<string, unknown>): Checked<ServiceFeeRates> {
  const out = {} as ServiceFeeRates;
  for (const k of SERVICE_FEE_RATE_KEYS) {
    if (k === "newHireEvents") {
      const s = String(raw[k] ?? "").trim();
      const n = /^\d+$/.test(s) ? Number(s) : null;
      if (n === null || !validCount(n)) return { ok: false, error: `Enter the new hire event count as a whole number from 0 to ${MAX_NEW_HIRE_EVENTS}. 0 turns the new hire rate off.` };
      out[k] = n;
      continue;
    }
    const n = num(raw[k]);
    if (n === null || n <= 0 || n * 100 > MAX_RATE_CENTS) return { ok: false, error: `Enter the ${SERVICE_FEE_RATE_LABEL[k]} in dollars an hour, like 45.` };
    out[k] = Math.round(n * 100);
  }
  return { ok: true, value: out };
}

// ----- Supplies per guest on service fee events -----
// Replaces only the per guest default, only on service fee events. Hand
// entered costs, receipts and the Shopping list still win.

export type SfSupplyPackage = "beerwine" | "dive" | "wedding" | "full" | "premium";
export const SF_SUPPLY_PACKAGES: SfSupplyPackage[] = ["beerwine", "dive", "wedding", "full", "premium"];
export const SF_SUPPLY_LABEL: Record<SfSupplyPackage, string> = { beerwine: "Bartender Only", dive: "Dive Bar", wedding: "The Big Day Bar", full: "Full Bar", premium: "Premium Bar" };
export const SF_SUPPLIES_KEY = "business_supplies_service_fee";
export type SfSuppliesPerGuest = Record<SfSupplyPackage, number>; // cents a guest
export const SF_SUPPLY_DEFAULTS: SfSuppliesPerGuest = { beerwine: 25, dive: 125, wedding: 250, full: 350, premium: 600 };

export function readSfSupplies(v: unknown): SfSuppliesPerGuest {
  const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return Object.fromEntries(SF_SUPPLY_PACKAGES.map((k) => [k, typeof o[k] === "number" && (o[k] as number) >= 0 ? (o[k] as number) : SF_SUPPLY_DEFAULTS[k]])) as SfSuppliesPerGuest;
}

export function validateSfSupplies(raw: Record<string, unknown>): Checked<SfSuppliesPerGuest> {
  const out = {} as SfSuppliesPerGuest;
  for (const k of SF_SUPPLY_PACKAGES) {
    const n = num(raw[k]);
    if (n === null || n > 500) return { ok: false, error: `Enter ${SF_SUPPLY_LABEL[k]} in dollars a guest, like 3.50.` };
    out[k] = Math.round(n * 100);
  }
  return { ok: true, value: out };
}
