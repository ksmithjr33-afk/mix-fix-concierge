// The GHL booking webhook (/api/create-session): reading the body, cleaning
// each field, and the package_summary fallback. Pure, no database.
//
// Every field is optional. Blank strings, whitespace, unrendered merge tags
// (anything still containing "{{"), and the text "null" or "undefined" (how GHL
// sends an empty field) count as missing (lib/blank.ts). Dedicated fields
// always win over what package_summary says, and the total price is never
// read from the summary.
//
// Two pricing models (lib/pricing-model.ts). A booking is on the service fee
// model when pricing_model says so, or, with no pricing_model, when it sends
// standard_price or addons_total. On a service fee booking:
//   - the grand total is build_a_bar_price, official_total_price, total_price
//     or package_price, in that order. package_price is the GRAND TOTAL here,
//     never the package alone. Totals more than $1 apart flag the price.
//   - the engine inputs also come as package_key, service_hours and
//     number_of_bartenders.
//   - gratuity, tip_per_bartender and the summary's "Gratuity:" line are not read.
//   - a promo code is stored as sent and never decoded.
// Gratuity model bookings read exactly what they always did.

import { parseTipJar } from "@/lib/price-change";
import { normalizePhone } from "@/lib/team/codes";
import { formatClock, parseClock } from "@/lib/team/time";
import { isBlank } from "@/lib/blank";
import { bookingPricingModel, type PricingModel } from "@/lib/pricing-model";
import { SERVICE_FEE_PACKAGES, serviceFeePackage } from "@/lib/service-fee";

export { parseTipJar };

// ---------- body ----------

/**
 * Escape raw newlines, carriage returns and tabs inside JSON string values,
 * and quotation marks that cannot be the end of a string. GHL drops
 * package_summary into the JSON body as is, line breaks and quotes included.
 */
export function repairJsonBody(raw: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      continue;
    }
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === "\n") { out += "\\n"; continue; }
    if (ch === "\r") { out += "\\r"; continue; }
    if (ch === "\t") { out += "\\t"; continue; }
    if (ch === '"') {
      if (closesString(raw, i)) {
        inString = false;
        out += ch;
      } else {
        out += '\\"';
      }
      continue;
    }
    out += ch;
  }
  return out;
}

/** A quote ends a string when what follows can only come after a value or key. */
function closesString(raw: string, i: number): boolean {
  let j = i + 1;
  while (j < raw.length && /\s/.test(raw[j])) j++;
  if (j >= raw.length) return true;
  const next = raw[j];
  if (next === ":" || next === "}" || next === "]") return true;
  if (next === ",") {
    let k = j + 1;
    while (k < raw.length && /\s/.test(raw[k])) k++;
    return k >= raw.length || raw[k] === '"' || raw[k] === "}" || raw[k] === "]";
  }
  return false;
}

export type ParsedBody = { ok: true; body: Record<string, unknown>; how: "json" | "repaired" | "form" } | { ok: false };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** JSON, then repaired JSON, then form encoded with the same keys. */
export function parseBookingBody(raw: string, contentType: string | null = null): ParsedBody {
  const text = raw.replace(/^﻿/, "");
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    const form = parseForm(text);
    if (form) return { ok: true, body: form, how: "form" };
  }
  try {
    const v = JSON.parse(text);
    if (isObject(v)) return { ok: true, body: v, how: "json" };
  } catch {
    /* repaired below */
  }
  if (text.trim().startsWith("{")) {
    try {
      const v = JSON.parse(repairJsonBody(text));
      if (isObject(v)) return { ok: true, body: v, how: "repaired" };
    } catch {
      /* form below */
    }
  }
  const form = parseForm(text);
  return form ? { ok: true, body: form, how: "form" } : { ok: false };
}

function parseForm(text: string): Record<string, unknown> | null {
  const t = text.trim();
  if (!t || t.startsWith("{") || !t.includes("=")) return null;
  const params = new URLSearchParams(t);
  const out: Record<string, unknown> = {};
  for (const [k, v] of params) if (k) out[k] = v;
  return Object.keys(out).length ? out : null;
}

// ---------- fields ----------

/** The text of a field, or null when it is missing: blank, whitespace, an unrendered merge tag, or the text "null" or "undefined". */
export function clean(v: unknown): string | null {
  if (typeof v === "boolean") return String(v);
  return isBlank(v) ? null : String(v).trim();
}

