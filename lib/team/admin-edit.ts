// Admin editing of event details: which fields the form can change, how form
// values are cleaned into the shapes event_data already uses, and the three
// price choices. Pure, no database.

import type { PriceChange } from "@/lib/price-change";

/** The only fields the admin form may change. Signature drinks are never touched here. */
export const ADMIN_EDIT_FIELDS = [
  "event_date",
  "bar_service_start",
  "bar_service_end",
  "guest_count",
  "bartenders",
  "package",
  "event_address",
  "parking_info",
  "day_of_contact_name",
  "day_of_contact_phone",
  "special_requests",
] as const;

export type AdminEditField = (typeof ADMIN_EDIT_FIELDS)[number];

/** Packages offered on the form. An event's current package is always offered too, even a retired one. */
export const PACKAGE_CHOICES = ["Dive Bar", "Full Bar", "Premium Bar", "The Big Day Bar", "Beer and Wine"];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-12-12" (a date input) as "December 12, 2026", the way intake stores dates. */
export function formDateToEvent(v: string): string | null {
  const m = v.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  return `${MONTHS[mo - 1]} ${d}, ${y}`;
}

/** "18:30" (a time input) as "6:30pm", the way intake stores times. */
export function formTimeToEvent(v: string): string | null {
  const m = v.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(min).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
}

function wholeNumber(v: unknown, min: number, max: number): number | null {
  const s = String(v ?? "").trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= max ? n : null;
}

export type CleanEdit = { ok: true; partial: Record<string, unknown> } | { ok: false; error: string };

/**
 * The fields an admin changed, cleaned. Unknown fields (signature drinks
 * included) are dropped. Each value is checked and put in the stored format.
 */
export function cleanAdminEdit(raw: unknown, currentPackage: unknown): CleanEdit {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Nothing to save." };
  const input = raw as Record<string, unknown>;
  const partial: Record<string, unknown> = {};
  for (const field of ADMIN_EDIT_FIELDS) {
    if (!(field in input)) continue;
    const v = input[field];
    switch (field) {
      case "event_date": {
        const d = formDateToEvent(String(v ?? ""));
        if (!d) return { ok: false, error: "Enter a valid event date." };
        partial[field] = d;
        break;
      }
      case "bar_service_start":
      case "bar_service_end": {
        const t = formTimeToEvent(String(v ?? ""));
        if (!t) return { ok: false, error: `Enter a valid bar service ${field.endsWith("start") ? "start" : "end"} time.` };
        partial[field] = t;
        break;
      }
      case "guest_count": {
        const n = wholeNumber(v, 1, 5000);
        if (n === null) return { ok: false, error: "Enter a guest count as a whole number." };
        partial[field] = n;
        break;
      }
      case "bartenders": {
        const n = wholeNumber(v, 1, 30);
        if (n === null) return { ok: false, error: "Enter the number of bartenders as a whole number." };
        partial[field] = n;
        break;
      }
      case "package": {
        const p = String(v ?? "").trim();
        if (!PACKAGE_CHOICES.includes(p) && p !== String(currentPackage ?? "").trim()) return { ok: false, error: "Pick a package from the list." };
        partial[field] = p;
        break;
      }
      default:
        partial[field] = String(v ?? "").trim().slice(0, 1000);
    }
  }
  if (Object.keys(partial).length === 0) return { ok: false, error: "Nothing changed." };
  return { ok: true, partial };
}

export type PriceMode = "keep" | "engine" | "manual";

export type PriceChoice = { ok: true; mode: PriceMode; total: number | null } | { ok: false; error: string };

export function cleanPriceChoice(raw: unknown): PriceChoice {
  const r = (raw ?? {}) as { mode?: unknown; total?: unknown };
  if (r.mode === "keep" || r.mode === "engine") return { ok: true, mode: r.mode, total: null };
  if (r.mode === "manual") {
    const n = typeof r.total === "number" ? r.total : parseFloat(String(r.total ?? "").replace(/[$,\s]/g, ""));
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return { ok: false, error: "Enter the new total as a dollar amount." };
    return { ok: true, mode: "manual", total: Math.round(n * 100) / 100 };
  }
  return { ok: false, error: "Pick how to handle the price." };
}

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

/**
 * The price change saved with an admin edit, from the engine's quote and the
 * admin's choice:
 * - keep: the booked total stays as is
 * - engine: the engine's difference applies, unchanged
 * - manual: the admin's total replaces it
 * The engine's basis is kept either way, so the next change is priced against
 * the event as it now stands.
 */
export function adminPrice(engine: PriceChange, mode: PriceMode, manualTotal: number | null, adminFirstName: string): PriceChange {
  const who = adminFirstName || "An admin";
  const booked = engine.booked_total;
  if (mode === "engine") {
    return { ...engine, summary: `${engine.summary} Price from the pricing engine, applied by ${who}.`.trim() };
  }
  if (mode === "keep") {
    return {
      ...engine,
      amount: booked === null ? null : 0,
      new_total: booked,
      package_price: null,
      gratuity: null,
      price_text: booked === null ? `${who} kept the booked total. No booked total on file.` : `${who} kept the booked total at ${money(booked)}.`,
    };
  }
  const total = manualTotal ?? 0;
  const amount = booked === null ? null : Math.round((total - booked) * 100) / 100;
  return {
    ...engine,
    amount,
    new_total: total,
    package_price: null,
    gratuity: null,
    price_text:
      amount === null
        ? `${who} set the new total to ${money(total)}.`
        : `${who} set the new total to ${money(total)}, a difference of ${amount < 0 ? "-" : ""}${money(Math.abs(amount))}.`,
  };
}

/** Who made a change, for the event_updates row and the GHL payload. */
export interface UpdatedBy {
  kind: "admin";
  name: string; // the admin's first name
  staffId: string;
}
