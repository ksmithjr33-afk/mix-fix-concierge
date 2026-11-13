// The legacy events table row written when a client finishes the concierge
// (and when an admin adds an event by hand). The team portal reads sessions,
// not this table, but the row is kept as a flat copy of each booking.
//
// The insert only sends columns the live table has. On 2026-11-06 the submit
// tool gained payment_preference and change_approval_needed, which this table
// has no columns for, and every insert since was refused. Those two live on the
// session's event_data, so they are dropped here and logged, never sent.
// scripts/test-submit-save.mts checks every submit tool field is either a
// column below or listed in SESSION_ONLY_FIELDS, so a new field fails the test
// until someone decides where it goes.

/** Every column of public.events in the live database (checked 2026-11-13). */
export const EVENTS_COLUMNS = [
  "id", "created_at", "client_name", "email", "event_type", "event_name", "event_date", "venue_type", "event_address",
  "indoor_outdoor", "bar_on_site", "bar_details", "parking_info", "package", "bar_service_start", "bar_service_end",
  "guest_count", "age_range", "drinking_pace", "theme", "event_colors", "allergies", "special_requests",
  "day_of_contact_name", "day_of_contact_phone", "signature_drinks", "mocktail_name", "mocktail_description",
  "mocktail_ingredients", "mocktail_method", "mocktail_garnish", "beer", "wine", "beer_and_wine_details", "extra_bottles",
  "shopping_list", "shopping_list_text", "conversation_transcript", "status", "ghl_webhook_sent", "ghl_webhook_response",
  "menu_style", "menu_notes", "client_providing_beer_wine", "dual_bar_setup", "menu_colors", "menu_reference_photos",
  "bar_floor_access", "dive_menu_requested", "client_phone", "arrival_time",
] as const;

/** Event fields that are kept on the session (event_data) only, with no events column. */
export const SESSION_ONLY_FIELDS = ["payment_preference", "change_approval_needed", "hours_booked"] as const;

const COLUMNS = new Set<string>(EVENTS_COLUMNS);

/** The payload with only events columns, and the keys that were left out. */
export function eventsInsertRow(payload: Record<string, unknown>): { row: Record<string, unknown>; dropped: string[] } {
  const row: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(payload)) {
    if (COLUMNS.has(key) && key !== "id" && key !== "created_at") row[key] = value;
    else dropped.push(key);
  }
  return { row, dropped };
}
