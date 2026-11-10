// Price changes. A change to a priced field (service times or hours, guest
// count, bartenders, package) is priced against what the client booked. The bot
// quotes it and gets a yes, then the change applies right away and the booked
// price moves to the new total. Pure, no database.
//
//   delta      = engine(new) minus engine(original), both at standard prices,
//                package part with the session's promo applied (RETURN5 5%,
//                CLASS49 $49 once), plus any gratuity increase
//   gratuity   = recomputed only when guests or bartenders went up, never
//                lower than the booked gratuity
//   new total  = booked total + delta, never below the deposit paid

import { priceEvent, bookedPrice, staffingFor, packageKey, PROMOS } from "@/lib/pricing";
import { calculateHours } from "@/lib/shopping-list";
import {
  applyChanges,
  changeBlocks,
  BOOKING_FIELDS,
  fieldLabel,
  formatValue,
  type EventData,
  type FieldChange,
} from "@/lib/event-diff";

export const DEFAULT_DEPOSIT = 150;

export interface PriceBasis {
  package: string;
  guests: number;
  hours: number;
  isWedding: boolean;
  bartenders: number;
  tipJar: boolean;
  woodenBar: boolean;
}

/** What the client booked, stored on sessions.booked_price. */
export interface BookedPrice {
  package_price: number | null;
  gratuity: number | null;
  total: number | null;
  bartenders: number | null;
  promo_code: string | null;
  custom_price: number | null;
  discount_amount: number | null;
  tip_jar: boolean;
  deposit_paid: number;
  source: "create-session" | "computed" | "change-order" | "update";
  basis?: PriceBasis | null; // the event the total was priced for, set once known
  class49_used?: boolean; // CLASS49 already taken off an earlier price change
  updated_at?: string;
}

/**
 * One update's price change. Saved on the event_updates row (change_order
 * column) and sent in the webhook as pending_change_* so the team can charge or
 * credit the difference.
 */
export interface PriceChange {
  changes: FieldChange[]; // the priced fields the client asked for, old = before this update
  implied?: FieldChange[]; // what follows from them: hours from new times, bartenders for the guest count
  requested_at: string;
  base_version?: number;
  amount: number | null; // positive owes more, negative is a credit, null if not priceable
  new_total: number | null;
  package_price: number | null;
  gratuity: number | null;
  price_text: string;
  summary: string;
  basis: PriceBasis | null;
  class49_applied: boolean;
  booked_total: number | null;
  deposit_paid: number;
}

/** A change order held for signature, from before every update applied right away. Read only by /api/manager-update. */
export type PendingChange = PriceChange;

// ---------- parsing loose values from GHL and the bot ----------

export function toMoney(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function toBool(v: unknown, fallback: boolean): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return fallback;
  if (/^(no|false|0|off|no tip jar|none)$/.test(s)) return false;
  return /^(yes|true|1|on|tip jar|jar)$/.test(s) ? true : fallback;
}

