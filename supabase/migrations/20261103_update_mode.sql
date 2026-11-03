-- Concierge update mode: full event payload on the session row, versioned
-- post submission changes in event_updates, and a backfill so clients who
-- already finished intake land in update mode when they reopen their link.

begin;

-- 1. sessions: full event payload, status, and version
alter table public.sessions
  add column if not exists event_data   jsonb,
  add column if not exists status       text        not null default 'in_progress',
  add column if not exists submitted_at timestamptz,
  add column if not exists version      integer     not null default 0,
  add column if not exists updated_at   timestamptz;

alter table public.sessions
  drop constraint if exists sessions_status_check,
  add constraint sessions_status_check check (status in ('in_progress', 'submitted'));

-- 2. event_updates: one row per recorded change set.
-- version is the event_data version the row produced when applied, or the
-- version it was requested against when not applied (late drink changes and
-- manager requests). Version 1 is the initial submission, stored as
-- {field, old: null, new: value} for every field, so any version can be
-- rebuilt by replaying applied rows in order.
create table if not exists public.event_updates (
  id              uuid        primary key default gen_random_uuid(),
  session_id      text        not null references public.sessions (id) on delete cascade,
  version         integer     not null,
  created_at      timestamptz not null default now(),
  source          text        not null check (source in ('concierge', 'manager')),
  changes         jsonb       not null default '[]'::jsonb,
  summary         text,
  within_deadline boolean,
  applied         boolean     not null default false
);

create index if not exists event_updates_session_idx
  on public.event_updates (session_id, created_at);

-- Only one applied row per version per session.
create unique index if not exists event_updates_applied_version_uq
  on public.event_updates (session_id, version) where applied;

-- Server only table, read and written with the secret key.
alter table public.event_updates enable row level security;

-- 3. Update mode chat history, kept apart from the intake transcript.
alter table public.conversation_logs
  add column if not exists update_messages jsonb;

-- 4. Backfill sessions that already completed intake. conversation_logs
-- timestamps are stored without a time zone in UTC.
with latest as (
  select distinct on (session_id) session_id, event_data, updated_at
  from public.conversation_logs
  where status = 'completed' and event_data is not null
  order by session_id, updated_at desc
)
update public.sessions s
set event_data   = l.event_data,
    status       = 'submitted',
    submitted_at = l.updated_at at time zone 'UTC',
    updated_at   = l.updated_at at time zone 'UTC',
    version      = 1
from latest l
where s.id = l.session_id
  and s.status <> 'submitted';

insert into public.event_updates
  (session_id, version, created_at, source, changes, summary, within_deadline, applied)
select
  s.id,
  1,
  s.submitted_at,
  'concierge',
  (
    select coalesce(
      jsonb_agg(jsonb_build_object('field', e.key, 'old', null::jsonb, 'new', e.value) order by e.key),
      '[]'::jsonb
    )
    from jsonb_each(s.event_data) e
  ),
  'Initial submission',
  true,
  true
from public.sessions s
where s.status = 'submitted'
  and not exists (select 1 from public.event_updates u where u.session_id = s.id);

commit;

-- 5. OPTIONAL, separate fix: the events table has no bar_floor_access or
-- dive_menu_requested column, so most events inserts have failed since late
-- September (the full payloads are safe in conversation_logs.event_data).
-- Run this to stop the failures going forward:
--
-- alter table public.events
--   add column if not exists bar_floor_access    text,
--   add column if not exists dive_menu_requested boolean;
