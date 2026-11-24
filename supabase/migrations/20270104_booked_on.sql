-- The day the client booked, for events added by hand.
--
-- sessions.booked_on   date. Set on the Add event form and in Edit event
--                      ("Booked on"). It sets the default pricing model: on or
--                      before 2026-11-23 is the gratuity model, after that the
--                      service fee model. Admins can pick the other model.
--                      Null on webhook bookings: they were booked the day the
--                      row was created (created_at).
--
-- Safe to run twice. No backfill.

alter table public.sessions add column if not exists booked_on date;
