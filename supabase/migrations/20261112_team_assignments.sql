-- Bartender portal, phase 2: assignments, and an alerts setting for admins.
-- Server only (service role), so RLS is on with no policies.

begin;

-- Admin alert texts (declines, missing items, bar ready) only go to admins with alerts on.
alter table public.staff add column if not exists alerts boolean not null default true;

-- One row per staff member per event. id is for the phase 3 time punches.
create table if not exists public.event_assignments (
  id           uuid        primary key default gen_random_uuid(),
  session_id   text        not null references public.sessions (id) on delete cascade,
  staff_id     uuid        not null references public.staff (id) on delete cascade,
  status       text        not null default 'offered' check (status in ('offered', 'accepted', 'declined')),
  assigned_at  timestamptz not null default now(),
  responded_at timestamptz,
  assigned_by  uuid        references public.staff (id) on delete set null,
  unique (session_id, staff_id)
);
create index if not exists event_assignments_staff_idx on public.event_assignments (staff_id);

alter table public.event_assignments enable row level security;

commit;
