-- Ice pickup tracker. Safe to run twice: every statement checks first.
--
-- event_ice_pickups: one row per event (the recommended store, an optional
--   address, total bags and notes). No row means nothing set yet.
-- event_ice_pickup_people: who is picking up ice for the event, many per event.
--   Any active staff member or admin, on the event or not. Each person's
--   "Picked up" records who checked it, when, where and how many bags.
--   notified_bags and notified_location are what their last text said, so a
--   new text goes only when their bag count or the location changes.
-- event_ice_pickup_log: every change.

begin;

create table if not exists public.event_ice_pickups (
  session_id       text        primary key references public.sessions (id) on delete cascade,
  location_name    text        check (location_name is null or length(location_name) <= 120),
  location_address text        check (location_address is null or length(location_address) <= 200),
  total_bags       integer     check (total_bags is null or (total_bags >= 0 and total_bags <= 999)),
  notes            text        check (notes is null or length(notes) <= 500),
  updated_by       uuid        references public.staff (id) on delete set null,
  updated_by_name  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.event_ice_pickup_people (
  id                uuid        primary key default gen_random_uuid(),
  session_id        text        not null references public.sessions (id) on delete cascade,
  staff_id          uuid        not null references public.staff (id) on delete cascade,
  bags_assigned     integer     check (bags_assigned is null or (bags_assigned >= 0 and bags_assigned <= 999)),
  self_added        boolean     not null default false, -- "I picked up the ice instead"
  assigned_by       uuid        references public.staff (id) on delete set null,
  assigned_by_name  text,
  picked_up_at      timestamptz,
  picked_up_by      uuid        references public.staff (id) on delete set null,
  picked_up_by_name text,
  actual_location   text        check (actual_location is null or length(actual_location) <= 120),
  actual_bags       integer     check (actual_bags is null or (actual_bags >= 0 and actual_bags <= 999)),
  notify_after      timestamptz, -- the text, held for quiet hours
  notified_at       timestamptz,
  notified_bags     integer,
  notified_location text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (session_id, staff_id)
);
create index if not exists event_ice_pickup_people_staff on public.event_ice_pickup_people (staff_id);
create index if not exists event_ice_pickup_people_notify on public.event_ice_pickup_people (notify_after) where notify_after is not null;

create table if not exists public.event_ice_pickup_log (
  id         uuid        primary key default gen_random_uuid(),
  session_id text        not null references public.sessions (id) on delete cascade,
  action     text        not null,
  detail     text,
  by_id      uuid        references public.staff (id) on delete set null,
  by_name    text,
  created_at timestamptz not null default now()
);
create index if not exists event_ice_pickup_log_session on public.event_ice_pickup_log (session_id, created_at);

-- Server only, like the menu pickup tables.
alter table public.event_ice_pickups enable row level security;
alter table public.event_ice_pickup_people enable row level security;
alter table public.event_ice_pickup_log enable row level security;
revoke all on public.event_ice_pickups, public.event_ice_pickup_people, public.event_ice_pickup_log from anon, authenticated;

commit;
