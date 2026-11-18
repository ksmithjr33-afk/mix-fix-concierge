-- The GHL booking webhook (/api/create-session) sends more fields. They are
-- kept on the session as booked; the concierge fills event_data from them only
-- where the client's own answers left a blank (the chatbot's answer wins).
-- Money stays in booked_price, in dollars (tip_per_bartender is added there).
--
-- Until this runs, /api/create-session still saves every booking with the
-- columns that already exist and logs that these are missing.

begin;

alter table public.sessions add column if not exists ghl_contact_id       text;    -- saved only, never used to match a booking to an event
alter table public.sessions add column if not exists phone                text;    -- +1XXXXXXXXXX when it is a US number
alter table public.sessions add column if not exists event_type           text;    -- "Social Gathering"; event_name is kept only when it differs
alter table public.sessions add column if not exists bar_service_start    text;    -- booked start, like "6:00 PM"
alter table public.sessions add column if not exists bartender_count      integer;
alter table public.sessions add column if not exists tip_jar              boolean;
alter table public.sessions add column if not exists promo_code           text;
alter table public.sessions add column if not exists package_summary      text;    -- raw, line breaks kept; admins and managers only
alter table public.sessions add column if not exists event_city           text;    -- geocode fallback only while there is no event address
alter table public.sessions add column if not exists event_state          text;
alter table public.sessions add column if not exists booking_payload_hash text;    -- the 10 minute duplicate guard

alter table public.sessions drop constraint if exists sessions_bartender_count_check;
alter table public.sessions add constraint sessions_bartender_count_check check (bartender_count is null or bartender_count > 0);

create index if not exists sessions_booking_payload_hash_idx on public.sessions (booking_payload_hash, created_at desc) where booking_payload_hash is not null;

commit;
