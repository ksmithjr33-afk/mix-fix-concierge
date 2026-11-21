-- Booking columns that hold the text "null", "undefined", "none", "n/a", or
-- only spaces: GHL sends an empty field as the text "null", and older code
-- stored it as is (on 2026-11-21: event_date 91 rows, event_name 76,
-- package_type 52, event_type 1, promo_code 1). They become real NULLs so no
-- page shows "null" as a value. New bookings are cleaned before they are saved
-- (lib/blank.ts), and the app also reads these values as missing.
-- Safe to run more than once.

do $$
declare
  col text;
begin
  foreach col in array array[
    'name', 'email', 'phone', 'event_date', 'package_type', 'guest_count', 'event_name',
    'event_type', 'hours_booked', 'bar_service_start', 'promo_code', 'package_summary',
    'event_city', 'event_state', 'ghl_contact_id'
  ]
  loop
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'sessions' and column_name = col) then
      execute format(
        'update public.sessions set %1$I = null where %1$I is not null and btrim(%1$I::text) ~* ''^(null|undefined|none|n/a)?$''',
        col
      );
    end if;
  end loop;
end $$;
