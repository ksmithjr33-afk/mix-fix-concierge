-- What a booking includes beyond its package's standard wording (lib/package-extras.ts).
--
-- cups_included: Full Bar no longer includes custom cups over 100 guests.
-- The two Full Bar events booked over 100 guests before the change keep the
-- cups they were promised. Set once here, by id, never by a date check.
--   02f9e4fb  Anna,  Nov 20 2026, 160 guests
--   37bc6434  Tasha, Apr 22 2027, 130 guests
--
-- barback_by / barback_at: who last removed or added back the Full Bar
-- wedding barback, written by the app. The barback itself is the priced
-- event_data field "barback" ("Included" or "Removed", missing means on), so
-- every Full Bar wedding, existing and new, starts with it on and needs
-- nothing here.
--
-- Safe to run more than once.

alter table public.sessions add column if not exists package_extras jsonb not null default '{}'::jsonb;

update public.sessions
  set package_extras = package_extras || jsonb_build_object('cups_included', true, 'cups_set_by', 'Cutover', 'cups_set_at', '2026-11-19')
  where id in ('02f9e4fb', '37bc6434')
    and not (package_extras ? 'cups_included');
