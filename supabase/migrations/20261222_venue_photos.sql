-- Bar and venue photos on the event Location card.
--
-- 1. venue_photos: one row per photo. It belongs to the event it was added on
--    (session_id) and to the venue (venue_key, the event address normalized
--    for case, spacing and punctuation, see lib/team/venue-photos.ts). Later
--    events whose address gives the same venue_key show it under "From past
--    events at this address". Files live in the private bar-photos bucket
--    (same size limit and photo types as bar setup photos) under venue/...,
--    or reuse a bar setup photo's file when kept from the Day of tab
--    (bar_report_id). Removed photos stay in the bucket and stop showing.
-- 2. venue_photo_hides: an admin or manager hiding a carried over photo for
--    one event, without removing it from the venue.
--
-- Server only (service role), like the other team tables: admins and
-- managers write through /api/team/admin/venue-photos, assigned staff read
-- through their event page. Clients never read either table.
--
-- Until this runs, the Location card loads with no photos and adding one
-- says the migration is needed.

begin;

create table if not exists public.venue_photos (
  id             uuid        primary key default gen_random_uuid(),
  venue_key      text        not null default '',
  session_id     text        references public.sessions (id) on delete set null,
  photo_path     text        not null,
  caption        text        not null default '',
  position       integer     not null default 0,
  source         text        not null default 'upload' check (source in ('upload', 'bar_setup')),
  bar_report_id  uuid        references public.bar_ready_reports (id) on delete set null,
  added_by       uuid        references public.staff (id) on delete set null,
  created_at     timestamptz not null default now(),
  removed_at     timestamptz,
  constraint venue_photos_caption_len check (char_length(caption) <= 120)
);
create index if not exists venue_photos_session_idx on public.venue_photos (session_id, position);
create index if not exists venue_photos_venue_idx on public.venue_photos (venue_key, created_at desc) where removed_at is null;
-- A bar setup photo is kept once per event.
create unique index if not exists venue_photos_bar_report_uniq on public.venue_photos (session_id, bar_report_id) where bar_report_id is not null and removed_at is null;

create table if not exists public.venue_photo_hides (
  id          uuid        primary key default gen_random_uuid(),
  session_id  text        not null references public.sessions (id) on delete cascade,
  photo_id    uuid        not null references public.venue_photos (id) on delete cascade,
  hidden_by   uuid        references public.staff (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (session_id, photo_id)
);

alter table public.venue_photos      enable row level security;
alter table public.venue_photo_hides enable row level security;

commit;
