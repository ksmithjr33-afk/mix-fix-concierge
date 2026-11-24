// Service fee model: the pricing engine the site uses for bookings made after
// 2026-11-23, and how a booking webhook's money is split into package, fee and
// add ons. Pure, no database. Gratuity model events never come here; their
// engine is lib/pricing.ts and stays exactly as it is.
//
//   package price = bartenders × paid hours × $70 + guests × per guest price
//                   + event fee + any barback line
//   paid hours    = setup (2, or 3 at a wedding) + service hours (1 to 7) + 1 breakdown
//   service fee   = 20% of the package price, 10% on Premium
//   client total  = package price + service fee, rounded to the nearest dollar
//
// Every amount here is whole cents, so a fee that lands on exactly 50 cents
// ($3,140.50) always rounds up ($3,141).
//
// Promo codes (RETURN5, CLASS49) come off the package price first, then the fee
// is figured on what is left. A custom or owner price is the all in price
// before add ons, with the fee carved out. Add ons are never discounted and
// carry no fee. A custom price code is never decoded here: on the service fee
// model the custom price arrives as its own field.

import { PROMOS, staffingFor } from "@/lib/pricing";

export type ServiceFeePackage = "beerwine" | "dive" | "wedding" | "full" | "premium";

// ---------- parameters ----------

export const HOURLY_CENTS = 70_00; // every paid bartender hour
export const SETUP_HOURS = 2;
export const SETUP_HOURS_WEDDING = 3;
export const BREAKDOWN_HOURS = 1;
export const MIN_SERVICE_HOURS = 1;
export const MAX_SERVICE_HOURS = 7;
export const MIN_BARTENDERS = 1;
export const MAX_BARTENDERS = 4;

/** Service fee rate in basis points: 20%, 10% on Premium. */
export const FEE_BP_STANDARD = 2000;
export const FEE_BP_PREMIUM = 1000;

export const FULL_WEDDING_BARBACK_CENTS = 200_00; // on by default at a Full Bar wedding, the client can remove it
export const PREMIUM_BARBACK_HOUR_CENTS = 50_00; // per service hour
export const PREMIUM_NO_WOODEN_BAR_CENTS = 525_00; // off the event fee when the wooden bar is off

export const SERVICE_FEE_PACKAGES: Record<ServiceFeePackage, { label: string; perGuestCents: number; eventFeeCents: number }> = {
  beerwine: { label: "Bartender Only", perGuestCents: 0, eventFeeCents: 100_00 },
  dive: { label: "Dive Bar", perGuestCents: 2_00, eventFeeCents: 150_00 },
  wedding: { label: "The Big Day Bar", perGuestCents: 4_00, eventFeeCents: 225_00 }, // weddings only, barback included with no line
  full: { label: "Full Bar", perGuestCents: 4_50, eventFeeCents: 225_00 },
  premium: { label: "Premium Bar", perGuestCents: 7_00, eventFeeCents: 975_00 },
};

/** Exactly what the client sees about the fee, everywhere it shows. */
export const SERVICE_FEE_TEXT =
  "Service fee covers staffing, setup, travel, and insurance. It is not a gratuity. Tips are optional and go entirely to your bar team.";

// ---------- package keys ----------

const KEY_ALIASES: Record<string, ServiceFeePackage> = {
  beerwine: "beerwine",
  bartenderonly: "beerwine",
  dive: "dive",
  divebar: "dive",
  wedding: "wedding",
  bigday: "wedding",
  bigdaybar: "wedding",
  thebigdaybar: "wedding",
  full: "full",
  fullbar: "full",
  premium: "premium",
  premiumbar: "premium",
};

/**
 * A package key or name from the booking ("bartender_only", "big_day", "Full
 * Bar") as a service fee package, or null when it is not one. Beer and Wine
 * and Essentials are not service fee packages, so they come back null.
 */
