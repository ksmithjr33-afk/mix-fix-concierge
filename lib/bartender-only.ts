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
