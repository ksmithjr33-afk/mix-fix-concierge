// Quote engine, ported from the site's tools/quote-source.html (PKGP,
// bundleBase, gratuityCalc) with the Pricing v22 Parameters. A change to a
// number here is a change to make on the site and in the workbook too.
// No imports so scripts/test-pricing.ts can run it with plain node.

export type PackageKey = "beerwine" | "dive" | "wedding" | "full" | "premium";

// ---------- Parameters (Pricing v22) ----------

const SERVICE_HOUR = 60; // service hours 1 to 4
const HALF_RATE_HOUR = 30; // service hours 5 and beyond
const SETUP_HOURS = 2;
const SETUP_HOURS_WEDDING = 3;
const BREAKDOWN_HOURS = 1;
const GAS = 30;
const DAMAGE = 75;
const DAMAGE_DIVE = 60;
const DIVE_ADJUSTMENT = -110;
const ADJ = 1.05; // commission allowance on the charge sum
const CARD_FEE = 0.03;
const MARKUP = 1.05;
const ROUND_TO = 5;
const MIN_BILLED_GUESTS = 30; // per guest items bill at least this many
const PROFIT_FLOOR = 300;
const MAX_SERVICE_HOURS = 7;

const BW_HOURLY = 60;
const BW_FEE = 150;

const GRAT_RATE_JAR = 0.1;
const GRAT_FLOOR_JAR = 50; // per bartender
const GRAT_RATE_NO_JAR = 0.2;
const GRAT_FLOOR_NO_JAR = 100; // per bartender

// Cost side, for the profit floor.
const WAGE = 30;
const BURDEN = 1.15;
const ICE_COST = 0.05;
const MENU_COST = 20;
const GAS_COST = 30;
const SUPPLIES_COST = 6;

// Premium extras.
const PREMIUM_BARBACK_HOUR = 50;
const PREMIUM_DECOR = 200;
const PREMIUM_CUPS_PER_GUEST = 2.4;
const PREMIUM_BARBACK_STYLING_COST = 150;
const PREMIUM_WOODEN_BAR_COST = 350;
const PREMIUM_DECOR_COST = 100;

// Wedding extras.
const BIG_DAY_STOCK_PER_GUEST = 0.5;
const BIG_DAY_STOCK_COST_PER_GUEST = 0.25;
const BIG_DAY_BARBACK_COST = 138;
const FULL_WEDDING_BARBACK = 190;
const FULL_WEDDING_BARBACK_COST = 138;

// Per package rates (Parameters tab rows 63 to 67).
const PKGP: Record<Exclude<PackageKey, "beerwine">, { mix: number; ice: number; menu: number; order: number; cust: number; bar: number; mixCost: number }> = {
  dive: { mix: 0.25, ice: 7 / 60, menu: 0, order: 0, cust: 0, bar: 0, mixCost: 0.15 },
  wedding: { mix: 0.45, ice: 0.15, menu: 35, order: 50, cust: 30, bar: 0, mixCost: 0.32 },
  full: { mix: 0.58, ice: 1 / 5, menu: 40, order: 50, cust: 30, bar: 0, mixCost: 0.48 },
  premium: { mix: 0.58, ice: 1 / 5, menu: 40, order: 50, cust: 30, bar: 525, mixCost: 0.48 },
};

// ---------- helpers ----------

const round5 = (x: number) => Math.round(x / ROUND_TO) * ROUND_TO;
const clampHours = (h: number) => Math.max(1, Math.min(MAX_SERVICE_HOURS, h));

/** Recommended bartenders: 1 up to 75 guests, 2 up to 200, one more per additional 100. */
export function staffingFor(guests: number): number {
  if (guests <= 75) return 1;
  if (guests <= 200) return 2;
  return 2 + Math.ceil((guests - 200) / 100);
}

