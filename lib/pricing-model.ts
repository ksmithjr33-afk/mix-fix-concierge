// Which pricing model an event is on. Pure, no database.
//
// - gratuity: every booking made on or before 2026-11-23, including everything
//   on the calendar when the site switched. Its total, wording and staff pay
//   never change (lib/pricing.ts).
// - service_fee: bookings after the switch (lib/service-fee.ts).
//
// Stored on sessions.pricing_model. A booking webhook sets it from
// pricing_model; when that is missing, standard_price or addons_total (only the
// service fee quote tool sends them) mean the service fee model. With none of
// the three, the booking is on the gratuity model and flagged "Price needs a
// check", and the admins are told. An event added by hand gets what the admin
// picks, defaulting by its booked on date.

export type PricingModel = "gratuity" | "service_fee";

/** The last day booked on the gratuity model. */
export const LAST_GRATUITY_DAY = "2026-11-23";

export const PRICING_MODEL_LABEL: Record<PricingModel, string> = {
  gratuity: "Gratuity model",
  service_fee: "Service fee model",
};

export const NO_MODEL_CHECK =
  "The booking did not say which pricing model it is on (no pricing_model, standard_price or addons_total). Saved on the gratuity model; confirm the model and the price.";

/** "service fee model", "Service Fee", "gratuity model" → the model. Null when it says neither. */
export function parsePricingModel(v: unknown): PricingModel | null {
  const s = String(v ?? "").toLowerCase().replace(/[^a-z]+/g, " ").trim();
  if (!s) return null;
  if (/\bservice ?fee\b/.test(s) || s === "service_fee") return "service_fee";
  if (/\bgratuity\b/.test(s)) return "gratuity";
  return null;
}

/** The model a booking webhook puts the session on, and why it needs a check when it does. */
export function bookingPricingModel(b: { pricingModel: unknown; hasStandardPrice: boolean; hasAddonsTotal: boolean }): { model: PricingModel; check: string | null } {
  const said = parsePricingModel(b.pricingModel);
  if (said) return { model: said, check: null };
  if (b.hasStandardPrice || b.hasAddonsTotal) return { model: "service_fee", check: null };
  return { model: "gratuity", check: NO_MODEL_CHECK };
}

/** The default for an event added by hand, from the day it was booked (YYYY-MM-DD). */
export function defaultModelForBookedOn(ymd: string): PricingModel {
  return ymd <= LAST_GRATUITY_DAY ? "gratuity" : "service_fee";
}

/** The model stored on a session. Missing (a row from before the column) is the gratuity model. */
export function sessionPricingModel(session: { pricing_model?: unknown } | null | undefined): PricingModel {
  return session?.pricing_model === "service_fee" ? "service_fee" : "gratuity";
}
