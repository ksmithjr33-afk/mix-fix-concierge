// The Booking summary card's data: what GHL sent when the client booked, and
// which pricing model the event is on with the service fee split.
// Admins and managers only (it has discount and gratuity amounts). Pure.

import type { BookedPrice } from "@/lib/price-change";
import { PRICING_MODEL_LABEL, sessionPricingModel } from "@/lib/pricing-model";

export interface BookingSummary {
  text: string | null;
  bookedStart: string | null;
  bartenders: number | null;
  tipPerBartender: number | null; // dollars
  promoCode: string | null;
  pricing: string | null; // "Service fee model (20%)" or "Gratuity model"; null on a row from before the model column
  money: [string, string][]; // the service fee split as booked, in order
}

const dollars = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const pct = (rate: number) => `${Math.round(rate * 1000) / 10}%`;

/** The split rows of a service fee booking, skipping what it did not send. */
export function serviceFeeRows(bp: Partial<BookedPrice> | null | undefined): [string, string][] {
  if (!bp) return [];
  const rows: [string, string][] = [];
  const add = (k: string, v: number | null | undefined) => {
    if (typeof v === "number") rows.push([k, dollars(v)]);
  };
  add("Standard price", bp.standard_price);
  if (typeof bp.custom_price === "number") add("Custom price", bp.custom_price);
  if (bp.owner_override) rows.push(["Owner override", "Yes"]);
  add("Discount", typeof bp.discount_amount === "number" && bp.discount_amount > 0 ? bp.discount_amount : null);
  add("Package", bp.package_price);
  add(`Service fee${typeof bp.service_fee_rate === "number" ? ` (${pct(bp.service_fee_rate)})` : ""}`, bp.service_fee);
  add("Add ons", bp.addons_total);
  if (bp.second_bar !== undefined && bp.second_bar !== null) rows.push(["Second bar", bp.second_bar ? "Yes" : "No"]);
  for (const l of bp.addon_lines ?? []) rows.push([`  ${l.label}`, dollars(l.amount)]);
  add("Total", bp.total);
  add("Deposit paid", bp.deposit_paid);
  add("Balance due as booked", bp.balance_due);
  return rows;
}

/** Null when the booking sent none of it. */
export function bookingSummary(session: {
  package_summary?: string | null;
  bar_service_start?: string | null;
  bartender_count?: number | null;
  promo_code?: string | null;
  pricing_model?: string | null;
  booked_price?: Partial<BookedPrice> | null;
}): BookingSummary | null {
  const text = typeof session.package_summary === "string" && session.package_summary.trim() ? session.package_summary : null;
  const model = session.pricing_model ? sessionPricingModel(session) : null;
  const rate = session.booked_price?.service_fee_rate;
  const s: BookingSummary = {
    text,
    bookedStart: session.bar_service_start?.trim() || null,
    bartenders: session.bartender_count ?? null,
    tipPerBartender: typeof session.booked_price?.tip_per_bartender === "number" ? session.booked_price.tip_per_bartender : null,
    promoCode: session.promo_code?.trim() || null,
    pricing: model ? `${PRICING_MODEL_LABEL[model]}${model === "service_fee" && typeof rate === "number" ? ` (${pct(rate)})` : ""}` : null,
    money: model === "service_fee" ? serviceFeeRows(session.booked_price) : [],
  };
  return s.text || s.bookedStart || s.bartenders || s.tipPerBartender !== null || s.promoCode || s.pricing ? s : null;
}
