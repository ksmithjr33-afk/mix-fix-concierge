// "Booked on" and the pricing model in Edit event, admins only. Server only.
//
// Booked on is a record and the default for the model (on or before
// 2026-11-23: gratuity model; after: service fee model). Changing the model
// changes staff pay and the price breakdown, so the form asks first. The money
// moves the same way as "Price needs a check" (lib/price-check-db.ts): to the
// service fee model the fee is carved out of the total less add ons; to the
// gratuity model the service fee fields are cleared and the total is kept. An
// event with no total yet just changes model. An admin picking the model also
// clears "Price needs a check".

import { supabase } from "@/lib/supabase";
import type { BookedPrice } from "@/lib/price-change";
import type { SessionRow } from "@/lib/event-updates";
import { confirmedBooked } from "@/lib/price-check-db";
import { isServiceFeeBartenderOnly, withPricingModel } from "@/lib/bartender-only";
import { boClassicsNote, guardClassicsOnly } from "@/lib/bartender-only-drinks";
import { withTeamNotes } from "@/lib/team-notes";
import { formDateToEvent } from "@/lib/team/admin-edit";
import { PRICING_MODEL_LABEL, sessionPricingModel, type PricingModel } from "@/lib/pricing-model";

type Who = { id: string; name: string };
type ModelSession = Pick<SessionRow, "package_type" | "booked_price" | "pricing_model">;

/** booked_price after a model change from Edit event. Pure. Null booked_price stays null. */
export function bookedForModel(session: ModelSession, model: PricingModel, who: Who, nowIso: string): BookedPrice | null {
  const bp = session.booked_price ?? null;
  if (!bp) return null;
  const r = confirmedBooked(session, model, who, nowIso);
  if (r.ok) return r.booked;
  // No total yet: nothing to split, only the model and the fee fields move.
  return {
    ...bp,
    pricing_model: model,
    service_fee: null,
    service_fee_rate: null,
    ...(model === "service_fee" ? { gratuity: null } : {}),
    price_confirmed: { model, by: who.name, at: nowIso },
  } as BookedPrice;
}

export type ModelResult = { ok: true; model: PricingModel; bookedOn: string | null; changedModel: boolean } | { ok: false; status: number; error: string };

export async function setBookedOnAndModel(
  sessionId: string,
  input: { booked_on?: unknown; pricing_model?: unknown },
  who: Who,
  today: string,
  now: Date = new Date()
): Promise<ModelResult> {
  const day = typeof input.booked_on === "string" ? input.booked_on.trim() : "";
  if (day && (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !formDateToEvent(day))) return { ok: false, status: 400, error: "Enter a valid booked on date." };
  if (day && day > today) return { ok: false, status: 400, error: "The booked on date cannot be in the future." };
  const model = input.pricing_model;
  if (model !== "gratuity" && model !== "service_fee") return { ok: false, status: 400, error: "Pick a pricing model." };

  const { data, error } = await supabase.from("sessions").select("*").eq("id", sessionId).maybeSingle();
  if (error) return { ok: false, status: 500, error: "Could not read the event. Try again." };
  if (!data) return { ok: false, status: 404, error: "Event not found." };
  const session = data as SessionRow & { booked_on?: string | null };
  const changedModel = sessionPricingModel(session) !== model;
  const ed = (session.event_data ?? {}) as Record<string, unknown>;
  const pkg = ed.package ?? session.package_type;
  const toNewBartenderOnly = changedModel && isServiceFeeBartenderOnly({ package: pkg, pricing_model: model });
  const update: Record<string, unknown> = { pricing_model: model };
  if (day) update.booked_on = day;
  if (changedModel || session.price_check) {
    update.price_check = null;
    update.price_check_at = null;
  }
  if (changedModel) {
    const booked = bookedForModel(session, model, who, now.toISOString());
    if (booked) update.booked_price = booked;
    // The shopping lists read the model from event_data (lib/bartender-only.ts). A record, not a client update.
    if (session.event_data) {
      let next = withPricingModel(session.event_data, { pricing_model: model });
      // Moving a legacy Bartender Only to the service fee model makes it the new
      // Bartender Only, the classics only: drinks that are not classics come off, with a team note.
      if (toNewBartenderOnly && Array.isArray(next.signature_drinks)) {
        const g = guardClassicsOnly(next.signature_drinks as unknown[]);
        if (g.refused.length) next = withTeamNotes({ ...next, signature_drinks: g.drinks }, [boClassicsNote(g.refused)]) as typeof next;
      }
      update.event_data = next;
    }
  }
  const { error: upErr } = await supabase.from("sessions").update(update).eq("id", sessionId);
  if (upErr && /booked_on/.test(upErr.message ?? "")) {
    return { ok: false, status: 500, error: "Run supabase/migrations/20270104_booked_on.sql to save the booked on date." };
  }
  if (upErr) return { ok: false, status: 500, error: "Could not save. Try again." };
  if (changedModel) console.log(`[booking-model] session ${sessionId}: ${who.name} moved it to the ${PRICING_MODEL_LABEL[model]}`);
  return { ok: true, model, bookedOn: day || session.booked_on || null, changedModel };
}
