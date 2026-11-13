// An event an admin adds by hand, for clients who booked before the concierge
// existed or never completed it: the form fields, how they are checked, and how
// they become the same event_data the concierge submits. Pure, no database.

import { formDateToEvent, formTimeToEvent } from "@/lib/team/admin-edit";
import { applyDiveSetMenu } from "@/lib/dive-menu";
import { toMoney } from "@/lib/price-change";
import { allowsMocktails, drinkLimits, drinksFor, menuPool } from "@/lib/menu-catalog";

/** The packages new clients book, in the concierge's order. */
export const MANUAL_PACKAGES = ["Beer and Wine", "Dive Bar", "Essentials Bar", "The Big Day Bar", "Full Bar", "Premium Bar"] as const;

export type SaveMode = "confirmed" | "link";

export interface ManualDrinkInput {
  key?: string; // a menu drink: "craft:French Martini" or "classic:Old Fashioned"
  name?: string; // a custom drink
  ingredients?: string; // a custom drink's recipe, one ingredient per line or comma separated
  is_mocktail?: boolean;
}

export interface Booking {
  name: string;
  email: string;
  event_date: string; // "December 12, 2026"
  package_type: string;
  guest_count: string;
  event_name: string;
  hours_booked: string | null;
}

export interface CleanManual {
  mode: SaveMode;
  day: string; // YYYY-MM-DD
  email: string; // lower case
  booking: Booking;
  eventData: Record<string, unknown>; // what the concierge would have submitted
  priceFields: Record<string, unknown>; // for the booked price, like /api/create-session
  sendList: boolean; // "Send the client their list"
}

export type ManualResult = { ok: true; value: CleanManual } | { ok: false; error: string };

const str = (v: unknown) => (typeof v === "string" ? v.trim() : v === null || v === undefined ? "" : String(v).trim());

function minutes(hhmm: string): number | null {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h <= 23 && min <= 59 ? h * 60 + min : null;
}

function whole(v: unknown, min: number, max: number): number | null {
  const s = str(v);
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= max ? n : null;
}

