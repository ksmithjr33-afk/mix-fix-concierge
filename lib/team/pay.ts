// Pay: estimates from an hourly rate. Pure, no database.
//
// Estimated hours = setup (arrival: 2 hours before service, 3 for weddings) +
// service + 1 hour of breakdown, from scheduledMinutes below: the one place
// hours are figured. Estimated pay = hours × the line's rate (lineRate below:
// the person's own rate when one is on file, else the package rate) + mileage
// + their share of the gratuity (none on a service fee event). Visible only to
// admins, managers on the payout sheet, and the staff member it belongs to.
// Payroll is the final record; everything here is labeled as an estimate.

import { BREAKDOWN_MIN } from "@/lib/team/clock";
import { eventSchedule } from "@/lib/team/time";
import { packageKey } from "@/lib/pricing";
import { sessionPricingModel } from "@/lib/pricing-model";

export const PAY_LABEL = "Estimated pay, before taxes and tips";
export const PAY_NOTE = "These are estimates, before taxes and tips. Payroll is the final record.";
export const MAX_RATE_CENTS = 200_00;
/** The hourly rate on any package not listed in the package rates. */
export const DEFAULT_RATE_CENTS = 30_00;
export const ESTIMATE_NOTE = "Estimate only. Final pay is based on your actual clock in and clock out, before taxes.";
export const NO_ADDRESS_TEXT = "Add your home address to see mileage";
export const PROFILE_HREF = "/team/me/profile";

// ----- The hourly rate for a line (one person on one event) -----
//
// The pay rule: $25 an hour on Beer and Wine, Bartender Only and Tailored
// events, $30 on every other package. Admins can change these in Business
// settings. A person's own rate, when one is set on their profile, wins over
// the package rate. lineRate is the only place this rule lives: the staff pay
// estimate, the Payout card, Payroll, Business labor and the Time page all
// figure their rate here.

export type PayPackage = "beerwine" | "bartender_only" | "tailored" | "dive" | "essentials" | "full" | "premium" | "wedding";
export const PAY_PACKAGES: PayPackage[] = ["beerwine", "bartender_only", "tailored", "dive", "essentials", "full", "premium", "wedding"];
export const PAY_PACKAGE_LABEL: Record<PayPackage, string> = {
  beerwine: "Beer and Wine",
  bartender_only: "Bartender Only",
  tailored: "Tailored",
  dive: "Dive Bar",
  essentials: "Essentials",
  full: "Full Bar",
  premium: "Premium Bar",
  wedding: "The Big Day Bar",
};
// Gratuity model rates by package (cents an hour), plus the service fee
// model rates when Business settings has been read (packageRates() fills it).
export type PackageRates = Record<PayPackage, number> & { serviceFee?: ServiceFeeRates };

// ----- Service fee events -----
//
// Bartenders: a rate by tier (Top $45, Core $40, Developing $35), using their
// tier on the day of the event. A new hire (fewer approved bartender events
// than the new hire count, on either model) gets the new hire rate ($30)
// whatever their tier; a count of 0 turns that off. Someone past it who is not
// placed in a tier gets the Core rate. Never less than the rate stored when they
// accepted the event (or, after an admin changed their role, the new role's
// rate at the time of the change), and once hours are approved the rate stored
// on the approval is the rate, so later changes never rewrite past pay.
// Barbacks, servers and event helpers: one support rate, $25. The role is the
// one on the assignment (lib/team/event-roles.ts), so a bartender working an
// event as a barback gets the support rate on it, and only events worked as
// Bartender count toward the new hire count. A person's own rate counts only
// when it is higher. No gratuity share. Gratuity model events keep every rule
// above exactly as it was.
//
// The tier and why a rate applies are for admins only: staff are only ever
// told "your rate" (forStaff strips the reason).

