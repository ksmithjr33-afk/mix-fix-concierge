-- Change requests inside six days, client links, and events added by hand.
--
-- 1. client_list_holds: when the admins were texted about a client change
--    request, and the 8 AM time a request made in quiet hours waits for.
-- 2. sessions: who created the event (an admin adding it by hand, with their
--    name), whether the admin ticked "Send the client their list", and when
--    the client last opened their link.
-- 3. events: the client phone and arrival time an admin types on the Add
--    event form, so the events table row saves like the concierge's.
-- Server only (service role), like the other team tables. Safe to run twice.

begin;

-- ----- 1. Change requests -----
alter table public.client_list_holds add column if not exists admin_text_after timestamptz;
alter table public.client_list_holds add column if not exists admin_texted_at  timestamptz;
create index if not exists client_list_holds_text_idx on public.client_list_holds (status, admin_text_after) where admin_texted_at is null;

-- ----- 2. Sessions -----
alter table public.sessions add column if not exists created_by          text;
alter table public.sessions add column if not exists created_by_name     text;
alter table public.sessions add column if not exists created_by_staff_id uuid references public.staff (id) on delete set null;
alter table public.sessions add column if not exists send_client_list    boolean not null default false;
alter table public.sessions add column if not exists client_opened_at    timestamptz;
alter table public.sessions drop constraint if exists sessions_created_by_check;
alter table public.sessions add constraint sessions_created_by_check check (created_by is null or created_by in ('client', 'admin'));
create index if not exists sessions_email_date_idx on public.sessions (lower(email), event_date);

-- ----- 3. Events table -----
alter table if exists public.events add column if not exists client_phone text;
alter table if exists public.events add column if not exists arrival_time text;

commit;
