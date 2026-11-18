-- Partner portal, phase 1: planners. Safe to run twice.
--
-- Partners are outside people, never staff. They sign in at /partners with a
-- text code, kept in their own code and session tables so a staff session can
-- never open a partner page and a partner session can never open a team page.
-- type is 'planner' now; 'venue' is allowed for phase 2, which reuses the same
-- account, codes and sessions.
--
-- Every event has one booking holder: 'client' (the default, every existing
-- event) or 'planner'. A host (the person the event is for, when that is not
-- the booking holder) is optional. Nothing about an existing event changes:
-- each new sessions column defaults to the old behavior, and no rows are
-- written for existing events.
--
-- Only the server (with the service role key) reads these tables, so RLS is on
-- with no policies.

begin;

-- 1. Partner accounts.
create table if not exists public.partners (
  id              uuid        primary key default gen_random_uuid(),
  type            text        not null default 'planner' check (type in ('planner', 'venue')),
  name            text        not null default '' check (length(name) <= 80),
  company         text        not null default '' check (length(company) <= 120),
  phone           text        not null unique,
  email           text        not null default '' check (length(email) <= 200),
  website         text        not null default '' check (length(website) <= 300),
  markets         text[]      not null default '{}' check (markets <@ array['dallas', 'austin', 'houston', 'los_angeles']::text[]),
  active          boolean     not null default true,
  internal_notes  text        not null default '' check (length(internal_notes) <= 4000), -- admins and managers only
  last_sign_in_at timestamptz,
  created_by_name text        not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists partners_type_idx on public.partners (type, active);

-- 2. Login codes and sessions: the same shape and rules as the staff ones.
create table if not exists public.partner_login_codes (
  id         uuid        primary key default gen_random_uuid(),
  phone      text        not null,
  code_hash  text        not null,
  expires_at timestamptz not null,
  attempts   integer     not null default 0,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists partner_login_codes_phone_idx on public.partner_login_codes (phone, created_at desc);

-- A session belongs to a partner, or to a host (by phone, checked against the
-- event on every request).
create table if not exists public.partner_sessions (
  token_hash text        primary key,
  partner_id uuid        references public.partners (id) on delete cascade,
  host_phone text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  check ((partner_id is not null) <> (host_phone is not null))
);
create index if not exists partner_sessions_partner_idx on public.partner_sessions (partner_id);

-- 3. Who holds the booking, the host, and the pricing switches, on the event.
alter table public.sessions
  add column if not exists booking_holder         text        not null default 'client',
  add column if not exists booking_holder_set_by  text,
  add column if not exists booking_holder_set_at  timestamptz,
  add column if not exists host_name              text,
  add column if not exists host_phone             text,
  add column if not exists host_email             text,
  add column if not exists planner_label          text,       -- "Bloom Events": the Lead's company or name, for titles
  add column if not exists partner_key            text,       -- the event's id in partner links, never the client's link id
  add column if not exists planner_can_see_pricing boolean    not null default false, -- client held: client or admin only
  add column if not exists others_can_see_pricing boolean     not null default false, -- planner held: the Lead only
  add column if not exists host_can_see_pricing   boolean     not null default false, -- the Lead only
  add column if not exists planner_asked          boolean     not null default false; -- the concierge asked about a planner once

alter table public.sessions drop constraint if exists sessions_booking_holder_check;
alter table public.sessions add constraint sessions_booking_holder_check check (booking_holder in ('client', 'planner'));
create unique index if not exists sessions_partner_key_uq on public.sessions (partner_key) where partner_key is not null;
create index if not exists sessions_host_phone_idx on public.sessions (host_phone) where host_phone is not null;

-- 4. Planners on an event. A removed planner keeps their row (removed_at set)
-- so the activity log keeps their history; only one live link per planner.
create table if not exists public.event_planners (
  id               uuid        primary key default gen_random_uuid(),
  session_id       text        not null references public.sessions (id) on delete cascade,
  partner_id       uuid        not null references public.partners (id) on delete cascade,
  is_lead          boolean     not null default false,
  linked_via       text        not null check (linked_via in ('booked', 'staff', 'client', 'lead')),
  linked_by_name   text        not null default '',
  linked_at        timestamptz not null default now(),
  remove_token_hash text,                -- the client's one tap remove link
  removed_at       timestamptz,
  removed_by_name  text,
  created_at       timestamptz not null default now()
);
create unique index if not exists event_planners_live_uq on public.event_planners (session_id, partner_id) where removed_at is null;
create unique index if not exists event_planners_one_lead_uq on public.event_planners (session_id) where removed_at is null and is_lead;
create index if not exists event_planners_partner_idx on public.event_planners (partner_id) where removed_at is null;
create index if not exists event_planners_token_idx on public.event_planners (remove_token_hash) where remove_token_hash is not null;

-- 5. Everything a planner (or anyone about planners) did on an event.
create table if not exists public.partner_activity (
  id          uuid        primary key default gen_random_uuid(),
  session_id  text        not null references public.sessions (id) on delete cascade,
  partner_id  uuid        references public.partners (id) on delete set null,
  actor_kind  text        not null check (actor_kind in ('planner', 'host', 'client', 'staff', 'system')),
  actor_name  text        not null default '',
  action      text        not null,
  detail      text        not null default '',
  created_at  timestamptz not null default now()
);
create index if not exists partner_activity_session_idx on public.partner_activity (session_id, created_at desc);
create index if not exists partner_activity_partner_idx on public.partner_activity (partner_id, created_at desc);

-- 6. Price changes asked for by someone who does not hold the booking. Nothing
-- is applied until the booking holder says yes.
create table if not exists public.price_approvals (
  id              uuid        primary key default gen_random_uuid(),
  session_id      text        not null references public.sessions (id) on delete cascade,
  partner_id      uuid        references public.partners (id) on delete set null,
  asked_by_name   text        not null default '',
  changes         jsonb       not null,           -- the fields to apply on a yes
  summary         text        not null default '',
  amount          numeric,
  new_total       numeric,
  price_text      text        not null default '',
  holder          text        not null check (holder in ('client', 'planner')),
  token_hash      text,                             -- the client's approve link
  status          text        not null default 'pending' check (status in ('pending', 'approved', 'declined', 'expired', 'stale')),
  expires_at      timestamptz not null,
  decided_at      timestamptz,
  decided_by_name text,
  created_at      timestamptz not null default now()
);
create index if not exists price_approvals_session_idx on public.price_approvals (session_id, created_at desc);
create index if not exists price_approvals_token_idx on public.price_approvals (token_hash) where token_hash is not null;

-- 7. Partner and host texts held for quiet hours (9 PM to 8 AM in the event's time zone).
create table if not exists public.partner_texts (
  id         uuid        primary key default gen_random_uuid(),
  session_id text        references public.sessions (id) on delete cascade,
  phone      text        not null,
  name       text        not null default '',
  message    text        not null,
  send_after timestamptz not null,
  sent_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists partner_texts_due_idx on public.partner_texts (send_after) where sent_at is null;

-- 8. Each planner's own update mode chat, kept apart from the client's (which can show prices).
create table if not exists public.partner_chats (
  session_id text        not null references public.sessions (id) on delete cascade,
  partner_id uuid        not null references public.partners (id) on delete cascade,
  messages   jsonb       not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (session_id, partner_id)
);

alter table public.partners            enable row level security;
alter table public.partner_chats       enable row level security;
alter table public.partner_login_codes enable row level security;
alter table public.partner_sessions    enable row level security;
alter table public.event_planners      enable row level security;
alter table public.partner_activity    enable row level security;
alter table public.price_approvals     enable row level security;
alter table public.partner_texts       enable row level security;
revoke all on public.partners, public.partner_chats, public.partner_login_codes, public.partner_sessions, public.event_planners, public.partner_activity, public.price_approvals, public.partner_texts from anon, authenticated;

commit;
