// Admin editing of event details: which fields the form can change, how form
// values are cleaned into the shapes event_data already uses, and the three
// price choices. Pure, no database.

import { SERVICE_FEE_TEXT, splitFromCustom } from "@/lib/service-fee";
import { serviceFeeBreakdown, type PriceChange } from "@/lib/price-change";
import { eventDay, parseClock } from "@/lib/team/time";

/**
 * The only fields an admin may change, on the "Edit everything" form or one at
 * a time on the manager view's Details cards. Every one is also in
 * UPDATABLE_FIELDS (lib/event-diff.ts), so it saves through the client update
 * path. Signature drinks are never touched here.
 */
export const ADMIN_EDIT_FIELDS = [
  "event_date",
  "bar_service_start",
  "bar_service_end",
  "guest_count",
  "bartenders",
  "package",
  "barback", // Full Bar weddings: the Booking card removes it or adds it back
  "event_address",
  "parking_info",
  "day_of_contact_name",
  "day_of_contact_phone",
  "special_requests",
  // One field at a time on the Details cards.
  "event_name",
  "venue_type",
  "indoor_outdoor",
  "bar_on_site",
  "bar_floor_access",
  "bar_details",
  "theme",
  "event_colors",
  "menu_colors",
  "allergies",
  "beer",
  "wine",
  "client_providing_beer_wine",
  "beer_and_wine_details",
  "extra_bottles",
  "drinking_pace",
  "dual_bar_setup",
] as const;

export type AdminEditField = (typeof ADMIN_EDIT_FIELDS)[number];

export const isAdminEditField = (v: unknown): v is AdminEditField => typeof v === "string" && (ADMIN_EDIT_FIELDS as readonly string[]).includes(v);

/** The input each field gets when it is edited in place. */
export type FieldKind = "text" | "longtext" | "date" | "time" | "number" | "package" | "yesno" | "venue" | "list";

export type EditCard = "event" | "location" | "contact" | "style";

export interface FieldSpec {
  field: AdminEditField;
  label: string;
  card: EditCard;
  kind: FieldKind;
  // Saving asks for a confirm first, with the price difference and new total:
  // the priced fields, and the date (which the engine does not price).
  confirm: boolean;
  priced: boolean; // a PRICED_FIELDS field: the price choice applies
}

const spec = (field: AdminEditField, label: string, card: EditCard, kind: FieldKind, priced = false, confirm = priced): FieldSpec => ({ field, label, card, kind, priced, confirm });

/** Every field editable in place, in the order the Details cards show them. */
export const FIELD_SPECS: FieldSpec[] = [
  spec("event_name", "Event name", "event", "text"),
  spec("event_date", "Date", "event", "date", false, true),
  spec("bar_service_start", "Bar service start", "event", "time", true),
  spec("bar_service_end", "Bar service end", "event", "time", true),
  spec("guest_count", "Guest count", "event", "number", true),
  spec("package", "Package", "event", "package", true),
  spec("bartenders", "Bartenders", "event", "number", true),
  spec("event_address", "Address", "location", "text"),
  spec("venue_type", "Venue type", "location", "venue"),
  spec("indoor_outdoor", "Bar setting", "location", "text"),
  spec("bar_on_site", "Bar on site", "location", "text"),
  spec("bar_floor_access", "Bar floor access", "location", "text"),
  spec("bar_details", "Bar details", "location", "longtext"),
  spec("parking_info", "Parking", "location", "longtext"),
  spec("dual_bar_setup", "Second bar setup", "location", "yesno"),
  spec("day_of_contact_name", "Contact", "contact", "text"),
  spec("day_of_contact_phone", "Phone", "contact", "text"),
  spec("theme", "Theme", "style", "text"),
  spec("event_colors", "Colors", "style", "text"),
  spec("menu_colors", "Menu colors", "style", "text"),
  spec("allergies", "Allergies", "style", "list"),
  spec("beer", "Beer", "style", "yesno"),
  spec("wine", "Wine", "style", "yesno"),
  spec("client_providing_beer_wine", "Client bringing beer and wine", "style", "yesno"),
  spec("beer_and_wine_details", "Beer and wine details", "style", "longtext"),
  spec("drinking_pace", "Drinking pace", "style", "text"),
  spec("special_requests", "Special requests", "style", "longtext"),
  spec("extra_bottles", "Client note on bottles", "style", "longtext"),
];

export function fieldSpec(field: AdminEditField): FieldSpec {
  return FIELD_SPECS.find((f) => f.field === field)!;
}

/** "18:30" from a stored time ("6:30pm"), for a time input. */
function formTime(v: unknown): string {
  const m = parseClock(v);
  if (m === null) return "";
  const n = m % 1440;
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}

