-- Bartender portal, phase 1 changes: "I have everything" confirmations,
-- "Something is missing" records, and "Bar is ready" check ins with photos in
-- a private storage bucket. Server only (service role), so RLS is on with no policies.

begin;

create table if not exists public.staff_confirmations (
  staff_id     uuid        not null references public.staff (id) on delete cascade,
  session_id   text        not null references public.sessions (id) on delete cascade,
  confirmed_at timestamptz not null default now(),
  primary key (staff_id, session_id)
);

create table if not exists public.missing_reports (
  id         uuid        primary key default gen_random_uuid(),
  session_id text        not null references public.sessions (id) on delete cascade,
  staff_id   uuid        not null references public.staff (id) on delete cascade,
  items      jsonb       not null default '[]'::jsonb,
  note       text        not null default '',
  created_at timestamptz not null default now()
);
create index if not exists missing_reports_session_idx on public.missing_reports (session_id);

create table if not exists public.bar_ready_reports (
  id                uuid        primary key default gen_random_uuid(),
  session_id        text        not null references public.sessions (id) on delete cascade,
  staff_id          uuid        not null references public.staff (id) on delete cascade,
  photo_path        text        not null,
  note              text        not null default '',
  checklist_checked integer     not null default 0,
  checklist_total   integer     not null default 0,
  shopping_checked  integer     not null default 0,
  shopping_total    integer     not null default 0,
  missing_reported  boolean     not null default false,
  created_at        timestamptz not null default now()
);
create index if not exists bar_ready_reports_session_idx on public.bar_ready_reports (session_id, created_at desc);

alter table public.staff_confirmations enable row level security;
alter table public.missing_reports     enable row level security;
alter table public.bar_ready_reports   enable row level security;

-- Private bucket for bar photos, 10 MB per file, photos only.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bar-photos', 'bar-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do update set public = false;

commit;
