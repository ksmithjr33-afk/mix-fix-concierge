// The new Bartender Only package: a service fee model event with the Bartender
// Only package key. Pure, no database.
//
// The shopping list is the full list for the drinks the client chose, and the
// client buys every line of it: alcohol, mixers, garnishes, ice and cups. We
// bring the bartenders and bar tools only. Nothing else is added.
//
// Older events named "Bartender Only" are on the gratuity model and stay the
// legacy Tailored Bar package: same list, same wording as before, unchanged.
//
// The list builders only read event_data, so the model rides along on it as
// event_data.pricing_model, copied from sessions.pricing_model when the event
// is submitted and whenever an admin changes the model. Clients never edit it.

import { serviceFeePackage } from "@/lib/service-fee";

type ModelRow = { pricing_model?: unknown } | null | undefined;

/** event_data with the session's pricing model on it, for the list builders. */
export function withPricingModel<T extends Record<string, unknown>>(eventData: T, session: ModelRow): T {
  if (!session || (session.pricing_model !== "service_fee" && session.pricing_model !== "gratuity")) return eventData;
  return { ...eventData, pricing_model: session.pricing_model };
}

/** The new Bartender Only: service fee model and the Bartender Only package key. Legacy Bartender Only is false. */
export function isServiceFeeBartenderOnly(eventData: { package?: unknown; pricing_model?: unknown } | null | undefined): boolean {
  if (!eventData || eventData.pricing_model !== "service_fee") return false;
  return serviceFeePackage(eventData.package) === "beerwine" && /bartender\s*only/i.test(String(eventData.package ?? ""));
}

/**
 * A booking on the new Bartender Only, from the session row: the booking is on
 * the service fee model (the session or its booked price says so, like
 * isServiceFeeEvent) and the package is Bartender Only. For the concierge,
 * which reads the session rather than event_data.
 */
export function isServiceFeeBartenderOnlyBooking(pkg: unknown, session: { pricing_model?: unknown; booked_price?: unknown } | null | undefined): boolean {
  if (!session) return false;
  const booked = session.booked_price as { pricing_model?: unknown } | null | undefined;
  const sf = session.pricing_model === "service_fee" || booked?.pricing_model === "service_fee";
  return sf && isServiceFeeBartenderOnly({ package: pkg, pricing_model: "service_fee" });
}

/** What the concierge says, once, when a client on the new Bartender Only asks for a drink that is not a classic. */
export const BO_CLASSICS_LINE =
  "Bartender Only covers our classics, so I can only add drinks from our classics menu. Here it is again. If you would like to change packages, our team can help with that.";

/** What the concierge says, exactly, when a client on the new Bartender Only is serving only beer and wine. */
export const BO_BEER_WINE_LINE = "Got it, just beer and wine, so we will skip the cocktail menu.";

/** What Add event and Edit event say when Bartender Only on the service fee model is picked for a wedding. */
export const BO_NO_WEDDINGS = "Bartender Only is not available for weddings.";

/** A wedding or a reception, by the event type (or name) as typed or sent. */
export const isWeddingType = (eventType: unknown): boolean => /wedding|reception/i.test(String(eventType ?? ""));

/**
 * BO_NO_WEDDINGS when this would be the new Bartender Only at a wedding or a
 * reception, else null. Legacy Bartender Only on the gratuity model is never refused.
 */
export function bartenderOnlyWeddingRefusal(pkg: unknown, pricingModel: unknown, eventType: unknown): string | null {
  return isServiceFeeBartenderOnly({ package: pkg, pricing_model: pricingModel }) && isWeddingType(eventType) ? BO_NO_WEDDINGS : null;
}