export type PayTier = "top" | "core" | "developing";
export interface ServiceFeeRates {
  top: number; // cents an hour
  core: number;
  developing: number;
  newHire: number;
  newHireEvents: number; // a count of approved events, not cents; 0 turns the new hire rate off
  support: number;
}
export const SERVICE_FEE_BARTENDER_CENTS = 45_00; // the Top rate
export const SUPPORT_RATE_CENTS = 25_00;
export const SERVICE_FEE_RATE_DEFAULTS: ServiceFeeRates = {
  top: SERVICE_FEE_BARTENDER_CENTS,
  core: 40_00,
  developing: 35_00,
  newHire: 30_00,
  newHireEvents: 1,
  support: SUPPORT_RATE_CENTS,
};
export const SERVICE_FEE_RATE_KEYS: (keyof ServiceFeeRates)[] = ["top", "core", "developing", "newHire", "newHireEvents", "support"];
export const SERVICE_FEE_RATE_LABEL: Record<keyof ServiceFeeRates, string> = {
  top: "Top tier bartenders",
  core: "Core tier bartenders",
  developing: "Developing tier bartenders",
  newHire: "New hire rate",
  newHireEvents: "New hire event count",
  support: "Barbacks, servers and event helpers",
};
export const MAX_NEW_HIRE_EVENTS = 50;

/** Why a service fee rate applies. Admins only, never shown or sent to staff. */
export type PayReason = "top" | "core" | "developing" | "not_placed" | "new_hire" | "accepted" | "own" | "support";
export const PAY_REASON_LABEL: Record<PayReason, string> = {
  top: "Top",
  core: "Core",
  developing: "Developing",
  not_placed: "Not placed, Core rate",
  new_hire: "New hire",
  accepted: "Rate when accepted",
  own: "Personal rate",
  support: "Support rate",
};
export const isPayReason = (v: unknown): v is PayReason => typeof v === "string" && v in PAY_REASON_LABEL;
export const NOT_PLACED_WARNING = "Not placed in a tier. Paid at the Core rate until placed.";

/** One bartender on one service fee event: what decides their rate. */
export interface PayStanding {
  tier: PayTier | null; // their tier on the day of the event; null: not placed yet
  approvedEvents: number; // events with approved hours before this one, on either model
  acceptedCents?: number | null; // the rate stored when they accepted this event: never paid less
  stored?: { cents: number; reason: PayReason | null } | null; // stored when this event's hours were approved: that is the rate
}

/** A new hire under the settings: fewer approved events than the count. */
export const isNewHire = (sf: ServiceFeeRates, approvedEvents: number): boolean => sf.newHireEvents > 0 && approvedEvents < sf.newHireEvents;

/**
 * The service fee rate before a personal rate: support, new hire, tier (Core
 * when not placed), raised to the rate stored when they accepted. With no
 * standing (the Business estimate before anyone accepts) a bartender is the Top rate.
 */
export function serviceFeeBase(sf: ServiceFeeRates, role: string | null | undefined, standing?: PayStanding | null): { cents: number; reason: PayReason } {
  if (isSupportRole(role)) return { cents: sf.support, reason: "support" };
  let base: { cents: number; reason: PayReason };
  if (!standing) base = { cents: sf.top, reason: "top" };
  else if (isNewHire(sf, standing.approvedEvents)) base = { cents: sf.newHire, reason: "new_hire" };
  else if (!standing.tier) base = { cents: sf.core, reason: "not_placed" };
  else base = { cents: sf[standing.tier], reason: standing.tier };
  const floor = standing?.acceptedCents ?? null;
  return floor && floor > base.cents ? { cents: floor, reason: "accepted" } : base;
}
/** The roles paid the support rate on a service fee event (the role on the assignment). Everyone else on the event is paid as a bartender. */
export const SUPPORT_ROLES = ["bar_back", "server", "event_helper"] as const;
export const isSupportRole = (role: unknown): boolean => (SUPPORT_ROLES as readonly unknown[]).includes(role);

/** Which event the line is on and who works it. Without it (or on a gratuity event) the gratuity rules apply. */
export interface RateContext {
  model?: unknown; // sessions.pricing_model
  role?: string | null;
  standing?: PayStanding | null; // service fee events: tier, approved events, the accepted and approved rates
}
export const PACKAGE_RATE_DEFAULTS: PackageRates = {
  beerwine: 25_00,
  bartender_only: 25_00,
  tailored: 25_00,
  dive: 30_00,
  essentials: 30_00,
  full: 30_00,
  premium: 30_00,
  wedding: 30_00,
};

