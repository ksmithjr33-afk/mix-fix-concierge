-- Post event closeouts: one per bartender per event, editable for 24 hours,
-- with every save kept. Photos live in the private bar-photos bucket under
-- closeout/. Server only (service role), like the other team tables.

create table if not exists public.event_closeouts (
  id             uuid        primary key default gen_random_uuid(),
  session_id     text        not null references public.sessions (id) on delete cascade,
  staff_id       uuid        not null references public.staff (id) on delete restrict,
  assignment_id  uuid        references public.event_assignments (id) on delete set null,
  rating         text        not null check (rating in ('great', 'fine', 'had_problems')),
  guest_estimate integer     check (guest_estimate is null or (guest_estimate >= 0 and guest_estimate <= 5000)),
  issues         text        not null default '' check (length(issues) <= 1000),
  gear_items     text[]      not null default '{}',
  gear_note      text        not null default '' check (length(gear_note) <= 500),
  leftover_note  text        not null default '' check (length(leftover_note) <= 500),
  photo_path     text        not null check (length(photo_path) > 0),
  submitted_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  edits          integer     not null default 0 check (edits >= 0),
  unique (session_id, staff_id)
);
create index if not exists event_closeouts_session on public.event_closeouts (session_id);

create table if not exists public.event_closeout_versions (
  id          uuid        primary key default gen_random_uuid(),
  closeout_id uuid        not null references public.event_closeouts (id) on delete cascade,
  version     integer     not null check (version >= 1),
  data        jsonb       not null,
  photo_path  text        not null default '',
  edited_by   uuid        references public.staff (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (closeout_id, version)
);

alter table public.event_closeouts enable row level security;
alter table public.event_closeout_versions enable row level security;
revoke all on public.event_closeouts from anon, authenticated;
revoke all on public.event_closeout_versions from anon, authenticated;
