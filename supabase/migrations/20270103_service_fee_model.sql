-- Two pricing models, decided per event.
--
-- The site moved to the service fee model on 2026-11-23. Every booking made on
-- or before that day stays on the gratuity model, and its total, wording and
-- staff pay never change.
--
-- sessions.pricing_model   'gratuity' or 'service_fee'. Set by the booking
--                          webhook (pricing_model, else standard_price or
--                          addons_total present), or by an admin on an event
--                          added by hand (default by its booked on date).
-- sessions.price_check     null when the price is fine. Otherwise why the
--                          price needs a check: { reason, at }. Shown on the
--                          admin event page as "Price needs a check"; staff
--                          pay on that event is never shown without it.
-- sessions.price_check_at  when it was flagged, for the admin list.
--
-- Backfill, once (only rows with no model yet, so safe to run twice):
--   - sessions created before 2026-11-24 00:00 Central: 'gratuity'.
--   - sessions created since then, before this ran: no way to know what the
--     booking sent, so 'gratuity' and flagged for a check, like a booking that
--     arrives with no model.
--
-- Money stays in sessions.booked_price (dollars). No other column changes.

begin;

alter table public.sessions add column if not exists pricing_model  text;
alter table public.sessions add column if not exists price_check    jsonb;
alter table public.sessions add column if not exists price_check_at timestamptz;

alter table public.sessions drop constraint if exists sessions_pricing_model_check;
alter table public.sessions add constraint sessions_pricing_model_check
  check (pricing_model is null or pricing_model in ('gratuity', 'service_fee'));

update public.sessions
   set pricing_model = 'gratuity'
 where pricing_model is null
   and coalesce(created_at, '2026-11-23 00:00:00 America/Chicago'::timestamptz) < '2026-11-24 00:00:00 America/Chicago'::timestamptz;

update public.sessions
   set pricing_model  = 'gratuity',
       price_check    = jsonb_build_object(
                          'reason', 'Booked after the switch to the service fee model, before the app stored the model. Confirm the model and the price.',
                          'at', now()),
       price_check_at = now()
 where pricing_model is null;

create index if not exists sessions_price_check_idx on public.sessions (price_check_at desc) where price_check is not null;

commit;