/** The package as stored ("Tailored Bar", "Bartender Only Package", "Essentials Bar") as a rate slot. Null for anything not listed. */
export function payPackage(name: unknown): PayPackage | null {
  const p = String(name ?? "").toLowerCase().trim();
  if (!p) return null;
  if (p.includes("tailored")) return "tailored";
  if (p.includes("bartender only")) return "bartender_only";
  if (p.includes("essential")) return "essentials";
  return packageKey(p);
}

/** The package an event was booked with: the event's own field, else the session's. */
export function eventPackageName(ed: Record<string, unknown>, session?: { package_type?: unknown } | null): string {
  return String(ed.package || session?.package_type || "").trim();
}

export type RateSource = "own" | "package" | "default" | "service_fee" | "support";

export interface LineRate {
  cents: number;
  // own: set on the profile; package: the package rate; default: a package not listed;
  // service_fee: a bartender on a service fee event; support: a bar back, server or helper on one.
  source: RateSource;
  pkg: PayPackage | null;
  serviceFee?: boolean; // the line is on a service fee event
  reason?: PayReason; // service fee events: why this rate, for admins only (forStaff strips it)
  stored?: boolean; // the rate stored when the hours were approved
}

/**
 * The rate for one person on one event. Gratuity events: their own rate if one
 * is set, otherwise the package rate. Service fee events: the bartender rate
 * for the package or the support rate, and their own rate only when higher.
 */
export function lineRate(ownCents: number | null | undefined, packageName: unknown, rates: PackageRates = PACKAGE_RATE_DEFAULTS, ctx?: RateContext): LineRate {
  const pkg = payPackage(packageName);
  if (ctx && sessionPricingModel({ pricing_model: ctx.model }) === "service_fee") {
    const sf = rates.serviceFee ?? SERVICE_FEE_RATE_DEFAULTS;
    const support = isSupportRole(ctx.role);
    const stored = ctx.standing?.stored;
    if (stored && stored.cents > 0) {
      const reason = stored.reason ?? undefined;
      return { cents: stored.cents, source: reason === "own" ? "own" : support ? "support" : "service_fee", pkg, serviceFee: true, reason, stored: true };
    }
    const base = serviceFeeBase(sf, ctx.role, ctx.standing);
    if (ownCents && ownCents > base.cents) return { cents: ownCents, source: "own", pkg, serviceFee: true, reason: "own" };
    return { cents: base.cents, source: support ? "support" : "service_fee", pkg, serviceFee: true, reason: base.reason };
  }
  if (ownCents && ownCents > 0) return { cents: ownCents, source: "own", pkg };
  if (pkg) return { cents: rates[pkg] ?? DEFAULT_RATE_CENTS, source: "package", pkg };
  return { cents: DEFAULT_RATE_CENTS, source: "default", pkg: null };
}

/** The words staff see beside a rate on a service fee event: nothing about a tier, a rank, or a new hire rate. */
export const YOUR_RATE = "your rate";

/** Which rule applied: "own rate", "Tailored rate", "standard rate"; on a service fee event only "your rate". */
export function rateSourceText(r: Pick<LineRate, "source" | "pkg"> & { serviceFee?: boolean }): string {
  if (r.source === "service_fee" || r.source === "support" || (r.source === "own" && r.serviceFee)) return YOUR_RATE;
  if (r.source === "own") return "own rate";
  if (r.source === "package" && r.pkg) return `${PAY_PACKAGE_LABEL[r.pkg]} rate`;
  return "standard rate";
}

/** Arrival to service end plus an hour of breakdown, in minutes. Null without the times. */
export function scheduledMinutes(ed: Record<string, unknown>): number | null {
  const s = eventSchedule(ed);
  if (s.arrivalMin === null || s.endMin === null) return null;
  const m = s.endMin - s.arrivalMin + BREAKDOWN_MIN;
  return m > 0 ? m : null;
}

