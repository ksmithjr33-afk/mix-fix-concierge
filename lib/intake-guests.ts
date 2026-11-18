// The booked guest count in the intake concierge. Server only.
//
// The concierge states the booked count and asks once to confirm. When the
// client gives a different number it calls quote_guest_count, priced here
// with the engine update mode uses (quoteOnEvent):
//   same price     the new count is saved and the chat moves on
//   new price      the bot quotes the difference and new total and gets a
//                  clear yes; on a no it keeps the booked count
//   not priceable  the new count is saved, the event is marked price pending,
//                  the admins get one text, and the client hears management
//                  will confirm the price (the existing price pending path)
// More bartenders than booked is said in the quote and in the admin text.
//
// Nothing is saved until the client finishes. At submission the event is
// saved as booked (version 1) and the new count is applied as an update
// (version 2), so the change order, the booked price, the GHL update webhook,
// and price pending all work exactly as they do in update mode.
// If the bot sends a new count with no confirmed quote, the new count is saved
// without a price change and the guest count flag below catches it.

import { supabase } from "@/lib/supabase";
import { bookedGuestCount } from "@/lib/booked-facts";
import { applyEventUpdate, bartenderNote, bookedEventFrom, quoteMatches, quoteOnEvent, saveFinalSubmission, type ApplyResult, type FinalSaveOutcome, type SessionRow } from "@/lib/event-updates";
import type { EventData } from "@/lib/event-diff";
import { impliedLine, money, toCount, type PriceChange } from "@/lib/price-change";
import { PRICE_PENDING_CLIENT_MESSAGE, unpriced } from "@/lib/price-pending";

export type GuestQuoteKind = "same_count" | "no_price_change" | "quote" | "pending";

export interface GuestQuote {
  kind: GuestQuoteKind;
  booked: number;
  guests: number;
  price: PriceChange | null;
  bartenders: string | null; // "Needs 2 bartenders for 100 guests, booked with 1."
}

/** The bartender count the event was booked with. */
function bookedBartenders(session: SessionRow): number | null {
  return session.booked_price?.bartenders ?? session.bartender_count ?? null;
}

function kindOf(price: PriceChange | null): GuestQuoteKind {
  if (!price || price.changes.length === 0) return "no_price_change";
  if (unpriced(price)) return "pending";
  return price.amount === 0 ? "no_price_change" : "quote";
}

/** Price a new guest count against the event as booked. Null when the session has no booked count. */
export function quoteGuestCount(session: SessionRow, guests: number, now?: Date): GuestQuote | null {
  const booked = bookedGuestCount(session.guest_count);
  if (!booked || !(guests > 0)) return null;
  if (guests === booked) return { kind: "same_count", booked, guests, price: null, bartenders: null };
  const { price } = quoteOnEvent(session, bookedEventFrom(session), { guest_count: guests }, now);
  return { kind: kindOf(price), booked, guests, price, bartenders: bartenderNote(guests, bookedBartenders(session)) };
}

/** What quote_guest_count hands back to the bot. */
export function guestQuoteToolResult(q: GuestQuote | null, guests: unknown): string {
  if (!q) return `TOOL RESULT: There is no booked guest count to price from. Say "Got it, planning for ${toCount(guests) ?? "that many"} guests!", send that guest_count, and move on. Do not mention price.`;
  const bartenders = q.price?.implied?.find((c) => c.field === "bartenders");
  switch (q.kind) {
    case "same_count":
      return `TOOL RESULT: ${q.guests} is the booked guest count. Say "Perfect, planning for ${q.guests} guests!", send guest_count ${q.guests}, and move on.`;
    case "no_price_change":
      return `TOOL RESULT: NO PRICE CHANGE. ${q.guests} guests is the same price as the booked ${q.booked}. Say something like "Got it, planning for ${q.guests} guests, and your total stays the same!", send guest_count ${q.guests}, and move on. Do not ask them to confirm a price.`;
    case "pending":
      return `TOOL RESULT: PRICE PENDING. Our pricing engine cannot price ${q.guests} guests for this booking. Send guest_count ${q.guests} and do NOT send guest_count_quoted_total. Say exactly, once: "Got it, planning for ${q.guests} guests. ${PRICE_PENDING_CLIENT_MESSAGE.replace("Your change is saved. ", "")}" Never state, estimate, or confirm any total or difference, then move on to the next question.`;
    case "quote": {
      const p = q.price!;
      const more = bartenders && toCount(bartenders.new)! > toCount(bartenders.old)! ? ` It also needs ${impliedLine(bartenders)}, so say that ${q.guests} guests needs ${bartenders.new} bartenders instead of ${bartenders.old}.` : "";
      return [
        `TOOL RESULT: QUOTE, NOTHING SAVED. Going from ${q.booked} to ${q.guests} guests changes the price.${more} In one yes or no question, state the new guest count${more ? ", the bartenders" : ""}, the difference, and the new total.`,
        `difference: ${p.amount} (${p.amount! < 0 ? "credit of " : ""}${money(p.amount!)})`,
        `new_total: ${p.new_total} (${money(p.new_total!)})`,
        `On a clear yes: send guest_count ${q.guests} and guest_count_quoted_total ${p.new_total}. On a no: keep guest_count ${q.booked} and move on.`,
      ].join("\n");
    }
  }
}

