// Booking details that are really missing. GHL sends an empty field as the
// text "null" (seen on event_date, event_name, package_type, event_type, and
// promo_code), and older code stored it as is. The text "null", "undefined",
// empty or blank text, and an unrendered merge tag ("{{contact.x}}") all count
// as missing everywhere booking details are read: never shown, never stored,
// never given to the concierge as a value. Pure, no imports, safe in the browser.

const MISSING_TEXT = /^(null|undefined|none|n\/a)$/i;

/** True when a booking value is missing. */
export function isBlank(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "number") return !Number.isFinite(v);
  if (typeof v === "boolean") return false;
  if (typeof v === "object") return true;
  const s = String(v).trim();
  return !s || s.includes("{{") || MISSING_TEXT.test(s);
}

/** The trimmed text, or null when missing. */
export function present(v: unknown): string | null {
  return isBlank(v) ? null : String(v).trim();
}

/** The session columns that come from the booking. */
export const BOOKING_TEXT_COLUMNS = [
  "name",
  "email",
  "phone",
  "event_date",
  "package_type",
  "guest_count",
  "event_name",
  "event_type",
  "hours_booked",
  "bar_service_start",
  "promo_code",
  "package_summary",
  "event_city",
  "event_state",
  "ghl_contact_id",
] as const;

/** A copy of a session row with every missing booking column set to null. Never saved by itself. */
export function withBlankBookingFields<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = { ...row };
  for (const k of BOOKING_TEXT_COLUMNS) if (k in out && out[k] !== null && isBlank(out[k])) out[k] = null;
  return out as T;
}