export function serviceFeePackage(raw: unknown): ServiceFeePackage | null {
  const k = String(raw ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return KEY_ALIASES[k] ?? null;
}

export const feeBp = (key: ServiceFeePackage): number => (key === "premium" ? FEE_BP_PREMIUM : FEE_BP_STANDARD);

/** "20%" or "10%". */
export const feeRateText = (bp: number): string => `${bp / 100}%`;

// ---------- cents helpers ----------

/** Positive amounts only: rounds half up. */
const roundCents = (x: number) => Math.round(x);
/** To the nearest dollar, in cents, half up. */
export const toDollar = (cents: number) => Math.round(cents / 100) * 100;
/** The fee on a package price, half a cent up. */
export const feeOn = (packageCents: number, bp: number) => roundCents((packageCents * bp) / 10000);
/** Carve the fee out of an all in amount (package + fee): the package part, to the cent. */
export const carvePackage = (allInCents: number, bp: number) => roundCents((allInCents * 10000) / (10000 + bp));

// ---------- the engine ----------

export interface ServiceFeeInput {
  package: ServiceFeePackage | string;
  guests: number;
  hours: number; // service hours
  isWedding: boolean;
  bartenders?: number | null; // 1 to 4; missing means the recommended staffing
  woodenBar?: boolean; // Premium only, on unless false
  barback?: boolean; // Full Bar weddings only, on unless false
}

export interface ServiceFeeQuote {
  key: ServiceFeePackage;
  bartenders: number;
  serviceHours: number;
  paidHours: number; // per bartender
  laborCents: number;
  guestCents: number;
  eventFeeCents: number;
  barbackCents: number;
  packageCents: number;
  feeBp: number;
  feeCents: number;
  totalCents: number; // package + fee, rounded to the dollar
}

/** The standard price for an event, before promos, custom prices and add ons. Null if not priceable. */
export function quoteServiceFee(input: ServiceFeeInput): ServiceFeeQuote | null {
  const key = serviceFeePackage(input.package);
  const guests = Math.round(Number(input.guests) || 0);
  const rawHours = Number(input.hours) || 0;
  if (!key || guests < 1 || rawHours <= 0) return null;

  // The Big Day Bar is a wedding package: wedding setup hours always.
  const wedding = input.isWedding || key === "wedding";
  const serviceHours = Math.max(MIN_SERVICE_HOURS, Math.min(MAX_SERVICE_HOURS, rawHours));
  const bartenders =
    input.bartenders && input.bartenders > 0
      ? Math.max(MIN_BARTENDERS, Math.min(MAX_BARTENDERS, Math.round(input.bartenders)))
      : Math.min(MAX_BARTENDERS, staffingFor(guests));
  const paidHours = (wedding ? SETUP_HOURS_WEDDING : SETUP_HOURS) + serviceHours + BREAKDOWN_HOURS;

  const p = SERVICE_FEE_PACKAGES[key];
  const laborCents = roundCents(bartenders * paidHours * HOURLY_CENTS);
  const guestCents = guests * p.perGuestCents;
  const eventFeeCents = p.eventFeeCents - (key === "premium" && input.woodenBar === false ? PREMIUM_NO_WOODEN_BAR_CENTS : 0);
  const barbackCents =
    key === "premium"
      ? roundCents(PREMIUM_BARBACK_HOUR_CENTS * serviceHours)
      : key === "full" && wedding && input.barback !== false
        ? FULL_WEDDING_BARBACK_CENTS
        : 0;

  const packageCents = laborCents + guestCents + eventFeeCents + barbackCents;
  const bp = feeBp(key);
  const feeCents = feeOn(packageCents, bp);
  return {
    key,
    bartenders,
    serviceHours,
    paidHours,
    laborCents,
    guestCents,
    eventFeeCents,
    barbackCents,
    packageCents,
    feeBp: bp,
    feeCents,
    totalCents: toDollar(packageCents + feeCents),
  };
}

// ---------- a booked price (promo or custom price) ----------

export interface ServiceFeeSplit {
  packageCents: number; // the package alone, after any discount
  feeBp: number;
  feeCents: number;
  addonsCents: number;
  totalCents: number; // the grand total
}

/** The discount a promo code takes off the package price, in cents. Unknown codes take nothing. */
export function promoDiscountCents(code: unknown, packageCents: number): number {
  const def = PROMOS[String(code ?? "").trim().toUpperCase()];
  if (!def) return 0;
  if (def.pct) return roundCents((packageCents * def.pct) / 100);
  return Math.min((def.amount ?? 0) * 100, packageCents);
}

/** Package and fee from a discounted package price. The total is rounded to the dollar. */
export function splitFromPackage(packageCents: number, bp: number, addonsCents = 0): ServiceFeeSplit {
  const feeCents = feeOn(packageCents, bp);
  return { packageCents, feeBp: bp, feeCents, addonsCents, totalCents: toDollar(packageCents + feeCents + addonsCents) };
}

/** Package and fee carved out of a custom or owner price (all in, before add ons). */
export function splitFromCustom(customCents: number, bp: number, addonsCents = 0): ServiceFeeSplit {
  const packageCents = carvePackage(customCents, bp);
  return { packageCents, feeBp: bp, feeCents: customCents - packageCents, addonsCents, totalCents: toDollar(customCents + addonsCents) };
}

/** What the app prices a booking at: the engine, then a promo off the package, or a custom price. */
export function bookedServiceFee(
  input: ServiceFeeInput,
  opts: { promoCode?: string | null; customPriceCents?: number | null; addonsCents?: number } = {}
): (ServiceFeeSplit & { standard: ServiceFeeQuote; discountCents: number }) | null {
  const standard = quoteServiceFee(input);
  if (!standard) return null;
  const addons = opts.addonsCents ?? 0;
  if (opts.customPriceCents && opts.customPriceCents > 0) {
    const s = splitFromCustom(opts.customPriceCents, standard.feeBp, addons);
    return { ...s, standard, discountCents: standard.totalCents - opts.customPriceCents };
  }
  const discountCents = promoDiscountCents(opts.promoCode, standard.packageCents);
  return { ...splitFromPackage(standard.packageCents - discountCents, standard.feeBp, addons), standard, discountCents };
}

// ---------- the booking webhook's money ----------

/** The money fields a service fee booking sends, already read as cents (null when missing). */
export interface WebhookMoney {
  packageKey: string | null;
  guests: number | null;
  hours: number | null;
  isWedding: boolean;
  bartenders: number | null;
  woodenBar: boolean | null; // null: not sent, both settings are tried
  barback: boolean | null; // null: not sent, both settings are tried
  grandTotalCents: number | null;
  standardPriceCents: number | null;
  discountCents: number | null;
  customPriceCents: number | null;
  ownerOverride: boolean;
  addonsCents: number | null;
}

export type SplitMethod = "engine" | "custom" | "carved";

export interface WebhookSplit extends ServiceFeeSplit {
  method: SplitMethod; // engine: matched standard_price; custom: carved from custom_price; carved: the fallback
  key: ServiceFeePackage | null;
  standard: ServiceFeeQuote | null; // the engine price that matched standard_price
  check: string | null; // why the price needs a check, or null
}

/** Within a dollar. */
const TOLERANCE_CENTS = 100;

/** Engine prices for each setting not sent: wooden bar on Premium, barback on a Full Bar wedding. */
function candidates(m: WebhookMoney, key: ServiceFeePackage): ServiceFeeQuote[] {
  const wooden = key === "premium" && m.woodenBar === null ? [true, false] : [m.woodenBar !== false];
  const wedding = m.isWedding || key === "wedding";
  const barback = key === "full" && wedding && m.barback === null ? [true, false] : [m.barback !== false];
  const out: ServiceFeeQuote[] = [];
  for (const w of wooden) {
    for (const b of barback) {
      const q = quoteServiceFee({ package: key, guests: m.guests ?? 0, hours: m.hours ?? 0, isWedding: m.isWedding, bartenders: m.bartenders, woodenBar: w, barback: b });
      if (q) out.push(q);
    }
  }
  return out;
}

/**
 * Split a service fee booking's grand total into package, fee and add ons.
 *  1. No custom price: the engine's standard price must equal standard_price
 *     (exactly one setting when the wooden bar or barback was not sent). Then
 *     package = engine package − discount_amount, and the fee is figured on it.
 *  2. Custom price or owner override: package + fee = custom_price, fee carved out.
 *  3. Add ons = addons_total, never discounted, never part of the fee.
 *  4. package + fee + add ons must be within $1 of the grand total. If not, or
 *     step 1 did not match, the fee is carved out of (grand total − add ons)
 *     and the price needs a check.
 * Null only with no grand total at all.
 */
export function splitWebhookMoney(m: WebhookMoney): WebhookSplit | null {
  if (m.grandTotalCents === null || m.grandTotalCents <= 0) return null;
  const grand = m.grandTotalCents;
  const addons = Math.max(0, m.addonsCents ?? 0);
  const key = serviceFeePackage(m.packageKey);
  const bp = key ? feeBp(key) : FEE_BP_STANDARD;

  const fallback = (why: string, standard: ServiceFeeQuote | null = null): WebhookSplit => {
    const s = splitFromCustom(Math.max(0, grand - addons), bp, addons);
    return { ...s, totalCents: grand, method: "carved", key, standard, check: why };
  };
  const withinTotal = (s: ServiceFeeSplit) => Math.abs(s.packageCents + s.feeCents + s.addonsCents - grand) <= TOLERANCE_CENTS;

  if (!key) return fallback(m.packageKey ? `Unknown package key "${m.packageKey}".` : "No package key on the booking.");

  const hasCustom = m.customPriceCents !== null && m.customPriceCents > 0;
  if (hasCustom || m.ownerOverride) {
    if (!hasCustom) return fallback("Owner override with no custom price.");
    const s = splitFromCustom(m.customPriceCents!, bp, addons);
    if (!withinTotal(s)) return fallback(`Custom price plus add ons does not match the total (${usd(m.customPriceCents! + addons)} against ${usd(grand)}).`);
    return { ...s, totalCents: grand, method: "custom", key, standard: null, check: null };
  }

  if (m.standardPriceCents === null) return fallback("No standard price on the booking to check the engine against.");
  if (!m.guests || !m.hours) return fallback("Guests or service hours missing, so the engine could not price it.");
  const matches = candidates(m, key).filter((q) => q.totalCents === m.standardPriceCents);
  if (matches.length === 0) {
    const first = candidates(m, key)[0] ?? null;
    return fallback(`The engine prices this at ${first ? usd(first.totalCents) : "nothing"}, the booking says ${usd(m.standardPriceCents)}.`, first);
  }
  if (matches.length > 1) return fallback("Two settings (wooden bar or barback) match the standard price; the booking did not say which.", matches[0]);

  const standard = matches[0];
  const discount = Math.max(0, m.discountCents ?? 0);
  if (discount > standard.packageCents) return fallback(`The discount (${usd(discount)}) is more than the package price.`, standard);
  const s = splitFromPackage(standard.packageCents - discount, bp, addons);
  if (!withinTotal(s)) return fallback(`Package, fee and add ons come to ${usd(s.packageCents + s.feeCents + addons)}, the total is ${usd(grand)}.`, standard);
  return { ...s, totalCents: grand, method: "engine", key, standard, check: null };
}

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