/**
 * The booking fields we expect on every booking, by the payload key GHL sends.
 * Any that arrive missing are logged when the session is created.
 */
export const EXPECTED_BOOKING_FIELDS: readonly { key: string; label: string; of: (b: Booking) => unknown }[] = [
  { key: "contact_id", label: "GHL contact", of: (b) => b.contactId },
  { key: "name", label: "name", of: (b) => b.name },
  { key: "email", label: "email", of: (b) => b.email },
  { key: "phone", label: "phone", of: (b) => b.phone },
  { key: "event_date", label: "event date", of: (b) => b.eventDate },
  { key: "start_time", label: "bar service start", of: (b) => b.startTime },
  { key: "package_type", label: "package", of: (b) => b.packageType },
  { key: "guest_count", label: "guest count", of: (b) => b.guestCount },
  { key: "event_type", label: "event type", of: (b) => b.eventType },
  { key: "hours_booked", label: "hours booked", of: (b) => b.hoursBooked },
  { key: "bartender_count", label: "bartenders", of: (b) => b.bartenderCount },
  { key: "total_price", label: "total price", of: (b) => b.totalCents },
  { key: "city", label: "city", of: (b) => b.city },
  { key: "state", label: "state", of: (b) => b.state },
];

/** On a service fee booking the same facts arrive under the quote tool's key names. */
const SERVICE_FEE_KEY: Record<string, string> = {
  package_type: "package_key",
  hours_booked: "service_hours",
  bartender_count: "number_of_bartenders",
  total_price: "build_a_bar_price",
};

/** The expected booking fields this booking is missing, by payload key. */
export function missingBookingFields(b: Booking): string[] {
  const missing = EXPECTED_BOOKING_FIELDS.filter((f) => f.of(b) === null || f.of(b) === undefined).map((f) => f.key);
  if (b.pricingModel !== "service_fee") return missing;
  const out = missing.map((k) => SERVICE_FEE_KEY[k] ?? k);
  if (b.standardPriceCents === null && b.customPriceCents === null) out.push("standard_price");
  if (b.addonsTotalCents === null) out.push("addons_total");
  return out;
}

/** "$1,749.50" → 174950. Null when missing or not an amount. */
export function parseMoneyCents(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) : null;
  const s = clean(v);
  if (s === null) return null;
  const t = s.replace(/[$,\s]/g, "").replace(/^usd/i, "");
  if (!/^-?(\d+(\.\d*)?|\.\d+)$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export const centsToDollars = (c: number | null): number | null => (c === null ? null : c / 100);

/** A whole number above zero, else null. "2", "2 bartenders" → 2. */
export function parseCount(v: unknown): number | null {
  const s = clean(v);
  if (s === null) return null;
  const m = s.match(/^\D*(\d+)/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return n > 0 ? n : null;
}

/** "6:00 PM", "6pm", "18:00" → "6:00 PM". Null when missing or not a time. */
export function parseStartTime(v: unknown): string | null {
  const s = clean(v);
  if (s === null) return null;
  const t = s.toLowerCase().replace(/\s+/g, "");
  let m = t.match(/^(\d{1,2})(?::(\d{2}))?([ap])\.?m\.?$/);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2] ?? "0");
    if (h < 1 || h > 12 || min > 59) return null;
    return `${h}:${String(min).padStart(2, "0")} ${m[3] === "a" ? "AM" : "PM"}`;
  }
  m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(min).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  }
  return null;
}

/** Normalized like staff phones (+1XXXXXXXXXX); the trimmed text when it is not a US number. */
export function cleanPhone(v: unknown): string | null {
  const s = clean(v);
  if (s === null) return null;
  return normalizePhone(s) ?? s;
}

// ---------- package_summary ----------

export interface SummaryFacts {
  city: string | null;
  state: string | null;
  promoCode: string | null;
  discountCents: number | null;
  tipJar: boolean | null;
  gratuityCents: number | null;
}

const MONEY = /\$\s*(\d[\d,]*(?:\.\d{1,2})?)/;

/**
 * The few facts read from package_summary, and nothing else: city and state
 * from the second line ("in City, ST"), the promo code and discount from the
 * discount line ("$41 off (RETURN5)"), and the tip jar and gratuity from the
 * Gratuity line. Never the total.
 */
