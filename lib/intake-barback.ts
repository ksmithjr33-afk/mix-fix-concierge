// The Full Bar wedding barback in the intake concierge. Server only.
//
// The barback is on by default. If the client asks to remove it (or add it
// back), the prompt already holds the engine's price for that (worked out
// here, so no extra tool is needed), the bot states it and gets a clear yes,
// and sends barback in submit_event_data. At submission the event is saved
// as booked and the barback is then applied as an update, exactly like the
// guest count (lib/intake-guests.ts): a priced change with the change order,
// the credit toward the remaining balance, and the GHL update webhook.

import { applyEventUpdate, bookedEventFrom, quoteOnEvent, type ApplyResult, type SessionRow } from "@/lib/event-updates";
import type { EventData } from "@/lib/event-diff";
import { barbackStatus } from "@/lib/package-extras";
import { unpriced } from "@/lib/price-pending";

function asEvent(session: SessionRow): EventData {
  return session.event_data ?? bookedEventFrom(session);
}

/** The engine's price for flipping the barback on this booking. Null when it cannot be removed or cannot be priced. */
export function intakeBarbackQuote(session: SessionRow | null, now?: Date): { amount: number; newTotal: number } | null {
  if (!session) return null;
  const ed = asEvent(session);
  const b = barbackStatus({ ...session, event_data: ed });
  if (!b.removable) return null;
  const { price } = quoteOnEvent(session, ed, { barback: b.on ? "Removed" : "Included" }, now);
  if (!price || unpriced(price) || typeof price.amount !== "number" || typeof price.new_total !== "number") return null;
  return { amount: price.amount, newTotal: price.new_total };
}

/** The barback the client asked for, taken off the final data so it can be applied as an update after the save. */
export function splitBarback(session: SessionRow | null, eventData: EventData): { data: EventData; barback: "Included" | "Removed" | null } {
  const { barback, ...rest } = eventData as EventData & { barback?: unknown };
  const want = String(barback ?? "").trim().toLowerCase();
  if (!session || (want !== "removed" && want !== "included")) return { data: rest as EventData, barback: null };
  const b = barbackStatus({ ...session, event_data: { ...asEvent(session), ...rest } });
  const next = want === "removed" ? "Removed" : "Included";
  if (!b.removable || (next === "Removed") !== b.on) return { data: rest as EventData, barback: null };
  return { data: rest as EventData, barback: next };
}

/** Apply the barback after the final save. Through the normal update path, so it is priced and recorded. */
export async function applyIntakeBarback(sessionId: string, barback: "Included" | "Removed"): Promise<ApplyResult | null> {
  return applyEventUpdate(sessionId, { barback }, { ignoreCutoff: true }).catch((err) => {
    console.error(`[INTAKE BARBACK] session=${sessionId}: update failed:`, err);
    return null;
  });
}
