// Change order pricing. A confirmed change to a change order field (date, hours,
// guest count, package, address, bartenders) is priced against what the client
// booked and held on session.pending_change until they sign. Pure, no database.
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
  CHANGE_ORDER_FIELDS,
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
  source: "create-session" | "computed" | "change-order";
  basis?: PriceBasis | null; // the event the total was priced for, set once known
  class49_used?: boolean; // CLASS49 already taken off a change order
  updated_at?: string;
}

export interface PendingChange {
  changes: FieldChange[]; // old = event_data value, new = requested value
  implied?: FieldChange[]; // changes the client did not ask for, shown but not applied from here
  requested_at: string;
  base_version: number;
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
 * and bartenders from the guest count. Shown on the change order next to what they asked for.
 */
export function impliedChanges(
  p: Pick<PendingChange, "changes" | "basis">,
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
 * Everything signing writes to event_data: what the client asked for, the hours
 * their new times imply, and the bartender count the change order was priced with.
 */
export function signedChanges(
  stored: EventData,
  p: Pick<PendingChange, "changes" | "basis">,
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

// ---------- pricing a change order ----------

export function priceText(amount: number | null, newTotal: number | null): string {
  if (amount === null || newTotal === null) return "A manager will confirm the price for this change.";
  if (amount > 0) return `The difference is ${money(amount)}. Your new total is ${money(newTotal)}, and the ${money(amount)} is added to your remaining balance.`;
  if (amount < 0) return `That gives you a ${money(amount)} credit toward your remaining balance. Your new total is ${money(newTotal)}.`;
  return `No change to your price. Your total stays ${money(newTotal)}.`;
}

/**
 * Price the pending change set. original is what the booked total was priced
 * for, nextEvent is the event with every pending change applied.
 */
export function buildPendingChange(args: {
  booked: BookedPrice;
  original: PriceBasis | null;
  stored: EventData; // the event as saved, before the pending changes
  nextEvent: EventData;
  session: SessionFields;
  pending: FieldChange[];
  baseVersion: number;
  now?: Date;
}): PendingChange {
  const { booked, original, nextEvent, session, pending } = args;
  const fields = new Set(pending.map((c) => c.field));
  const deposit = booked.deposit_paid ?? DEFAULT_DEPOSIT;

  let amount: number | null = null;
  let newTotal: number | null = null;
  let newGratuity: number | null = null;
  let newPackage: number | null = null;
  let next: PriceBasis | null = null;
  let class49 = false;

  if (original && booked.total !== null) {
    const nextGuests = toCount(nextEvent.guest_count) ?? original.guests;
    // Bartenders: what the client asked for in this change order, else the booked
    // count, raised to the recommended staffing when the guest count goes up. A
    // count saved by an earlier signing is the booked count, not a request.
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
    { changes: pending, basis: next },
    args.stored,
    toCount(args.stored.bartenders) ?? booked.bartenders ?? original?.bartenders ?? null
  );

  return {
    changes: pending,
    implied,
    requested_at: (args.now ?? new Date()).toISOString(),
    base_version: args.baseVersion,
    amount,
    new_total: newTotal,
    package_price: newPackage,
    gratuity: newGratuity,
    price_text: priceText(amount, newTotal),
    summary: changeBlocks([...pending, ...implied]).join("\n\n"),
    basis: next,
    class49_applied: class49,
    booked_total: booked.total,
    deposit_paid: deposit,
  };
}

const PENDING_VALUE_KEYS: Record<(typeof CHANGE_ORDER_FIELDS)[number], string> = {
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

/** The implied changes saved with a change order, worked out for ones priced before they were saved. */
function pendingImplied(p: PendingChange, session: PayloadSession): FieldChange[] {
  if (p.implied) return p.implied;
  const stored = withHoursBooked(session.event_data ?? {}, session);
  return impliedChanges(p, stored, toCount(stored.bartenders) ?? session.booked_price?.bartenders ?? null);
}

/**
 * The event as it would be once signed: one key per change order field, plus
 * pending_change_fields naming the ones that change. Empty strings with no change order.
 */
function pendingValues(p: PendingChange | null | undefined, session: PayloadSession): Record<string, string> {
  const out: Record<string, string> = { pending_change_fields: "" };
  for (const field of CHANGE_ORDER_FIELDS) out[PENDING_VALUE_KEYS[field]] = "";
  if (!p) return out;

  const stored = withHoursBooked(session.event_data ?? {}, session);
  const bookedBartenders = toCount(stored.bartenders) ?? session.booked_price?.bartenders ?? null;
  const current: Record<string, unknown> = {
    ...stored,
    event_date: stored.event_date ?? session.event_date,
    guest_count: stored.guest_count ?? session.guest_count,
    package: stored.package ?? session.package_type,
    bartenders: stored.bartenders ?? p.basis?.bartenders ?? bookedBartenders,
  };

  // The same list the summary prints, so the summary and these fields cannot disagree.
  const pending = new Map([...p.changes, ...pendingImplied(p, session)].map((c) => [c.field, c.new]));

  const changed: string[] = [];
  for (const field of CHANGE_ORDER_FIELDS) {
    if (pending.has(field)) changed.push(field);
    out[PENDING_VALUE_KEYS[field]] = String((pending.has(field) ? pending.get(field) : current[field]) ?? "");
  }
  out.pending_change_fields = changed.join(", ");
  return out;
}

/** Every pending_change_* key for the GHL payload, present even when nothing is pending. */
export function pendingChangeFields(
  p: PendingChange | null | undefined,
  session: PayloadSession
): Record<string, unknown> {
  return {
    ...pendingValues(p, session),
    pending_change_amount: p?.amount ?? null,
    pending_change_price_text: p?.price_text ?? "",
    // Rebuilt so change orders already pending get the current format.
    pending_change_summary: p ? changeBlocks([...p.changes, ...pendingImplied(p, session)]).join("\n\n") : "",
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
