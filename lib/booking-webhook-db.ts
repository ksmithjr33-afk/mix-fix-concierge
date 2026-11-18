// Database side of the GHL booking webhook (/api/create-session). Server only.
//
// A new booking always creates a new session. The one lookup is the duplicate
// guard: the exact same payload (by hash of every key and value) arriving again
// within 10 minutes returns the session it already made. It never matches on
// the contact, email, or date, so a repeat client's next booking is a new event.

import crypto from "crypto";
import { supabase } from "@/lib/supabase";
import { basisFromEvent, DEFAULT_DEPOSIT, type BookedPrice, type PriceBasis } from "@/lib/price-change";
import { bookedGuestCount } from "@/lib/booked-facts";
import { centsToDollars, hasPriceInfo, validTotal, type Booking } from "@/lib/booking-webhook";

export const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

/** Same payload, same hash: sorted keys, values as text. For the 10 minute duplicate guard. */
export function payloadHash(body: Record<string, unknown>): string {
  const canon = Object.keys(body)
    .sort()
    .map((k) => [k, body[k] === null || body[k] === undefined ? null : typeof body[k] === "object" ? JSON.stringify(body[k]) : String(body[k])]);
  return crypto.createHash("sha256").update(JSON.stringify(canon)).digest("hex");
}

/** The session made from this exact payload in the last 10 minutes, if any. */
export async function recentDuplicate(hash: string, now: Date = new Date()): Promise<string | null> {
  const since = new Date(now.getTime() - DUPLICATE_WINDOW_MS).toISOString();
  const { data, error } = await supabase
    .from("sessions")
    .select("id, created_at")
    .eq("booking_payload_hash", hash)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    // Most likely the 20261215 migration has not run yet: no guard, never a lost booking.
    console.error("[create-session] duplicate check failed, creating the session anyway:", error.message);
    return null;
  }
  const row = (data as { id: string }[] | null)?.[0];
  return row?.id ?? null;
}

/**
 * What the booked total was priced for: guests (a range is its higher end),
 * hours, bartenders, and package. Later changes are priced against this event,
 * not against whatever the concierge or an edit saved since. Null when the
 * package has no engine price or the guests or hours are missing.
 */
export function bookingBasis(b: Booking): PriceBasis | null {
  const guests = bookedGuestCount(b.guestCount);
  return basisFromEvent(
    { package: b.packageType, guest_count: guests, hours_booked: b.hoursBooked, event_type: b.eventType ?? b.eventName, bartenders: b.bartenderCount ?? undefined },
    {},
    { tipJar: b.tipJar ?? true, bartenders: b.bartenderCount }
  );
}

export function bookedPriceFrom(b: Booking, nowIso: string): BookedPrice | null {
  if (!hasPriceInfo(b)) return null;
  const total = validTotal(b) ? centsToDollars(b.totalCents) : null;
  return {
    basis: bookingBasis(b),
    package_price: centsToDollars(b.packagePriceCents),
    gratuity: centsToDollars(b.gratuityCents),
    total,
    bartenders: b.bartenderCount,
    promo_code: b.promoCode,
    custom_price: centsToDollars(b.customPriceCents),
    // total_price is already after the discount. Nothing in pricing or the
    // Business tab subtracts discount_amount; it is a record only.
    discount_amount: centsToDollars(b.discountCents),
    tip_jar: b.tipJar ?? true,
    deposit_paid: centsToDollars(b.depositPaidCents) ?? DEFAULT_DEPOSIT,
    tip_per_bartender: centsToDollars(b.tipPerBartenderCents),
    source: "create-session",
    updated_at: nowIso,
  };
}

/** The columns every database has had since before 20261215. */
function legacyRow(id: string, b: Booking, booked: BookedPrice | null) {
  return {
    id,
    name: b.name,
    email: b.email,
    event_date: b.eventDate,
    package_type: b.packageType,
    guest_count: b.guestCount,
    // Before the event_type column exists, event_name carries the type as it always did.
    event_name: b.eventName ?? b.eventType,
    hours_booked: b.hoursBooked,
    ...(booked ? { booked_price: booked } : {}),
  };
}

function fullRow(id: string, b: Booking, booked: BookedPrice | null, hash: string) {
  return {
    ...legacyRow(id, b, booked),
    event_name: b.eventName,
    ghl_contact_id: b.contactId,
    phone: b.phone,
    event_type: b.eventType,
    bar_service_start: b.startTime,
    bartender_count: b.bartenderCount,
    tip_jar: b.tipJar,
    promo_code: b.promoCode,
    package_summary: b.packageSummary,
    event_city: b.city,
    event_state: b.city ? b.state : null,
    booking_payload_hash: hash,
    ...(validTotal(b) ? { price_pending: false } : {}),
  };
}

const missingColumn = (e: { code?: string; message?: string }) =>
  e.code === "42703" || e.code === "PGRST204" || /column/i.test(e.message ?? "");

/**
 * Insert the new session. If the new columns are not there yet (migration not
 * run), the booking is still saved with the columns that exist, and the log says so.
 */
export async function insertBooking(b: Booking, hash: string, now: Date = new Date()): Promise<{ ok: true; id: string } | { ok: false }> {
  const id = crypto.randomBytes(4).toString("hex"); // 8 hex chars
  const booked = bookedPriceFrom(b, now.toISOString());
  const { error } = await supabase.from("sessions").insert(fullRow(id, b, booked, hash));
  if (!error) return { ok: true, id };
  if (!missingColumn(error)) {
    console.error("[create-session] insert error:", error);
    return { ok: false };
  }
  console.error(`[create-session] new booking columns missing (run supabase/migrations/20261215_booking_webhook_fields.sql). Saved without them: ${error.message}`);
  const retry = await supabase.from("sessions").insert(legacyRow(id, b, booked));
  if (retry.error) {
    console.error("[create-session] insert error:", retry.error);
    return { ok: false };
  }
  return { ok: true, id };
}