export function parsePackageSummary(text: unknown): SummaryFacts {
  const facts: SummaryFacts = { city: null, state: null, promoCode: null, discountCents: null, tipJar: null, gratuityCents: null };
  const s = clean(text);
  if (s === null) return facts;
  const lines = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const place = (lines[1] ?? "").match(/\bin\s+([A-Za-z][A-Za-z.' -]*?),\s*([A-Za-z]{2})\b/);
  if (place) {
    facts.city = place[1].trim();
    facts.state = place[2].toUpperCase();
  }

  const discountLine = lines.find((l) => /\$\s*\d[\d,]*(?:\.\d{1,2})?\s*off\b/i.test(l));
  if (discountLine) {
    const off = discountLine.match(/\$\s*(\d[\d,]*(?:\.\d{1,2})?)\s*off\b/i);
    if (off) facts.discountCents = parseMoneyCents(off[1]);
    const code = discountLine.match(/\(\s*([A-Za-z0-9_-]+)\s*\)/);
    if (code) facts.promoCode = code[1].toUpperCase();
  }

  const gratLine = lines.find((l) => /^gratuity\s*:/i.test(l));
  if (gratLine) {
    if (/\bno\s+tip\s+jar\b/i.test(gratLine)) facts.tipJar = false;
    else if (/\btip\s+jar\b/i.test(gratLine)) facts.tipJar = true;
    const amt = gratLine.match(MONEY);
    if (amt) facts.gratuityCents = parseMoneyCents(amt[1]);
  }
  return facts;
}

// ---------- the whole booking ----------

export interface Booking {
  contactId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  eventDate: string | null;
  startTime: string | null;
  packageType: string | null;
  guestCount: string | null;
  eventName: string | null; // null when it only repeats event_type
  eventType: string | null;
  hoursBooked: string | null;
  bartenderCount: number | null;
  tipJar: boolean | null;
  promoCode: string | null;
  totalCents: number | null; // total_price, else the older "total"; never from the summary
  gratuityCents: number | null;
  tipPerBartenderCents: number | null;
  discountCents: number | null;
  packageSummary: string | null; // raw, line breaks kept
  city: string | null;
  state: string | null;
  // Older payload keys still honored.
  packagePriceCents: number | null; // gratuity model only: the package alone. Never set on a service fee booking.
  customPriceCents: number | null;
  depositPaidCents: number | null;
  // Which pricing model, and why it needs a check when it was not said.
  pricingModel: PricingModel;
  modelCheck: string | null;
  // Service fee model only (null or false on a gratuity booking).
  packageKey: string | null; // package_key, else package_type, as sent
  isWedding: boolean;
  standardPriceCents: number | null;
  addonsTotalCents: number | null;
  ownerOverride: boolean;
  woodenBar: boolean | null; // null: not sent
  barback: boolean | null; // null: not sent
  secondBar: boolean | null;
  balanceDueCents: number | null;
  addonLines: { key: string; label: string; cents: number }[]; // each add on's own *_price field, shown only
  totalSource: string | null; // the key the grand total came from
  totalCheck: string | null; // the grand total fields disagree by more than $1
}

/** Yes, No, true, false, Included, Removed. Null when missing or unclear. */
export function parseYesNo(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  const s = clean(v)?.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").trim();
  if (!s) return null;
  if (/^(yes|y|true|t|1|on|included|include|with|added)\b/.test(s)) return true;
  if (/^(no|n|false|f|0|off|removed|remove|none|without)\b/.test(s)) return false;
  return null;
}

/** The grand total keys of a service fee booking, first wins. */
export const GRAND_TOTAL_KEYS = ["build_a_bar_price", "official_total_price", "total_price", "package_price"] as const;

/** Keys ending in _price that are money fields, not add on lines. */
const NOT_ADDON_PRICE = new Set<string>([...GRAND_TOTAL_KEYS, "standard_price", "custom_price"]);

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** The grand total: the first of the keys sent, and a check when another one is more than $1 off. */
export function grandTotal(body: Record<string, unknown>): { cents: number | null; source: string | null; check: string | null } {
  const sent = GRAND_TOTAL_KEYS.map((k) => ({ k, c: parseMoneyCents(body[k]) })).filter((x): x is { k: (typeof GRAND_TOTAL_KEYS)[number]; c: number } => x.c !== null && x.c > 0);
  if (sent.length === 0) return { cents: null, source: null, check: null };
  const first = sent[0];
  const off = sent.filter((x) => Math.abs(x.c - first.c) > 100);
  const check = off.length
    ? `The grand total fields disagree: ${sent.map((x) => `${x.k} ${usd(x.c)}`).join(", ")}. Saved with ${first.k}.`
    : null;
  return { cents: first.c, source: first.k, check };
}

/** "menu_frame_price" → "Menu frame". */
const addonLabel = (key: string) => {
  const t = key.replace(/_price$/, "").replace(/_/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

function addonLines(body: Record<string, unknown>): Booking["addonLines"] {
  const out: Booking["addonLines"] = [];
  for (const key of Object.keys(body)) {
    if (!/_price$/.test(key) || NOT_ADDON_PRICE.has(key)) continue;
    const cents = parseMoneyCents(body[key]);
    if (cents !== null && cents > 0) out.push({ key, label: addonLabel(key), cents });
  }
  return out;
}

/** Every field cleaned, with package_summary filling only what the dedicated fields left missing. */
export function readBooking(body: Record<string, unknown>): Booking {
  const standardPriceCents = parseMoneyCents(body.standard_price);
  const addonsTotalCents = parseMoneyCents(body.addons_total);
  const { model, check: modelCheck } = bookingPricingModel({
    pricingModel: clean(body.pricing_model),
    hasStandardPrice: standardPriceCents !== null,
    hasAddonsTotal: addonsTotalCents !== null,
  });
  const gratuityBooking = readGratuityBooking(body);
  if (model === "gratuity") return { ...gratuityBooking, modelCheck };
  return readServiceFeeBooking(body, gratuityBooking, standardPriceCents, addonsTotalCents);
}

/** A service fee booking: the gratuity reading, with the quote tool's keys and money on top. */
function readServiceFeeBooking(body: Record<string, unknown>, g: Booking, standardPriceCents: number | null, addonsTotalCents: number | null): Booking {
  const total = grandTotal(body);
  const packageKey = clean(body.package_key) ?? clean(body.package_type);
  const key = serviceFeePackage(packageKey);
  const promo = clean(body.promo_code);
  const tipJar = parseTipJar(clean(body.tip_jar)) ?? parseTipJar(clean(body.tip_jar_allowed));
  const kind = g.eventType ?? g.eventName ?? "";
  return {
    ...g,
    packageType: clean(body.package_type) ?? (key ? SERVICE_FEE_PACKAGES[key].label : packageKey),
    hoursBooked: clean(body.service_hours) ?? g.hoursBooked,
    bartenderCount: parseCount(body.number_of_bartenders) ?? g.bartenderCount,
    tipJar,
    // Stored as sent, never decoded, never read from the summary.
    promoCode: promo ? promo.toUpperCase() : null,
    totalCents: total.cents,
    gratuityCents: null,
    tipPerBartenderCents: null,
    discountCents: parseMoneyCents(body.discount_amount),
    packagePriceCents: null,
    pricingModel: "service_fee",
    modelCheck: null,
    packageKey,
    isWedding: /wedding/i.test(kind) || key === "wedding",
    standardPriceCents,
    addonsTotalCents,
    ownerOverride: parseYesNo(body.owner_override) === true,
    woodenBar: parseYesNo(body.wooden_bar),
    barback: parseYesNo(body.barback),
    secondBar: parseYesNo(body.second_bar),
    balanceDueCents: parseMoneyCents(body.balance_due),
    addonLines: addonLines(body),
    totalSource: total.source,
    totalCheck: total.check,
  };
}

/** Every field as a gratuity model booking reads it (unchanged from before the service fee model). */
function readGratuityBooking(body: Record<string, unknown>): Booking {
  const rawSummary = typeof body.package_summary === "string" && clean(body.package_summary) !== null ? body.package_summary : null;
  const sum = parsePackageSummary(rawSummary);
  const eventType = clean(body.event_type);
  const eventNameRaw = clean(body.event_name);
  const eventName = eventNameRaw && eventType && eventNameRaw.toLowerCase() === eventType.toLowerCase() ? null : eventNameRaw;
  const promo = clean(body.promo_code);
  const tipJarField = parseTipJar(clean(body.tip_jar));
  return {
    contactId: clean(body.contact_id),
    name: clean(body.name),
    email: clean(body.email),
    phone: cleanPhone(body.phone),
    eventDate: clean(body.event_date),
    startTime: parseStartTime(body.start_time),
    packageType: clean(body.package_type),
    guestCount: clean(body.guest_count),
    eventName,
    eventType,
    hoursBooked: clean(body.hours_booked),
    bartenderCount: parseCount(body.bartender_count) ?? parseCount(body.bartenders),
    tipJar: tipJarField ?? sum.tipJar,
    promoCode: promo ? promo.toUpperCase() : sum.promoCode,
    totalCents: parseMoneyCents(body.total_price) ?? parseMoneyCents(body.total),
    gratuityCents: parseMoneyCents(body.gratuity) ?? sum.gratuityCents,
    tipPerBartenderCents: parseMoneyCents(body.tip_per_bartender),
    discountCents: parseMoneyCents(body.discount_amount) ?? sum.discountCents,
    packageSummary: rawSummary,
    city: clean(body.city) ?? sum.city,
    state: (clean(body.state) ?? sum.state)?.toUpperCase() ?? null,
    packagePriceCents: parseMoneyCents(body.package_price),
    customPriceCents: parseMoneyCents(body.custom_price),
    depositPaidCents: parseMoneyCents(body.deposit_paid),
    pricingModel: "gratuity",
    modelCheck: null,
    packageKey: null,
    isWedding: false,
    standardPriceCents: null,
    addonsTotalCents: null,
    ownerOverride: false,
    woodenBar: null,
    barback: null,
    secondBar: null,
    balanceDueCents: null,
    addonLines: [],
    totalSource: null,
    totalCheck: null,
  };
}

/** True when the booking carries any price information worth a booked_price. */
export function hasPriceInfo(b: Booking): boolean {
  if (b.pricingModel === "service_fee") return true; // always gets a booked_price, flagged when the money is missing
  return [b.totalCents, b.gratuityCents, b.packagePriceCents, b.customPriceCents, b.discountCents, b.depositPaidCents, b.tipPerBartenderCents, b.bartenderCount, b.promoCode, b.tipJar].some(
    (v) => v !== null
  );
}

/** A total the booking can be priced at: present and above zero. */
export const validTotal = (b: Booking): boolean => b.totalCents !== null && b.totalCents > 0;

/**
 * What event_data gets from the booking when the client finishes the
 * concierge: only the keys the chatbot left blank. The chatbot's answer wins.
 */
export function bookingFill(ed: Record<string, unknown>, session: Record<string, unknown>): Record<string, unknown> {
  const blank = (v: unknown) => clean(v) === null;
  const fill: Record<string, unknown> = {};
  const start = clean(session.bar_service_start);
  if (start && blank(ed.bar_service_start)) fill.bar_service_start = start;
  // The concierge does not ask for a booked start time, so the end comes from
  // the start and the booked hours when the chatbot left it blank.
  const finalStart = parseClock(fill.bar_service_start ?? ed.bar_service_start);
  const hours = Number(session.hours_booked);
  if (finalStart !== null && blank(ed.bar_service_end) && Number.isFinite(hours) && hours > 0) {
    fill.bar_service_end = formatClock(finalStart + Math.round(hours * 60));
  }
  const bartenders = Number(session.bartender_count);
  if (Number.isInteger(bartenders) && bartenders > 0 && blank(ed.bartenders)) fill.bartenders = bartenders;
  const type = clean(session.event_type);
  if (type && blank(ed.event_type)) fill.event_type = type;
  const phone = clean(session.phone);
  if (phone && blank(ed.client_phone)) fill.client_phone = phone;
  return fill;
}

/** "Prosper, TX" from the session's booked city and state, used only when there is no event address. */
export function cityFallback(session: Record<string, unknown>): string {
  const city = clean(session.event_city);
  if (!city) return "";
  const state = clean(session.event_state);
  return state ? `${city}, ${state}` : city;
}

// ---------- the price check text ----------

/** The text every alert admin gets when a new booking is saved with "Price needs a check". */
export function priceCheckAlertText(b: Booking, sessionId: string, reason: string, link: string): string {
  const who = [b.name ?? b.email, b.eventDate, b.packageType].filter(Boolean).join(", ");
  const model = b.pricingModel === "service_fee" ? "service fee model" : "gratuity model";
  return `Price needs a check on a new booking: ${who || `session ${sessionId}`}. Saved on the ${model}. ${reason} The event page opens once the client finishes the concierge: ${link}`;
}