/** Package name as written anywhere (GHL, intake, the site) to an engine key, or null if not priceable. */
export function packageKey(name: unknown): PackageKey | null {
  const p = String(name ?? "").toLowerCase();
  if (!p) return null;
  if (p.includes("big day") || p.includes("wedding bar") || p === "wedding") return "wedding";
  if (p.includes("premium")) return "premium";
  if (p.includes("dive")) return "dive";
  if (p.includes("full")) return "full";
  if (p.includes("beer") && p.includes("wine")) return "beerwine";
  if (p === "beerwine") return "beerwine";
  return null; // Essentials, Tailored, Bartender Only: retired, priced by a manager
}

export function gratuityCalc(subtotal: number, bartenders: number, tipJar: boolean): number {
  const rate = tipJar ? GRAT_RATE_JAR : GRAT_RATE_NO_JAR;
  const floor = (tipJar ? GRAT_FLOOR_JAR : GRAT_FLOOR_NO_JAR) * bartenders;
  return Math.max(Math.round(subtotal * rate * 100) / 100, floor);
}

interface BaseInput {
  guests: number;
  hours: number;
  isWedding: boolean;
  bartenders: number;
  woodenBar: boolean;
}

function bundleBase(key: PackageKey, { guests: g, hours, isWedding, bartenders: nb, woodenBar }: BaseInput): number {
  const sh = clampHours(hours);
  const setup = isWedding ? SETUP_HOURS_WEDDING : SETUP_HOURS;
  if (key === "beerwine") return nb * BW_HOURLY * (setup + sh + BREAKDOWN_HOURS) + BW_FEE;

  const P = PKGP[key];
  const weddingBarback = key === "full" && isWedding;
  const pg = Math.max(g, MIN_BILLED_GUESTS);
  const fullHrs = Math.min(sh, 4);
  const halfHrs = Math.max(sh - 4, 0);
  const effHrs = fullHrs + 0.5 * halfHrs;

  const bartenderCharge =
    nb * (fullHrs * SERVICE_HOUR + halfHrs * HALF_RATE_HOUR + (setup + BREAKDOWN_HOURS) * SERVICE_HOUR) + GAS;
  const chargeSum =
    bartenderCharge +
    g * effHrs * P.mix +
    g * effHrs * P.ice +
    P.menu +
    P.order +
    P.cust +
    (key === "premium" && !woodenBar ? 0 : P.bar) +
    (key === "premium" ? PREMIUM_BARBACK_HOUR * sh + PREMIUM_DECOR + PREMIUM_CUPS_PER_GUEST * pg : 0) +
    (key === "wedding" ? BIG_DAY_STOCK_PER_GUEST * pg : 0) +
    (weddingBarback ? FULL_WEDDING_BARBACK : 0);
  const dmg = key === "dive" ? DAMAGE_DIVE : DAMAGE;
  const tune = key === "dive" ? DIVE_ADJUSTMENT : 0;
  const q0 = ((chargeSum * ADJ) / (1 - CARD_FEE) + dmg + GAS + tune) * MARKUP;

  // Profit floor: no configuration earns under $300, worst case tip mode.
  const fixedC =
    nb * (sh + setup + BREAKDOWN_HOURS) * WAGE * BURDEN +
    g * sh * P.mixCost +
    g * sh * ICE_COST +
    MENU_COST +
    GAS_COST +
    SUPPLIES_COST +
    (key === "premium"
      ? PREMIUM_BARBACK_STYLING_COST + (woodenBar ? PREMIUM_WOODEN_BAR_COST : 0) + PREMIUM_DECOR_COST + PREMIUM_CUPS_PER_GUEST * pg
      : 0) +
    (key === "wedding" ? BIG_DAY_STOCK_COST_PER_GUEST * pg + BIG_DAY_BARBACK_COST : 0) +
    (weddingBarback ? FULL_WEDDING_BARBACK_COST : 0);
  const tPct = (fixedC + PROFIT_FLOOR) / (0.97 - 1.15 * (0.2 / 1.2));
  const tFlat = (fixedC + PROFIT_FLOOR + 1.15 * 100 * nb) / 0.97;
  const qFloor = Math.ceil(Math.max(tPct / 1.2, tFlat - 100 * nb) / 5) * 5;
  return Math.max(q0, qFloor);
}