export type GuestOutcome = "unchanged" | "applied" | "pending" | "unconfirmed" | "not_applied";

export interface GuestSubmission {
  saved: FinalSaveOutcome;
  outcome: GuestOutcome;
  guestCount: unknown; // the guest count the event ended up with
  bartenders: unknown;
  apply: ApplyResult | null; // the version 2 update, for the GHL update and the price pending text
}

/**
 * The concierge's final save with the guest count rules above. Without a
 * booked count, or with the booked count kept, it is the plain final save.
 */
export async function submitWithGuestCount(sessionId: string, session: SessionRow | null, eventData: EventData, quotedTotal: unknown, now?: Date): Promise<GuestSubmission> {
  const booked = session ? bookedGuestCount(session.guest_count) : null;
  const guests = toCount(eventData.guest_count);
  const plain = async (data: EventData, outcome: GuestOutcome): Promise<GuestSubmission> => ({
    saved: await saveFinalSubmission(sessionId, data),
    outcome,
    guestCount: data.guest_count,
    bartenders: data.bartenders,
    apply: null,
  });
  if (!session || !booked || !guests || guests === booked) return plain(eventData, "unchanged");

  const asBooked: EventData = { ...eventData, guest_count: booked };
  const { price } = quoteOnEvent(session, asBooked, { guest_count: guests }, now);
  const kind = kindOf(price);
  // A new price the client never said yes to: the bot's number is saved as is, with no price change, and flagged.
  if (kind === "quote" && !quoteMatches(price!, quotedTotal)) return plain(eventData, "unconfirmed");

  const saved = await saveFinalSubmission(sessionId, asBooked);
  if (saved !== "saved") return { saved, outcome: "not_applied", guestCount: booked, bartenders: eventData.bartenders, apply: null };
  const apply = await applyEventUpdate(
    sessionId,
    { guest_count: guests },
    kind === "pending" ? { ignoreCutoff: true } : { ignoreCutoff: true, requireQuote: true, quotedNewTotal: kind === "quote" ? quotedTotal : price?.new_total ?? undefined }
  ).catch((err) => {
    console.error(`[INTAKE GUEST COUNT] session=${sessionId}: update failed:`, err);
    return null;
  });
  if (apply && apply.rows.some((r) => r.applied)) {
    return { saved, outcome: apply.pricePending?.fresh ? "pending" : "applied", guestCount: apply.eventData.guest_count, bartenders: apply.eventData.bartenders, apply };
  }
  // Could not apply it as an update: keep the client's number on the event so the guest count flag shows it.
  console.error(`[INTAKE GUEST COUNT] session=${sessionId}: ${guests} guests (booked ${booked}) could not be applied as an update. Saved without a price change; flagged for admins.`);
  const { data } = await supabase.from("sessions").select("event_data").eq("id", sessionId).maybeSingle();
  const ed = ((data as { event_data: EventData | null } | null)?.event_data ?? asBooked) as EventData;
  await supabase.from("sessions").update({ event_data: { ...ed, guest_count: guests } }).eq("id", sessionId);
  return { saved, outcome: "not_applied", guestCount: guests, bartenders: eventData.bartenders, apply };
}

// ---------- The safety net ----------

export interface GuestCountFlag {
  booked: number;
  current: number;
  text: string;
}

/**
 * A submitted event whose guest count differs from the booked one with no
 * price change applied (an applied change moves sessions.guest_count with it)
 * and none pending: the total may still be for the booked count.
 */
export function guestCountFlag(session: Pick<SessionRow, "status" | "event_data" | "guest_count" | "price_pending">): GuestCountFlag | null {
  if (session.status !== "submitted" || !session.event_data) return null;
  const booked = bookedGuestCount(session.guest_count);
  const current = bookedGuestCount(session.event_data.guest_count);
  if (!booked || !current || booked === current || session.price_pending) return null;
  return {
    booked,
    current,
    text: `Booked for ${booked} guests, but the event now has ${current}. No price change was applied or is pending, so the total may still be for ${booked} guests. Check the price and staffing.`,
  };
}