export function payCents(rateCents: number | null | undefined, minutes: number | null | undefined): number | null {
  if (!rateCents || rateCents <= 0 || minutes === null || minutes === undefined || minutes <= 0) return null;
  return Math.round((rateCents * minutes) / 60);
}

export function estimatedPayCents(rateCents: number | null | undefined, ed: Record<string, unknown>): number | null {
  return payCents(rateCents, scheduledMinutes(ed));
}

/** "$1,234.50" */
export function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "5.50" hours. */
export function hoursText(minutes: number | null): string {
  return minutes === null ? "" : (minutes / 60).toFixed(2);
}

/** "$25.00/hr" */
export function rateText(cents: number | null): string {
  return cents ? `${money(cents)}/hr` : "";
}

/** A rate typed by an admin, in dollars. Blank clears it. */
export function validateRate(raw: unknown): { ok: true; cents: number | null } | { ok: false; error: string } {
  const s = String(raw ?? "").trim().replace(/^\$/, "");
  if (!s) return { ok: true, cents: null };
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return { ok: false, error: "Enter the hourly rate in dollars, like 25 or 27.50." };
  const cents = Math.round(Number(s) * 100);
  if (cents <= 0 || cents > MAX_RATE_CENTS) return { ok: false, error: "Enter a rate between $0.01 and $200 an hour." };
  return { ok: true, cents };
}

export interface PayRow {
  sessionId: string;
  day: string | null;
  title: string;
  eventRole?: string; // the role worked on the event: "bar_back"
  rateCents: number;
  rateSource: RateSource;
  ratePkg: PayPackage | null;
  serviceFee?: boolean;
  tipsCents: number | null; // their share of the gratuity once it is on file
  reimbursements: { label: string; cents: number; note: string }[]; // their own, once an admin enters them
  scheduledMinutes: number | null;
  approvedMinutes: number | null; // clocked hours once an admin approved them
  payCents: number | null; // from approved hours, else the scheduled estimate
  fromApproved: boolean;
}

