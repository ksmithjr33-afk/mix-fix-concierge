-- Markets, open shifts, shift requests, and shift handoffs.
--
-- Markets: Dallas, Austin, Houston, Los Angeles. Staff work one or more
-- (existing staff default to Dallas). Each event has one, stored in team_*
-- columns on sessions (never in event_data, which stays the client's), set
-- automatically from the event location or by an admin.
--
-- Open shifts: an admin posts an event's unfilled spots to its market,
-- bartenders in that market request it, and the admin approves as many as
-- there are spots. A handoff opened to the market is posted the same way as a
-- "cover" post tied to the handoff.
--
-- Server only (service role), so RLS is on with no policies.

begin;

-- ----- Markets -----

alter table public.staff add column if not exists markets text[] not null default '{dallas}';
alter table public.staff drop constraint if exists staff_markets_check;
alter table public.staff add constraint staff_markets_check
  check (cardinality(markets) >= 1 and markets <@ array['dallas', 'austin', 'houston', 'los_angeles']::text[]);

alter table public.sessions add column if not exists team_market text;
alter table public.sessions add column if not exists team_market_source text;   -- 'auto', 'none' (no metro within 150 miles), or 'admin'
alter table public.sessions add column if not exists team_market_address text;  -- the address the automatic market was worked out for
alter table public.sessions add column if not exists team_market_set_by uuid references public.staff (id) on delete set null;
alter table public.sessions add column if not exists team_market_set_at timestamptz;
alter table public.sessions drop constraint if exists sessions_team_market_check;
alter table public.sessions add constraint sessions_team_market_check
  check (team_market is null or team_market in ('dallas', 'austin', 'houston', 'los_angeles'));
alter table public.sessions drop constraint if exists sessions_team_market_source_check;
alter table public.sessions add constraint sessions_team_market_source_check
  check (team_market_source is null or team_market_source in ('auto', 'none', 'admin'));

-- ----- Handoffs -----

create table if not exists public.shift_handoffs (
  id            uuid        primary key default gen_random_uuid(),
  session_id    text        not null references public.sessions (id) on delete cascade,
  from_staff_id uuid        not null references public.staff (id) on delete restrict,
  mode          text        not null check (mode in ('teammate', 'market')),
  to_staff_id   uuid        references public.staff (id) on delete restrict,  -- the named teammate, then the approved replacement
  reason        text        not null,
  status        text        not null check (status in ('asked', 'teammate_accepted', 'open', 'approved', 'teammate_declined', 'admin_declined', 'cancelled')),
  urgent        boolean     not null default false,  -- asked inside 48 hours of the event
  created_at    timestamptz not null default now(),
  responded_at  timestamptz,                         -- the named teammate's answer
  decided_by    uuid        references public.staff (id) on delete set null,
  decided_at    timestamptz,
  constraint shift_handoffs_reason_check check (length(btrim(reason)) >= 3),
  constraint shift_handoffs_not_self check (to_staff_id is null or to_staff_id <> from_staff_id),
  constraint shift_handoffs_teammate_named check (mode <> 'teammate' or to_staff_id is not null)
);
-- One open handoff per person per event.
create unique index if not exists shift_handoffs_one_active
  on public.shift_handoffs (session_id, from_staff_id)
  where status in ('asked', 'teammate_accepted', 'open');
create index if not exists shift_handoffs_to_idx on public.shift_handoffs (to_staff_id);

-- ----- Posts and requests -----

create table if not exists public.shift_posts (
  id         uuid        primary key default gen_random_uuid(),
  session_id text        not null references public.sessions (id) on delete cascade,
  market     text        not null check (market in ('dallas', 'austin', 'houston', 'los_angeles')),
  kind       text        not null check (kind in ('open', 'cover')),
  handoff_id uuid        references public.shift_handoffs (id) on delete cascade,
  status     text        not null default 'posted' check (status in ('posted', 'filled', 'unposted')),
  posted_by  uuid        references public.staff (id) on delete set null,  -- null for a cover post opened by a bartender
  posted_at  timestamptz not null default now(),
  closed_at  timestamptz,
  closed_by  uuid        references public.staff (id) on delete set null,
  constraint shift_posts_cover_has_handoff check ((kind = 'cover') = (handoff_id is not null))
);
-- One posted open shift per event, and one cover post per handoff.
create unique index if not exists shift_posts_one_open on public.shift_posts (session_id) where kind = 'open' and status = 'posted';
create unique index if not exists shift_posts_one_cover on public.shift_posts (handoff_id) where handoff_id is not null;
create index if not exists shift_posts_status_idx on public.shift_posts (status, market);

create table if not exists public.shift_requests (
  id           uuid        primary key default gen_random_uuid(),
  post_id      uuid        not null references public.shift_posts (id) on delete cascade,
  staff_id     uuid        not null references public.staff (id) on delete restrict,
  status       text        not null default 'requested' check (status in ('requested', 'withdrawn', 'approved', 'not_chosen', 'closed')),
  requested_at timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (post_id, staff_id)
);
create index if not exists shift_requests_staff_idx on public.shift_requests (staff_id);

alter table public.shift_handoffs enable row level security;
alter table public.shift_posts    enable row level security;
alter table public.shift_requests enable row level security;

commit;