/** Ten digits (an optional leading 1), as +1XXXXXXXXXX. */
export function cleanPhone(v: unknown): string | null {
  const d = str(v).replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length === 10 ? `+1${ten}` : null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A custom drink's recipe: one ingredient per line, or comma separated. */
function ingredientList(v: unknown): string[] {
  return str(v).split(/\n|,(?![^(]*\))/).map((p) => p.trim()).filter(Boolean);
}

/** The drinks, checked against the package rules the concierge follows. */
export function cleanDrinks(raw: unknown, pkg: string): { ok: true; drinks: Record<string, unknown>[] } | { ok: false; error: string } {
  const list = (Array.isArray(raw) ? raw : []) as ManualDrinkInput[];
  const picked = list.filter((d) => d && (str(d.key) || str(d.name) || str(d.ingredients)));
  const pool = menuPool(pkg);
  if (pool === "set") return { ok: true, drinks: [] }; // Dive Bar gets its set menu
  if (pool === "none") {
    return picked.length ? { ok: false, error: "Beer and Wine has no signature drinks." } : { ok: true, drinks: [] };
  }
  const { max } = drinkLimits(pkg);
  if (picked.length > max) return { ok: false, error: `${pkg} can have at most ${max} signature drinks (the package count and up to 3 more).` };
  const menu = new Map(drinksFor(pkg).map((d) => [d.key, d]));
  const out: Record<string, unknown>[] = [];
  for (const d of picked) {
    const key = str(d.key);
    if (key) {
      const m = menu.get(key);
      if (!m) return { ok: false, error: `${key.replace(/^\w+:/, "")} is not on the ${pkg} menu.` };
      out.push({ name: m.name, base_spirit: m.base_spirit, ingredients: m.ingredients, garnish: m.garnish, description: m.description, is_mocktail: false, is_custom: false });
      continue;
    }
    const name = str(d.name);
    const ingredients = ingredientList(d.ingredients);
    if (!name) return { ok: false, error: "Give each custom drink a name." };
    if (ingredients.length === 0) return { ok: false, error: `Add the ingredients for ${name}.` };
    if (d.is_mocktail && !allowsMocktails(pkg)) return { ok: false, error: `Mocktails are only on Full Bar and Premium Bar, not ${pkg}.` };
    const base = d.is_mocktail ? "" : (ingredients[0] ?? "").replace(/^[\d.]+\s*oz\s*/i, "").toLowerCase();
    out.push({ name, base_spirit: base, ingredients, garnish: "", is_mocktail: d.is_mocktail === true, is_custom: true });
  }
  return { ok: true, drinks: out };
}

/** Hours between two times, across midnight. */
function serviceHours(start: number, end: number): number {
  return ((end - start + 1440) % 1440) / 60;
}

/**
 * The form, checked. "confirmed" needs everything the event pages and lists
 * use; "link" needs the booking basics, and the client fills in the rest in
 * the concierge. today is YYYY-MM-DD, for the past date check.
 */
export function cleanManualEvent(raw: unknown, today: string): ManualResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Fill in the form." };
  const f = raw as Record<string, unknown>;
  const mode: SaveMode = f.mode === "link" ? "link" : "confirmed";
  const confirmed = mode === "confirmed";

  const first = str(f.first_name);
  const last = str(f.last_name);
  if (!first || !last) return { ok: false, error: "Enter the client's first and last name." };
  const email = str(f.email).toLowerCase();
  if (!EMAIL.test(email)) return { ok: false, error: "Enter a valid client email." };
  const phone = cleanPhone(f.phone);
  if (!phone) return { ok: false, error: "Enter a valid 10 digit client phone." };
  const eventType = str(f.event_type);
  if (!eventType) return { ok: false, error: "Enter the event name or type." };

  const day = str(f.event_date);
  const date = formDateToEvent(day);
  if (!date) return { ok: false, error: "Enter a valid event date." };
  if (day < today) return { ok: false, error: "The event date is in the past." };

  const pkg = str(f.package);
  if (!(MANUAL_PACKAGES as readonly string[]).includes(pkg)) return { ok: false, error: "Pick a package." };
  if (pkg === "The Big Day Bar" && !/wedding|reception/i.test(eventType)) return { ok: false, error: "The Big Day Bar is for weddings and receptions only." };

  const guests = whole(f.guest_count, 1, 2000);
  if (guests === null) return { ok: false, error: "Enter a guest count between 1 and 2,000." };

  const startRaw = str(f.bar_service_start);
  const endRaw = str(f.bar_service_end);
  const arrivalRaw = str(f.arrival_time);
  const start = startRaw ? minutes(startRaw) : null;
  const end = endRaw ? minutes(endRaw) : null;
  const arrival = arrivalRaw ? minutes(arrivalRaw) : null;
  if ((startRaw && start === null) || (confirmed && start === null)) return { ok: false, error: "Enter a valid bar service start time." };
  if ((endRaw && end === null) || (confirmed && end === null)) return { ok: false, error: "Enter a valid bar service end time." };
  if ((arrivalRaw && arrival === null) || (confirmed && arrival === null)) return { ok: false, error: "Enter a valid arrival time." };
  let hours: number | null = null;
  if (start !== null && end !== null) {
    hours = serviceHours(start, end);
    if (hours < 1 || hours > 12) return { ok: false, error: "Bar service must run between 1 and 12 hours." };
  }
  if (start !== null && arrival !== null) {
    const lead = (start - arrival + 1440) % 1440;
    if (lead === 0 || lead > 6 * 60) return { ok: false, error: "Arrival must be before bar service starts, and no more than 6 hours before." };
  }

  const address = str(f.event_address);
  if (confirmed && address.length < 8) return { ok: false, error: "Enter the full event address." };
  let bartenders: number | null = null;
  if (str(f.bartenders)) {
    bartenders = whole(f.bartenders, 1, 20);
    if (bartenders === null) return { ok: false, error: "Enter a number of bartenders between 1 and 20." };
  } else if (confirmed) {
    return { ok: false, error: "Enter the number of bartenders." };
  }
  const contactName = str(f.day_of_contact_name);
  const contactPhoneRaw = str(f.day_of_contact_phone);
  const contactPhone = contactPhoneRaw ? cleanPhone(contactPhoneRaw) : null;
  if (contactPhoneRaw && !contactPhone) return { ok: false, error: "Enter a valid 10 digit day of contact phone." };

  const drinks = cleanDrinks(f.drinks, pkg);
  if (!drinks.ok) return { ok: false, error: drinks.error };

  for (const k of ["package_price", "gratuity", "total", "deposit_paid", "discount_amount"]) {
    if (str(f[k]) && toMoney(f[k]) === null) return { ok: false, error: "Price fields must be amounts, like 1749 or $1,749." };
  }

  const clientName = `${first} ${last}`;
  const eventName = str(f.event_name);
  const ed: Record<string, unknown> = {
    client_name: clientName,
    email,
    client_phone: phone,
    event_type: eventType,
    event_name: eventName || null,
    event_date: date,
    venue_type: str(f.venue_type) || "",
    bar_service_start: start !== null ? formTimeToEvent(startRaw) : "",
    bar_service_end: end !== null ? formTimeToEvent(endRaw) : "",
    ...(arrival !== null ? { arrival_time: formTimeToEvent(arrivalRaw) } : {}),
    ...(hours !== null ? { hours_booked: hours } : {}),
    event_address: address,
    guest_count: guests,
    package: pkg,
    ...(bartenders !== null ? { bartenders } : {}),
    theme: str(f.theme),
    event_colors: str(f.event_colors),
    day_of_contact_name: contactName,
    day_of_contact_phone: contactPhone ?? "",
    special_requests: str(f.notes),
    signature_drinks: drinks.drinks,
    // Beer and wine on the lists only when the admin ticked them, like the concierge asks.
    ...(f.beer === true ? { beer: true } : {}),
    ...(f.wine === true ? { wine: true } : {}),
    ...(f.client_providing_beer_wine === true ? { client_providing_beer_wine: true } : {}),
    allergies: [],
    change_approval_needed: "No",
  };
  const eventData = applyDiveSetMenu(ed);

  return {
    ok: true,
    value: {
      mode,
      day,
      email,
      booking: {
        name: clientName,
        email,
        event_date: date,
        package_type: pkg,
        guest_count: String(guests),
        event_name: eventName || eventType,
        hours_booked: hours !== null ? String(hours) : null,
      },
      eventData,
      priceFields: {
        package_price: f.package_price,
        gratuity: f.gratuity,
        total: f.total,
        deposit_paid: f.deposit_paid,
        promo_code: f.promo_code,
        discount_amount: f.discount_amount,
        bartenders: bartenders ?? undefined,
      },
      sendList: f.send_list === true,
    },
  };
}
