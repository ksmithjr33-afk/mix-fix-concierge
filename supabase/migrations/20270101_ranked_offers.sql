-- Ranked shift offers.
--
--   staff.off_weekdays    weekdays someone never works (0 Sunday .. 6 Saturday),
--                         on top of the dates in staff_unavailability
--   staff.in_offers       "Include in bartender offers" for an admin or manager
--                         who also bartends (bartenders are always included)
--   staff_rank            the offer order: tier (Top, Core, Developing) and a
--                         position inside the tier, solo guest number,
--                         weddings yes or no, a short note. Admins only, never
--                         about themselves (checked on the server and below).
--   staff_rank_history    every change: before, after, who and when
--   offer_runs            one run of offers for an event
--   offer_steps           one row per person in a run: when they are due,
--                         when they were texted, and what happened
--   offer_claims          one row per spot taken in a run; the primary key is
--                         what makes "first to accept gets the spot" safe
--
-- Settings live in team_settings under the key ranked_offers (every market
-- starts on Suggest). Server only (service role), like the other team tables.
-- Safe to run twice.

begin;

alter table public.staff add column if not exists off_weekdays smallint[] not null default '{}';
alter table public.staff add column if not exists in_offers boolean not null default false;

create table if not exists public.staff_rank (
  staff_id        uuid        primary key references public.staff (id) on delete cascade,
  tier            text        not null default 'developing' check (tier in ('top', 'core', 'developing')),
  position        integer     not null default 0,
  solo_guests     integer     check (solo_guests is null or solo_guests between 1 and 2000),
  weddings        boolean     not null default false,
  note            text        not null default '' check (length(note) <= 280),
  placed          boolean     not null default false, -- false until an admin places or edits them: "Not placed yet"
  updated_by      uuid        references public.staff (id) on delete set null,
  updated_by_name text,
  updated_at      timestamptz not null default now(),
  constraint staff_rank_not_self check (updated_by is null or updated_by <> staff_id)
);
create index if not exists staff_rank_order_idx on public.staff_rank (tier, position);

create table if not exists public.staff_rank_history (
  id              uuid        primary key default gen_random_uuid(),
  staff_id        uuid        not null references public.staff (id) on delete cascade,
  changed_by      uuid        references public.staff (id) on delete set null,
  changed_by_name text,
  changed_at      timestamptz not null default now(),
  before          jsonb,
  after           jsonb       not null,
  constraint staff_rank_history_not_self check (changed_by is null or changed_by <> staff_id)
);
create index if not exists staff_rank_history_staff_idx on public.staff_rank_history (staff_id, changed_at desc);

create table if not exists public.offer_runs (
  id              uuid        primary key default gen_random_uuid(),
  session_id      text        not null references public.sessions (id) on delete cascade,
  market          text        not null,
  spots           integer     not null check (spots >= 1),
  status          text        not null default 'running' check (status in ('running', 'paused', 'stopped', 'filled', 'exhausted')),
  team_approved   boolean     not null default false, -- someone outside Developing was already on the event at the start
  started_by      uuid        references public.staff (id) on delete set null,
  started_by_name text,
  started_how     text        not null default 'admin' check (started_how in ('admin', 'automatic')),
  started_at      timestamptz not null default now(),
  paused_at       timestamptz,
  ended_at        timestamptz,
  ended_by_name   text,
  alerted_at      timestamptz, -- the one "nobody took it" text
  alert_reason    text
);
create index if not exists offer_runs_session_idx on public.offer_runs (session_id, started_at desc);
-- At most one live run per event.
create unique index if not exists offer_runs_one_live on public.offer_runs (session_id) where status in ('running', 'paused');

create table if not exists public.offer_steps (
  id              uuid        primary key default gen_random_uuid(),
  run_id          uuid        not null references public.offer_runs (id) on delete cascade,
  staff_id        uuid        not null references public.staff (id) on delete cascade,
  grp             smallint    not null check (grp between 0 and 2), -- 0 Top, 1 Core, 2 Developing. Admin views only.
  rank            integer     not null,
  due_at          timestamptz not null, -- the one spot order
  due_wide_at     timestamptz,          -- while two or more spots are open
  status          text        not null default 'planned' check (status in ('planned', 'sent', 'accepted', 'held', 'released', 'declined', 'no_response', 'skipped', 'closed')),
  sent_at         timestamptz,
  responded_at    timestamptz,
  skip_reason     text,
  skipped_by_name text,
  unique (run_id, staff_id)
);
create index if not exists offer_steps_run_idx on public.offer_steps (run_id);
create index if not exists offer_steps_staff_idx on public.offer_steps (staff_id, status);

create table if not exists public.offer_claims (
  run_id          uuid        not null references public.offer_runs (id) on delete cascade,
  spot            integer     not null check (spot >= 1),
  staff_id        uuid        references public.staff (id) on delete set null,
  kind            text        not null check (kind in ('accept', 'held', 'hand')),
  created_at      timestamptz not null default now(),
  primary key (run_id, spot)
);

-- Today's active bartenders start in Developing in name order, weddings yes,
-- solo guests blank (no limit), not placed yet. New hires get added later by
-- the app at the bottom of Developing with weddings no.
insert into public.staff_rank (staff_id, tier, position, weddings, placed)
select id, 'developing', row_number() over (order by name, id), true, false
from public.staff
where role = 'bartender' and active
on conflict (staff_id) do nothing;

insert into public.team_settings (key, value)
values ('ranked_offers', '{"headStartMin":30,"windowMin":180,"assignOnAccept":true,"holdOverGuests":150,"startDaysBefore":30,"modes":{"dallas":"suggest","austin":"suggest","houston":"suggest","los_angeles":"suggest"},"reviewed":{}}'::jsonb)
on conflict (key) do nothing;

alter table public.staff_rank enable row level security;
alter table public.staff_rank_history enable row level security;
alter table public.offer_runs enable row level security;
alter table public.offer_steps enable row level security;
alter table public.offer_claims enable row level security;
revoke all on public.staff_rank from anon, authenticated;
revoke all on public.staff_rank_history from anon, authenticated;
revoke all on public.offer_runs from anon, authenticated;
revoke all on public.offer_steps from anon, authenticated;
revoke all on public.offer_claims from anon, authenticated;

commit;