// ---------- public ----------

export interface PriceInput {
  package: PackageKey | string;
  guests: number;
  hours: number;
  isWedding: boolean;
  bartenders?: number | null;
  tipJar: boolean;
  woodenBar?: boolean; // Premium only, defaults to on
}

export interface PriceResult {
  packagePrice: number;
  gratuity: number;
  total: number;
  bartenders: number;
}

/** Standard price before promos and add ons, exactly as the quote tool shows it. Null if the package is not priceable. */
export function priceEvent(input: PriceInput): PriceResult | null {
  const key = (["beerwine", "dive", "wedding", "full", "premium"] as string[]).includes(input.package)
    ? (input.package as PackageKey)
    : packageKey(input.package);
  const guests = Math.max(1, Math.round(Number(input.guests) || 0));
  const hours = Number(input.hours) || 0;
  if (!key || !(guests > 0) || !(hours > 0)) return null;

  const bartenders =
    input.bartenders && input.bartenders > 0 ? Math.max(1, Math.min(4, Math.round(input.bartenders))) : staffingFor(guests);
  const base: BaseInput = { guests, hours, isWedding: input.isWedding, bartenders, woodenBar: input.woodenBar !== false };

  const packagePrice = round5(bundleBase(key, base));
  // Premium's gratuity is figured on the Full price so clients never tip on rentals.
  const gratBasis = key === "premium" ? round5(bundleBase("full", base)) : packagePrice;
  const gratuity = gratuityCalc(gratBasis, bartenders, input.tipJar);
  return { packagePrice, gratuity, total: Math.round(packagePrice + gratuity), bartenders };
}

// ---------- promo codes (CONFIG.promos and custom price codes on the site) ----------

export const PROMOS: Record<string, { pct?: number; amount?: number; label: string }> = {
  RETURN5: { pct: 5, label: "Returning client, 5% off" },
  CLASS49: { amount: 49, label: "Class credit, $49 off" },
};

const CUSTOM_RE = /^MF(\d{3,5})([0-9A-Z]{2})$/;
function customCheck(price: number): string {
  const n = (price * 7919 + 104729) % 1296;
  const A = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return A.charAt(Math.floor(n / 36)) + A.charAt(n % 36);
}

/** The all in price a valid MF custom price code sets, or 0. */
export function customPriceFromCode(code: unknown): number {
  const m = CUSTOM_RE.exec(String(code ?? "").trim().toUpperCase());
  if (!m) return 0;
  const price = parseInt(m[1], 10);
  return price >= 100 && customCheck(price) === m[2] ? price : 0;
}

/**
 * The quote tool's booked price for an event: engine price, then the promo off
 * the package (never the gratuity), or a custom price code that replaces both
 * with the gratuity carved out at the normal rate and floors.
 */
export function bookedPrice(input: PriceInput, promoCode?: string | null): (PriceResult & { discount: number }) | null {
  const std = priceEvent(input);
  if (!std) return null;
  const code = String(promoCode ?? "").trim().toUpperCase();
  const custom = customPriceFromCode(code);
  if (custom) {
    const rate = input.tipJar ? GRAT_RATE_JAR : GRAT_RATE_NO_JAR;
    const floor = (input.tipJar ? GRAT_FLOOR_JAR : GRAT_FLOOR_NO_JAR) * std.bartenders;
    let pkg = Math.round(custom / (1 + rate));
    let grat = custom - pkg;
    if (grat < floor) {
      grat = Math.min(floor, custom);
      pkg = custom - grat;
    }
    return { packagePrice: pkg, gratuity: grat, total: custom, bartenders: std.bartenders, discount: std.total - custom };
  }
  const def = PROMOS[code];
  const off = !def ? 0 : def.pct ? Math.round((std.packagePrice * def.pct) / 100) : Math.min(def.amount ?? 0, std.packagePrice);
  return { ...std, total: Math.round(std.packagePrice + std.gratuity - off), discount: off };
}