/** Monday of the week, YYYY-MM-DD. */
export function mondayOf(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Totals by week (Monday) and by month (YYYY-MM). */
export function payTotals(rows: PayRow[]): { weeks: { week: string; cents: number; rows: number }[]; months: { month: string; cents: number; rows: number }[] } {
  const weeks = new Map<string, { cents: number; rows: number }>();
  const months = new Map<string, { cents: number; rows: number }>();
  const bump = (map: Map<string, { cents: number; rows: number }>, key: string, cents: number) => {
    const t = map.get(key) ?? { cents: 0, rows: 0 };
    t.cents += cents;
    t.rows += 1;
    map.set(key, t);
  };
  for (const r of rows) {
    if (!r.day) continue;
    bump(weeks, mondayOf(r.day), r.payCents ?? 0);
    bump(months, r.day.slice(0, 7), r.payCents ?? 0);
  }
  return {
    weeks: [...weeks].sort((a, b) => a[0].localeCompare(b[0])).map(([week, t]) => ({ week, ...t })),
    months: [...months].sort((a, b) => a[0].localeCompare(b[0])).map(([month, t]) => ({ month, ...t })),
  };
}

// ----- Mileage -----

export interface MileageSettings {
  thresholdMiles: number; // one way: at or under this, no mileage
  deductionMiles: number; // taken off the round trip once
  rateCents: number; // per paid mile
  caRateCents: number; // per paid mile for events in the Los Angeles market
}

export const MILEAGE_DEFAULTS: MileageSettings = { thresholdMiles: 20, deductionMiles: 20, rateCents: 30, caRateCents: 40 };

export type MilesSource = "straight_line" | "driving" | "override";
export const MILES_SOURCE_LABEL: Record<MilesSource, string> = { straight_line: "straight line", driving: "driving", override: "adjusted" };

/** One way miles to a tenth. */
export const roundMiles = (m: number) => Math.round(m * 10) / 10;

/**
 * Paid miles and pay for one person on one event. 20 one way or less: nothing.
 * Over that: the round trip less the deduction, taken once. 50 one way is 100
 * round trip, 80 paid, $24.00 ($32.00 in California).
 */
export function mileagePay(oneWayMiles: number, s: MileageSettings, california: boolean): { paidMiles: number; cents: number } {
  const one = roundMiles(Math.max(0, oneWayMiles));
  if (one <= s.thresholdMiles) return { paidMiles: 0, cents: 0 };
  const paidMiles = roundMiles(Math.max(0, one * 2 - s.deductionMiles));
  return { paidMiles, cents: Math.round(paidMiles * (california ? s.caRateCents : s.rateCents)) };
}

/** What the mileage line says, for one person on one event. */
export type MileageLine =
  | { state: "paid"; oneWayMiles: number; paidMiles: number; cents: number; source: MilesSource; california: boolean; locked: boolean; adjustedBy: string | null; note: string | null }
  | { state: "no_address" } // no home address on file
  | { state: "not_found" } // an address, but it could not be found on the map
  | { state: "no_event_location" };

/** A stored or live distance, with any admin adjustment applied. */
export interface MilesInput {
  oneWayMiles: number | null; // null: no home address (or no event location, see reason)
  reason?: "no_address" | "not_found" | "no_event_location";
  source: MilesSource;
  locked: boolean; // stored when the person accepted
  overrideMiles?: number | null; // one way miles an admin or manager set
  overrideCents?: number | null; // a mileage amount an admin or manager set
  overrideNote?: string | null;
  overrideByName?: string | null;
}

export function mileageLine(m: MilesInput, s: MileageSettings, california: boolean): MileageLine {
  const adjusted = (m.overrideMiles ?? null) !== null || (m.overrideCents ?? null) !== null;
  const miles = m.overrideMiles ?? m.oneWayMiles;
  if (miles === null || miles === undefined) {
    if (m.overrideCents !== null && m.overrideCents !== undefined) {
      return { state: "paid", oneWayMiles: 0, paidMiles: 0, cents: m.overrideCents, source: "override", california, locked: m.locked, adjustedBy: m.overrideByName ?? null, note: m.overrideNote ?? null };
    }
    return { state: m.reason ?? "no_address" };
  }
  const p = mileagePay(miles, s, california);
  return {
    state: "paid",
    oneWayMiles: roundMiles(miles),
    paidMiles: p.paidMiles,
    cents: m.overrideCents ?? p.cents,
    source: adjusted ? "override" : m.source,
    california,
    locked: m.locked,
    adjustedBy: adjusted ? (m.overrideByName ?? null) : null,
    note: adjusted ? (m.overrideNote ?? null) : null,
  };
}

/** Miles worked out live (an open shift, an offer): straight line, not yet driving miles. */
export const APPROXIMATE = "approximate";

/** "80 paid miles (50 one way, driving)", "(50 one way, straight line, approximate)" before accepting. */
export function mileageText(l: MileageLine): string {
  if (l.state === "no_address") return NO_ADDRESS_TEXT;
  if (l.state === "not_found") return "We could not find your home address on the map. Check it on your profile.";
  if (l.state === "no_event_location") return "Mileage not available yet";
  const paid = `${l.paidMiles} paid ${l.paidMiles === 1 ? "mile" : "miles"}`;
  const parts = [`${l.oneWayMiles} one way`, MILES_SOURCE_LABEL[l.source]];
  if (!l.locked && l.source === "straight_line") parts.push(APPROXIMATE); // not on the event yet: no driving call made
  return `${paid} (${parts.join(", ")})${l.adjustedBy ? `, adjusted by ${l.adjustedBy}` : ""}`;
}

// ----- Tips -----

export type TipsLine = { state: "on_file"; cents: number; bartenders: number } | { state: "not_on_file" } | { state: "not_bartender" } | { state: "service_fee" };

/**
 * The booking's gratuity (dollars) split evenly among the bartenders. Null
 * gratuity: not on file. A service fee event has no gratuity to split.
 */
export function tipsShare(gratuityDollars: number | null | undefined, bartenders: number, isBartender: boolean, model?: unknown): TipsLine {
  if (sessionPricingModel({ pricing_model: model }) === "service_fee") return { state: "service_fee" };
  if (gratuityDollars === null || gratuityDollars === undefined || !Number.isFinite(Number(gratuityDollars))) return { state: "not_on_file" };
  if (!isBartender) return { state: "not_bartender" };
  const n = Math.max(1, Math.floor(bartenders));
  return { state: "on_file", cents: Math.round((Number(gratuityDollars) * 100) / n), bartenders: n };
}

export function tipsText(t: TipsLine): string {
  if (t.state === "service_fee") return "No gratuity share on a service fee event. Tips from the guests are yours.";
  if (t.state === "not_on_file") return "Tips: not on file yet";
  if (t.state === "not_bartender") return "Tips are split among the bartenders";
  return `${money(t.cents)}, split ${t.bartenders} ${t.bartenders === 1 ? "way" : "ways"}`;
}

// ----- One person's estimate -----

export interface StaffEstimate {
  rateCents: number;
  rateSource: RateSource;
  ratePkg: PayPackage | null;
  serviceFee: boolean;
  reason?: PayReason; // admins only: the Payout card shows it; forStaff takes it off
  rateStored?: boolean; // admins only: the rate stored when the hours were approved
  minutes: number | null;
  hourlyCents: number | null;
  mileage: MileageLine;
  tips: TipsLine;
  totalCents: number; // hourly + mileage + tips, leaving out what is not on file
}

export function staffEstimate(o: { rate: LineRate; minutes: number | null; mileage: MileageLine; tips: TipsLine }): StaffEstimate {
  const rateCents = o.rate.cents;
  const hourlyCents = payCents(rateCents, o.minutes);
  const mileageCents = o.mileage.state === "paid" ? o.mileage.cents : 0;
  const tipsCents = o.tips.state === "on_file" ? o.tips.cents : 0;
  return {
    rateCents,
    rateSource: o.rate.source,
    ratePkg: o.rate.pkg,
    serviceFee: !!o.rate.serviceFee,
    ...(o.rate.reason ? { reason: o.rate.reason } : {}),
    ...(o.rate.stored ? { rateStored: true } : {}),
    minutes: o.minutes,
    hourlyCents,
    mileage: o.mileage,
    tips: o.tips,
    totalCents: (hourlyCents ?? 0) + mileageCents + tipsCents,
  };
}

/** An estimate for the person it belongs to: the rate, never why (no tier, rank or new hire rate). */
export function forStaff(e: StaffEstimate): StaffEstimate {
  const { reason: _reason, rateStored: _stored, ...rest } = e;
  void _reason;
  void _stored;
  return rest;
}

/** The reason beside a rate on the Payout card and in Payroll: "Top", "New hire", "Personal rate". Admins only. */
export function payReasonText(reason: PayReason | null | undefined, stored = false): string {
  if (!reason) return "";
  return stored ? `${PAY_REASON_LABEL[reason]}, stored at approval` : PAY_REASON_LABEL[reason];
}

/** A typed override: one way miles and/or a mileage amount in dollars, and a note. */
export function validateMileageOverride(raw: { miles?: unknown; amount?: unknown; note?: unknown }):
  | { ok: true; miles: number | null; cents: number | null; note: string | null; clear: boolean }
  | { ok: false; error: string } {
  const milesS = String(raw.miles ?? "").trim();
  const amountS = String(raw.amount ?? "").trim().replace(/^\$/, "");
  const note = String(raw.note ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!milesS && !amountS) return { ok: true, miles: null, cents: null, note: null, clear: true };
  let miles: number | null = null;
  let cents: number | null = null;
  if (milesS) {
    if (!/^\d{1,4}(\.\d)?$/.test(milesS)) return { ok: false, error: "Enter one way miles, like 34 or 34.5." };
    miles = Number(milesS);
  }
  if (amountS) {
    if (!/^\d{1,4}(\.\d{1,2})?$/.test(amountS)) return { ok: false, error: "Enter the mileage amount in dollars, like 24 or 24.50." };
    cents = Math.round(Number(amountS) * 100);
  }
  if (note.length < 3) return { ok: false, error: "Add a note saying why." };
  return { ok: true, miles, cents, note, clear: false };
}
