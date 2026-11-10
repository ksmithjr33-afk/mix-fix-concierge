-- Bartender portal, phase 3: time clock.
--
-- The database guards the rules, not just the app:
-- * one clock in and one clock out per assignment: unique (assignment_id, type)
-- * an offline punch that is retried is saved once: unique client_id
-- * staff_id and session_id always match the assignment: filled by a trigger
-- * nobody edits or approves their own time, admins included: check
--   constraints on time_edits and time_approvals (phase 4 writes to them)
-- * time is never lost: punches, edits and approvals block deleting the
--   assignment they belong to
-- Server only (service role), so RLS is on with no policies.

begin;

-- The event address on a map, geocoded once per address. Never in event_data.
alter table public.sessions add column if not exists geo_lat double precision;
alter table public.sessions add column if not exists geo_lng double precision;
alter table public.sessions add column if not exists geo_address text;
alter table public.sessions add column if not exists geo_source text;
alter table public.sessions add column if not exists geocoded_at timestamptz;

create table if not exists public.time_punches (
  id            uuid             primary key default gen_random_uuid(),
  assignment_id uuid             not null references public.event_assignments (id) on delete restrict,
  staff_id      uuid             not null references public.staff (id) on delete restrict,
  session_id    text             not null references public.sessions (id) on delete restrict,
  type          text             not null check (type in ('in', 'out')),
  punched_at    timestamptz      not null,                -- the time that counts for hours
  received_at   timestamptz      not null default now(),  -- server time it reached us
  client_time   timestamptz,                              -- the phone's tap time
  client_id     uuid             unique,                  -- the phone's id for the punch, for retries
  lat           double precision,
  lng           double precision,
  accuracy      double precision,                         -- meters, from the phone
  distance_m    integer,                                  -- from the event location
  flags         text[]           not null default '{}',
  source        text             not null default 'phone' check (source in ('phone', 'admin')),
  created_by    uuid             not null references public.staff (id) on delete restrict,
  created_at    timestamptz      not null default now(),
  unique (assignment_id, type),
  -- A phone punch is the staff member's own. An admin entry is never their own time.
  constraint time_punches_own_or_admin check (
    (source = 'phone' and created_by = staff_id) or (source = 'admin' and created_by <> staff_id)
  )
);
create index if not exists time_punches_session_idx on public.time_punches (session_id);
create index if not exists time_punches_staff_idx on public.time_punches (staff_id, punched_at);

-- Every admin add or correction, with the reason. Phase 4 writes these.
create table if not exists public.time_edits (
  id             uuid        primary key default gen_random_uuid(),
  punch_id       uuid        references public.time_punches (id) on delete restrict,
  assignment_id  uuid        not null references public.event_assignments (id) on delete restrict,
  staff_id       uuid        not null references public.staff (id) on delete restrict,  -- whose time
  edited_by      uuid        not null references public.staff (id) on delete restrict,
  action         text        not null check (action in ('add', 'correct')),
  type           text        not null check (type in ('in', 'out')),
  old_punched_at timestamptz,
  new_punched_at timestamptz not null,
  reason         text        not null check (length(btrim(reason)) >= 3),
  created_at     timestamptz not null default now(),
  constraint time_edits_not_own check (edited_by <> staff_id)
);
create index if not exists time_edits_assignment_idx on public.time_edits (assignment_id);

-- One approval per assignment (one row per staff member per event). Phase 4 writes these.
create table if not exists public.time_approvals (
  assignment_id uuid        primary key references public.event_assignments (id) on delete restrict,
  staff_id      uuid        not null references public.staff (id) on delete restrict,  -- whose time
  approved_by   uuid        not null references public.staff (id) on delete restrict,
  approved_at   timestamptz not null default now(),
  constraint time_approvals_not_own check (approved_by <> staff_id)
);

-- staff_id (and session_id) always come from the assignment, so the own-time
-- checks above cannot be dodged by sending a different staff_id.
create or replace function public.time_fill_from_assignment() returns trigger
language plpgsql as $$
declare
  a record;
begin
  select staff_id, session_id into a from public.event_assignments where id = new.assignment_id;
  if not found then
    raise exception 'unknown assignment %', new.assignment_id;
  end if;
  new.staff_id := a.staff_id;
  if tg_table_name = 'time_punches' then
    new.session_id := a.session_id;
  end if;
  return new;
end;
$$;

drop trigger if exists time_punches_fill on public.time_punches;
create trigger time_punches_fill before insert or update on public.time_punches
  for each row execute function public.time_fill_from_assignment();
drop trigger if exists time_edits_fill on public.time_edits;
create trigger time_edits_fill before insert or update on public.time_edits
  for each row execute function public.time_fill_from_assignment();
drop trigger if exists time_approvals_fill on public.time_approvals;
create trigger time_approvals_fill before insert or update on public.time_approvals
  for each row execute function public.time_fill_from_assignment();

-- Once only texts from the cron: the clock out reminder and the late setup alert.
create table if not exists public.team_notices (
  key     text        primary key,
  kind    text        not null,
  sent_at timestamptz not null default now()
);

alter table public.time_punches   enable row level security;
alter table public.time_edits     enable row level security;
alter table public.time_approvals enable row level security;
alter table public.team_notices   enable row level security;

commit;
