// "Price needs a check": an admin confirms the pricing model of a flagged
// booking, which clears the flag. Server only.
//
// Confirming the model the event is already on changes no money. Switching:
//   - to the service fee model: the fee is carved out of the total less add
//     ons (20%, 10% on Premium), the same as the webhook's fallback.
//   - to the gratuity model: the service fee fields are cleared and the total
//     is kept; set a gratuity with Edit price if the booking has one.
// Either way the reason it was flagged stays on booked_price.price_check.

import { showsOnTeam } from "@/lib/planning";
import { supabase } from "@/lib/supabase";
import type { BookedPrice } from "@/lib/price-change";
import type { SessionRow } from "@/lib/event-updates";
import { withPricingModel } from "@/lib/bartender-only";
import { PRICING_MODEL_LABEL, sessionPricingModel, type PricingModel } from "@/lib/pricing-model";
import { FEE_BP_STANDARD, feeBp, serviceFeePackage, splitFromCustom } from "@/lib/service-fee";

type Who = { id: string; name: string };

/** booked_price after the admin confirms `model`. Pure. Null with a reason when it cannot be switched. */
export function confirmedBooked(
  session: Pick<SessionRow, "package_type" | "booked_price" | "pricing_model">,
  model: PricingModel,
  who: Who,
  nowIso: string
): { ok: true; booked: BookedPrice | null } | { ok: false; error: string } {
  const bp = session.booked_price ?? null;
  const stamp = { price_confirmed: { model, by: who.name, at: nowIso } };
  if (model === sessionPricingModel(session)) return { ok: true, booked: bp ? ({ ...bp, ...stamp } as BookedPrice) : null };
  if (!bp || typeof bp.total !== "number" || bp.total <= 0) return { ok: false, error: "This event has no total yet. Set it with Edit price, then confirm the model." };
  if (model === "service_fee") {
    const key = serviceFeePackage(session.package_type);
    const bpRate = key ? feeBp(key) : FEE_BP_STANDARD;
    const addons = Math.round((bp.addons_total ?? 0) * 100);
    const totalCents = Math.round(bp.total * 100);
    const s = splitFromCustom(Math.max(0, totalCents - addons), bpRate, addons);
    return {
      ok: true,
      booked: {
        ...bp,
        ...stamp,
        pricing_model: "service_fee",
        package_price: s.packageCents / 100,
        service_fee: s.feeCents / 100,
        service_fee_rate: bpRate / 10000,
        addons_total: addons / 100,
        gratuity: null,
        split_method: "carved",
      } as BookedPrice,
    };
  }
  return {
    ok: true,
    booked: {
      ...bp,
      ...stamp,
      pricing_model: "gratuity",
      package_price: null,
      service_fee: null,
      service_fee_rate: null,
      split_method: null,
    } as BookedPrice,
  };
}

export async function confirmPriceCheck(
  sessionId: string,
  model: unknown,
  who: Who,
  now: Date = new Date()
): Promise<{ ok: true; model: PricingModel } | { ok: false; status: number; error: string }> {
  if (model !== "gratuity" && model !== "service_fee") return { ok: false, status: 400, error: "Pick a pricing model." };
  const { data, error } = await supabase.from("sessions").select("id, package_type, booked_price, pricing_model, price_check, event_data").eq("id", sessionId).maybeSingle();
  if (error) return { ok: false, status: 500, error: "Could not read the event. Try again." };
  if (!data) return { ok: false, status: 404, error: "Event not found." };
  const session = data as Pick<SessionRow, "id" | "package_type" | "booked_price" | "pricing_model" | "price_check" | "event_data">;
  const next = confirmedBooked(session, model, who, now.toISOString());
  if (!next.ok) return { ok: false, status: 409, error: next.error };
  const { error: upErr } = await supabase
    .from("sessions")
    .update({
      pricing_model: model,
      price_check: null,
      price_check_at: null,
      ...(next.booked ? { booked_price: next.booked } : {}),
      // The shopping lists read the model from event_data (lib/bartender-only.ts).
      ...(session.event_data ? { event_data: withPricingModel(session.event_data, { pricing_model: model }) } : {}),
    })
    .eq("id", sessionId);
  if (upErr) return { ok: false, status: 500, error: "Could not save. Try again." };
  console.log(`[price-check] session ${sessionId}: ${who.name} confirmed the ${PRICING_MODEL_LABEL[model]}${session.price_check ? ` (was flagged: ${session.price_check.reason})` : ""}`);
  return { ok: true, model };
}

export interface PriceCheckAlert {
  sessionId: string;
  name: string;
  reason: string;
  since: string | null;
  submitted: boolean; // false: the client has not finished the concierge, so the event page does not open yet
}

/** Every flagged event, oldest first. Empty before the migration runs. */
export async function priceCheckList(): Promise<PriceCheckAlert[]> {
  const { data, error } = await supabase
    .from("sessions")
    .select("id, name, email, status, event_data, event_date, created_at, price_check, price_check_at")
    .gt("price_check_at", "2000-01-01T00:00:00Z");
  if (error) return [];
  return ((data as (Pick<SessionRow, "id" | "name" | "email" | "status" | "event_data" | "price_check" | "price_check_at">)[]) ?? [])
    .filter((s) => s.price_check)
    .map((s) => ({
      sessionId: s.id,
      name: String(s.event_data?.client_name ?? s.name ?? s.email ?? "Unknown client"),
      reason: s.price_check?.reason ?? "",
      since: s.price_check_at ?? null,
      submitted: s.status === "submitted" || showsOnTeam(s as unknown as { id: string; status: string }),
    }))
    .sort((a, b) => String(a.since).localeCompare(String(b.since)));
}