export function toCount(v: unknown): number | null {
  const n = parseFloat(String(v ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function hasTime(v: unknown): boolean {
  return typeof v === "string" && /\d/.test(v);
}

export function money(n: number): string {
  return `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
}

// ---------- basis ----------

interface SessionFields {
  package_type?: string | null;
  guest_count?: string | null;
  hours_booked?: string | null;
}

/**
 * event_data with hours_booked filled in when it is missing, from the session's
 * booked hours or else the service times. Returns the same object if nothing is missing.
 */
export function withHoursBooked(ed: EventData, session: SessionFields): EventData {
  if (toCount(ed.hours_booked)) return ed;
  const hours =
    toCount(session.hours_booked) ??
    (hasTime(ed.bar_service_start) && hasTime(ed.bar_service_end)
      ? calculateHours(ed.bar_service_start as string, ed.bar_service_end as string)
      : null);
  return hours ? { ...ed, hours_booked: hours } : ed;
}

/**
 * The hours_booked change implied by pending time changes that did not set hours
 * themselves, so stored hours cannot drift from the service times. Null if none.
 */
export function impliedHoursChange(stored: EventData, changes: FieldChange[]): FieldChange | null {
  const fields = new Set(changes.map((c) => c.field));
  if (fields.has("hours_booked") || !(fields.has("bar_service_start") || fields.has("bar_service_end"))) return null;
  const next = applyChanges(stored, changes);
  if (!hasTime(next.bar_service_start) || !hasTime(next.bar_service_end)) return null;
  const hours = calculateHours(next.bar_service_start as string, next.bar_service_end as string);
  return toCount(stored.hours_booked) === hours ? null : { field: "hours_booked", old: stored.hours_booked ?? null, new: hours };
}

/**
 * Changes the client did not ask for, up or down: hours from new service times,
 * and bartenders from the guest count. Quoted and saved with what they asked for.
 */
export function impliedChanges(
  p: Pick<PriceChange, "changes" | "basis">,
  stored: EventData,
  bookedBartenders: number | null
): FieldChange[] {
  const out: FieldChange[] = [];
  const hours = impliedHoursChange(stored, p.changes);
  if (hours) out.push({ ...hours, note: "from your new times" });
  const askedBartenders = p.changes.some((c) => c.field === "bartenders");
  if (p.basis && !askedBartenders && bookedBartenders !== null && p.basis.bartenders !== bookedBartenders) {
    out.push({
      field: "bartenders",
      old: bookedBartenders,
      new: p.basis.bartenders,
      note: `${p.basis.bartenders > bookedBartenders ? "needed for" : "for"} ${p.basis.guests} guests`,
    });
  }
  return out;
}

/**
 * Everything a priced update writes to event_data: what the client asked for,
 * the hours their new times imply, and the bartender count it was priced with.
 */
export function withImpliedChanges(
  stored: EventData,
  p: Pick<PriceChange, "changes" | "basis">,
  priorBartenders: number | null
): FieldChange[] {
  const out = [...p.changes];
  const hours = impliedHoursChange(stored, p.changes);
  if (hours) out.push(hours);
  const count = p.basis?.bartenders ?? priorBartenders;
  const asked = p.changes.some((c) => c.field === "bartenders");
  if (!asked && count !== null && toCount(stored.bartenders) !== count) {
    out.push({ field: "bartenders", old: stored.bartenders ?? priorBartenders, new: count });
  }
  return out;
}

/** One implied change as the bot says it: "Bartenders, Was: 1, Now: 2 (needed for 100 guests)". */
export function impliedLine(c: FieldChange): string {
  return `${fieldLabel(c.field)}, Was: ${formatValue(c.old)}, Now: ${formatValue(c.new)}${c.note ? ` (${c.note})` : ""}`;
}

/**
 * The engine inputs for an event. Hours come from the service times, or from
 * hours_booked when preferHoursBooked (the change set hours directly) or when
 * the times are missing.
 */
export function basisFromEvent(
  ed: EventData,
  session: SessionFields,
  opts: { tipJar: boolean; bartenders?: number | null; preferHoursBooked?: boolean }
): PriceBasis | null {
  const pkg = String(ed.package ?? session.package_type ?? "");
  const guests = toCount(ed.guest_count) ?? toCount(session.guest_count);
  const booked = toCount(ed.hours_booked) ?? toCount(session.hours_booked);
  const fromTimes =
    hasTime(ed.bar_service_start) && hasTime(ed.bar_service_end)
      ? calculateHours(ed.bar_service_start as string, ed.bar_service_end as string)
      : null;
  const hours = opts.preferHoursBooked ? booked ?? fromTimes : fromTimes ?? booked;
  if (!packageKey(pkg) || !guests || !hours) return null;
  const bartenders = toCount(ed.bartenders) ?? opts.bartenders ?? staffingFor(guests);
  return {
    package: pkg,
    guests,
    hours,
    isWedding: String(ed.event_type ?? "").toLowerCase().includes("wedding"),
    bartenders,
    tipJar: opts.tipJar,
    woodenBar: ed.premium_wooden_bar === undefined ? true : toBool(ed.premium_wooden_bar, true),
  };
}

/**
 * Booked price for a submitted session that never got one from create-session:
 * the engine price of the original event with the quote tool's promo rules.
 */
export function computeBaseline(
  original: EventData,
  session: SessionFields,
  opts: { promoCode?: string | null; tipJar?: boolean } = {}
): BookedPrice | null {
  const tipJar = opts.tipJar ?? true;
  const basis = basisFromEvent(original, session, { tipJar });
  if (!basis) return null;
  const p = bookedPrice(basis, opts.promoCode);
  if (!p) return null;
  return {
    package_price: p.packagePrice,
    gratuity: p.gratuity,
    total: p.total,
    bartenders: p.bartenders,
    promo_code: opts.promoCode ?? null,
    custom_price: null,
    discount_amount: p.discount,
    tip_jar: tipJar,
    deposit_paid: DEFAULT_DEPOSIT,
    source: "computed",
    basis: { ...basis, bartenders: p.bartenders },
  };
}

// ---------- pricing a change ----------

export function priceText(amount: number | null, newTotal: number | null): string {
  if (amount === null || newTotal === null) return "We could not price this change automatically. Our team will confirm the price with you.";
  if (amount > 0) return `The difference is ${money(amount)}, which brings your new total to ${money(newTotal)}.`;
  if (amount < 0) return `That is a ${money(amount)} credit, which brings your new total to ${money(newTotal)}.`;
  return `No change in price. Your total stays ${money(newTotal)}.`;
}

/**
 * Price a change to the priced fields. original is what the booked total was
 * priced for, stored is the event before the change, nextEvent is the event with
 * the change applied, changes are the priced fields the client asked for.
 */
export function buildPriceChange(args: {
  booked: BookedPrice;
  original: PriceBasis | null;
  stored: EventData;
  nextEvent: EventData;
  session: SessionFields;
  changes: FieldChange[];
  baseVersion?: number;
  now?: Date;
}): PriceChange {
  const { booked, original, nextEvent, session, changes } = args;
  const fields = new Set(changes.map((c) => c.field));
  const deposit = booked.deposit_paid ?? DEFAULT_DEPOSIT;

  let amount: number | null = null;
  let newTotal: number | null = null;
  let newGratuity: number | null = null;
  let newPackage: number | null = null;
  let next: PriceBasis | null = null;
  let class49 = false;

  if (original && booked.total !== null) {
    const nextGuests = toCount(nextEvent.guest_count) ?? original.guests;
    // Bartenders: what the client asked for, else the booked count, raised to the
    // recommended staffing when the guest count goes up.
    const bartenders =
      (fields.has("bartenders") ? toCount(nextEvent.bartenders) : null) ??
      (nextGuests > original.guests ? Math.max(original.bartenders, staffingFor(nextGuests)) : original.bartenders);
    next = basisFromEvent({ ...nextEvent, bartenders }, session, {
      tipJar: booked.tip_jar,
      bartenders,
      preferHoursBooked: fields.has("hours_booked") && !fields.has("bar_service_start") && !fields.has("bar_service_end"),
    });
    if (next) next.woodenBar = original.woodenBar;

    const before = priceEvent(original);
    const after = next ? priceEvent(next) : null;
    if (before && after) {
      let pkgDelta = after.packagePrice - before.packagePrice;
      const code = String(booked.promo_code ?? "").trim().toUpperCase();
      if (code === "RETURN5") pkgDelta = pkgDelta * (1 - (PROMOS.RETURN5.pct ?? 0) / 100);
      if (code === "CLASS49" && !booked.class49_used && pkgDelta > 0) {
        pkgDelta -= Math.min(PROMOS.CLASS49.amount ?? 0, pkgDelta);
        class49 = true;
      }

      const bookedGrat = booked.gratuity ?? before.gratuity;
      const increased = next!.guests > original.guests || next!.bartenders > original.bartenders;
      newGratuity = increased ? Math.max(bookedGrat, after.gratuity) : bookedGrat;

      amount = Math.round(pkgDelta + (newGratuity - bookedGrat));
      newTotal = Math.max(deposit, booked.total + amount);
      amount = newTotal - booked.total;
      newPackage = newTotal - newGratuity;
    }
  }

  const implied = impliedChanges(
    { changes, basis: next },
    args.stored,
    toCount(args.stored.bartenders) ?? booked.bartenders ?? original?.bartenders ?? null
  );

  return {
    changes,
    implied,
    requested_at: (args.now ?? new Date()).toISOString(),
    base_version: args.baseVersion,
    amount,
    new_total: newTotal,
    package_price: newPackage,
    gratuity: newGratuity,
    price_text: priceText(amount, newTotal),
    summary: changeBlocks([...changes, ...implied]).join("\n\n"),
    basis: next,
    class49_applied: class49,
    booked_total: booked.total,
    deposit_paid: deposit,
  };
}

/** The booked price after a priced change applies. */
export function bookedAfter(prior: BookedPrice, p: PriceChange, bartenders: number | null, nowIso: string): BookedPrice {
  return {
    ...prior,
    package_price: p.package_price ?? prior.package_price,
    gratuity: p.gratuity ?? prior.gratuity,
    total: p.new_total ?? prior.total,
    bartenders: bartenders ?? prior.bartenders,
    source: "update",
    // The next change is priced against the event as it is now.
    basis: p.basis ?? prior.basis ?? null,
    class49_used: Boolean(prior.class49_used || p.class49_applied),
    updated_at: nowIso,
  };
}

const PENDING_VALUE_KEYS: Record<(typeof BOOKING_FIELDS)[number], string> = {
  event_date: "pending_change_date",
  bar_service_start: "pending_change_start",
  bar_service_end: "pending_change_end",
  hours_booked: "pending_change_hours",
  guest_count: "pending_change_guest_count",
  bartenders: "pending_change_bartenders",
  package: "pending_change_package",
  event_address: "pending_change_address",
};

type PayloadSession = SessionFields & {
  event_data?: EventData | null;
  event_date?: string | null;
  booked_price?: BookedPrice | null;
};

/**
 * The booking fields as they are after this update, one key each, plus
 * pending_change_fields naming the ones this update changed.
 */
function bookingValues(changes: FieldChange[], session: PayloadSession): Record<string, string> {
  const stored = withHoursBooked(session.event_data ?? {}, session);
  const current: Record<string, unknown> = {
    ...stored,
    event_date: stored.event_date ?? session.event_date,
    guest_count: stored.guest_count ?? session.guest_count,
    package: stored.package ?? session.package_type,
    bartenders: stored.bartenders ?? session.booked_price?.bartenders ?? null,
  };
  const touched = new Set(changes.map((c) => c.field));
  const out: Record<string, string> = {};
  const changed: string[] = [];
  for (const field of BOOKING_FIELDS) {
    if (touched.has(field)) changed.push(field);
    out[PENDING_VALUE_KEYS[field]] = String(current[field] ?? "");
  }
  out.pending_change_fields = changed.join(", ");
  return out;
}

/**
 * Every pending_change_* key for the GHL payload. The values are the event after
 * this update, the money keys come from the update's price change (empty when it
 * changed nothing priced) so the team can charge or credit the difference.
 */
export function pendingChangeFields(
  p: PriceChange | null | undefined,
  changes: FieldChange[],
  session: PayloadSession
): Record<string, unknown> {
  const booking = changes.filter((c) => (BOOKING_FIELDS as readonly string[]).includes(c.field));
  return {
    ...bookingValues(booking, session),
    pending_change_amount: p?.amount ?? null,
    pending_change_price_text: p?.price_text ?? "",
    pending_change_summary: booking.length > 0 ? changeBlocks(booking).join("\n\n") : "",
    pending_change_new_total: p?.new_total ?? null,
    pending_change_package_price: p?.package_price ?? null,
    pending_change_gratuity: p?.gratuity ?? null,
    pending_change_booked_total: p?.booked_total ?? null,
    pending_change_requested_at: p?.requested_at ?? null,
  };
}

/** The phrase the bot reads back for a payment_preference value. */
export function paymentPhrase(pref: unknown): string | null {
  const raw = String(pref ?? "").trim();
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (s === "auto charge now") return "auto charge now";
  // "Auto charge" alone is the older stored value, which meant the due date.
  if (s === "auto charge" || s === "auto charge on due date") return "auto charge on the due date";
  if (s.startsWith("auto charge on ")) return `auto charge on ${raw.slice("auto charge on ".length)}`;
  if (s.startsWith("payment link")) return "payment link";
  if (s.startsWith("payment plan:")) return `your payment plan (${raw.slice("payment plan:".length).trim()})`;
  if (s.startsWith("payment plan")) return "your payment plan";
  return raw;
}
