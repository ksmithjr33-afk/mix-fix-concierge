-- The approved menu, full staff profiles, and images and GIFs in chat and
-- announcements.
--
-- 1. event_menu_files: the final menu graphic per event, uploaded by an admin
--    after the client approves it. One current file per event; replaced ones
--    are kept as a short history. Files live in the private event-menus bucket
--    (PDF, PNG, JPG, 15 MB) and are only opened through short signed links.
-- 2. staff_profiles: email, home address (and its map location), preferred
--    drop off time, and the farthest someone will drive. Kept apart from the
--    staff table so address and email never ride along with staff lists.
-- 3. staff_certifications: Food Handler joins TABC and California RBS.
-- 4. team_attachments: one image or GIF per chat message or announcement, in
--    the private team-media bucket (GIF, PNG, JPG, WEBP, 8 MB).
-- Server only (service role), like the other team tables. Safe to run twice.

begin;

-- ----- 1. Approved menu -----
create table if not exists public.event_menu_files (
  id                 uuid        primary key default gen_random_uuid(),
  session_id         text        not null references public.sessions (id) on delete cascade,
  file_path          text        not null check (length(file_path) > 0),
  file_type          text        not null check (file_type in ('application/pdf', 'image/png', 'image/jpeg')),
  file_name          text        check (file_name is null or length(file_name) <= 200),
  size_bytes         integer     check (size_bytes is null or size_bytes between 1 and 15728640),
  status             text        not null default 'pending' check (status in ('pending', 'current', 'replaced')),
  client_approved_on date,
  uploaded_by        uuid        references public.staff (id) on delete set null,
  uploaded_by_name   text,
  replaced_at        timestamptz,
  created_at         timestamptz not null default now()
);
create index if not exists event_menu_files_session on public.event_menu_files (session_id, created_at desc);
create unique index if not exists event_menu_files_one_current on public.event_menu_files (session_id) where status = 'current';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-menus', 'event-menus', false, 15728640, array['application/pdf', 'image/png', 'image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ----- 2. Staff profiles -----
create table if not exists public.staff_profiles (
  staff_id         uuid             primary key references public.staff (id) on delete cascade,
  email            text             check (email is null or length(email) <= 200),
  home_address     text             check (home_address is null or length(home_address) <= 300),
  home_lat         double precision,
  home_lng         double precision,
  home_geocoded_at timestamptz,
  dropoff_time     text             check (dropoff_time is null or length(dropoff_time) <= 100),
  max_miles        integer          check (max_miles is null or max_miles between 1 and 500),
  prompted_at      timestamptz,     -- asked once after sign in to fill in what is missing
  updated_by       uuid             references public.staff (id) on delete set null,
  updated_at       timestamptz      not null default now()
);

-- ----- 3. Food Handler certificates -----
alter table public.staff_certifications drop constraint if exists staff_certifications_cert_type_check;
alter table public.staff_certifications add constraint staff_certifications_cert_type_check
  check (cert_type in ('TABC', 'California RBS', 'Food Handler'));

-- ----- 4. Images and GIFs in chat and announcements -----
create table if not exists public.team_attachments (
  id              uuid        primary key default gen_random_uuid(),
  scope           text        not null check (scope in ('chat', 'announcement')),
  session_id      text        references public.sessions (id) on delete cascade,
  announcement_id uuid        references public.announcements (id) on delete cascade,
  message_id      uuid        references public.event_messages (id) on delete cascade,
  file_path       text        not null check (length(file_path) > 0),
  file_type       text        not null check (file_type in ('image/gif', 'image/png', 'image/jpeg', 'image/webp')),
  size_bytes      integer     check (size_bytes is null or size_bytes between 1 and 8388608),
  kind            text        not null check (kind in ('gif', 'photo')),
  source          text        not null default 'upload' check (source in ('upload', 'giphy')),
  status          text        not null default 'pending' check (status in ('pending', 'attached', 'removed')),
  uploaded_by     uuid        references public.staff (id) on delete set null,
  removed_by      uuid        references public.staff (id) on delete set null,
  removed_at      timestamptz,
  created_at      timestamptz not null default now(),
  constraint team_attachments_chat_has_session check (scope <> 'chat' or session_id is not null)
);
create index if not exists team_attachments_message on public.team_attachments (message_id) where message_id is not null;
create index if not exists team_attachments_announcement on public.team_attachments (announcement_id) where announcement_id is not null;

alter table public.event_messages add column if not exists attachment_id uuid references public.team_attachments (id) on delete set null;
alter table public.event_messages add column if not exists attachment_kind text check (attachment_kind is null or attachment_kind in ('gif', 'photo'));
-- A message can be only a picture now: the text may be empty when there is an attachment.
alter table public.event_messages drop constraint if exists event_messages_body_check;
alter table public.event_messages drop constraint if exists event_messages_body_or_attachment;
alter table public.event_messages add constraint event_messages_body_or_attachment
  check (length(body) <= 2000 and (length(btrim(body)) >= 1 or attachment_id is not null or attachment_kind is not null));

alter table public.announcements add column if not exists attachment_id uuid references public.team_attachments (id) on delete set null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('team-media', 'team-media', false, 8388608, array['image/gif', 'image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

alter table public.event_menu_files enable row level security;
alter table public.staff_profiles enable row level security;
alter table public.team_attachments enable row level security;
revoke all on public.event_menu_files, public.staff_profiles, public.team_attachments from anon, authenticated;

commit;