const plain = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/**
 * A field's stored value as its input holds it: a date as YYYY-MM-DD, a time
 * as HH:MM, yes or no as "yes" / "no" / "" (not answered), allergies as
 * "nuts, shellfish". The inverse of cleanAdminEdit.
 */
export function formValue(field: AdminEditField, ed: Record<string, unknown>, session: { event_date?: string | null; guest_count?: unknown; package_type?: unknown } = {}, bartenders?: number | null): string {
  const v = ed[field];
  switch (field) {
    case "event_date":
      return eventDay(ed.event_date ?? session.event_date) ?? "";
    case "bar_service_start":
    case "bar_service_end":
      return formTime(v);
    case "guest_count":
      return plain(v ?? session.guest_count);
    case "package":
      return plain(v ?? session.package_type);
    case "bartenders":
      return plain(bartenders ?? v ?? "");
    case "allergies":
      return Array.isArray(v) ? v.map(String).join(", ") : plain(v);
    case "beer":
    case "wine":
    case "client_providing_beer_wine":
    case "dual_bar_setup":
      return v === true ? "yes" : v === false ? "no" : "";
    default:
      return plain(v);
  }
}

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
      case "beer":
      case "wine":
      case "client_providing_beer_wine":
      case "dual_bar_setup": {
        const b = v === true || /^(yes|true)$/i.test(String(v ?? "").trim()) ? true : v === false || /^(no|false)$/i.test(String(v ?? "").trim()) ? false : null;
        if (b === null) return { ok: false, error: "Pick yes or no." };
        partial[field] = b;
        break;
      }
      case "barback": {
        const t = String(v ?? "").trim().toLowerCase();
        if (t !== "included" && t !== "removed") return { ok: false, error: "Pick Included or Removed for the barback." };
        partial[field] = t === "removed" ? "Removed" : "Included";
        break;
      }
      case "venue_type": {
        const t = String(v ?? "").trim();
        if (t !== "venue" && t !== "private_residence") return { ok: false, error: "Pick Venue or Private residence." };
        partial[field] = t;
        break;
      }
      case "allergies": {
        const list = (Array.isArray(v) ? v.map(String) : String(v ?? "").split(/[,\n]/))
          .map((a) => a.trim().slice(0, 100))
          .filter(Boolean)
          .slice(0, 30);
        partial[field] = list;
        break;
      }
      default:
        partial[field] = String(v ?? "").trim().slice(0, 1000);
    }
  }
  if (Object.keys(partial).length === 0) return { ok: false, error: "Nothing changed." };
  return { ok: true, partial };
}

// pending: only when the engine cannot price the change. It is saved and the
// event is marked price pending, the same rule as a client change (lib/price-pending.ts).
export type PriceMode = "keep" | "engine" | "manual" | "pending";

export type PriceChoice = { ok: true; mode: PriceMode; total: number | null } | { ok: false; error: string };

export function cleanPriceChoice(raw: unknown): PriceChoice {
  const r = (raw ?? {}) as { mode?: unknown; total?: unknown };
  if (r.mode === "keep" || r.mode === "engine" || r.mode === "pending") return { ok: true, mode: r.mode, total: null };
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
      service_fee: null,
      addons_total: null,
      price_text: booked === null ? `${who} kept the booked total. No booked total on file.` : `${who} kept the booked total at ${money(booked)}.`,
    };
  }
  const total = manualTotal ?? 0;
  const amount = booked === null ? null : Math.round((total - booked) * 100) / 100;
  // Service fee events: the fee is carved out of the typed total less add ons, at the event's rate.
  const sf =
    engine.service_fee_rate !== undefined && engine.service_fee_rate !== null
      ? (() => {
          const addons = Math.round((engine.addons_total ?? 0) * 100);
          const s = splitFromCustom(Math.max(0, Math.round(total * 100) - addons), Math.round(engine.service_fee_rate * 10000), addons);
          return { package_price: s.packageCents / 100, service_fee: s.feeCents / 100 };
        })()
      : null;
  return {
    ...engine,
    amount,
    new_total: total,
    package_price: sf ? sf.package_price : null,
    gratuity: null,
    ...(sf ? { service_fee: sf.service_fee } : {}),
    price_text: [
      amount === null
        ? `${who} set the new total to ${money(total)}.`
        : `${who} set the new total to ${money(total)}, a difference of ${amount < 0 ? "-" : ""}${money(Math.abs(amount))}.`,
      // Service fee events: the fee on its own line and the fee sentence, as on every change order.
      ...(sf ? [serviceFeeBreakdown({ package_price: sf.package_price, service_fee: sf.service_fee, service_fee_rate: engine.service_fee_rate, addons_total: engine.addons_total }), SERVICE_FEE_TEXT] : []),
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

/** Who made a change, for the event_updates row and the GHL payload. */
export interface UpdatedBy {
  kind: "admin";
  name: string; // the admin's first name
  staffId: string;
}
