// The GHL booking webhook (/api/create-session): reading the body, cleaning
// each field, and the package_summary fallback. Pure, no database.
//
// Every field is optional. Blank strings, whitespace, and unrendered merge
// tags (anything still containing "{{") count as missing. Dedicated fields
// always win over what package_summary says, and the total price is never
// read from the summary.

import { parseTipJar } from "@/lib/price-change";
import { normalizePhone } from "@/lib/team/codes";

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

/** The text of a field, or null when it is missing: blank, whitespace, or an unrendered merge tag. */
export function clean(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") return null;
  const s = String(v).trim();
  if (!s || s.includes("{{")) return null;
  return s;
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
  packagePriceCents: number | null;
  customPriceCents: number | null;
  depositPaidCents: number | null;
}

/** Every field cleaned, with package_summary filling only what the dedicated fields left missing. */
export function readBooking(body: Record<string, unknown>): Booking {
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
  };
}

/** True when the booking carries any price information worth a booked_price. */
export function hasPriceInfo(b: Booking): boolean {
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
