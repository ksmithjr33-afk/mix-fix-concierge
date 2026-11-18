// The Booking summary card's data: what GHL sent when the client booked.
// Admins and managers only (it has discount and gratuity amounts). Pure.

export interface BookingSummary {
  text: string | null;
  bookedStart: string | null;
  bartenders: number | null;
  tipPerBartender: number | null; // dollars
  promoCode: string | null;
}

/** Null when the booking sent none of it. */
export function bookingSummary(session: {
  package_summary?: string | null;
  bar_service_start?: string | null;
  bartender_count?: number | null;
  promo_code?: string | null;
  booked_price?: { tip_per_bartender?: number | null } | null;
}): BookingSummary | null {
  const text = typeof session.package_summary === "string" && session.package_summary.trim() ? session.package_summary : null;
  const s: BookingSummary = {
    text,
    bookedStart: session.bar_service_start?.trim() || null,
    bartenders: session.bartender_count ?? null,
    tipPerBartender: typeof session.booked_price?.tip_per_bartender === "number" ? session.booked_price.tip_per_bartender : null,
    promoCode: session.promo_code?.trim() || null,
  };
  return s.text || s.bookedStart || s.bartenders || s.tipPerBartender !== null || s.promoCode ? s : null;
}
