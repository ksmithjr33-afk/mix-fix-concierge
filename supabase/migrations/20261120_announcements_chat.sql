-- Announcements to staff, and a team chat thread per event. Safe to run twice.

-- ----- Announcements -----
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 120),
  body text not null check (length(btrim(body)) between 1 and 2000),
  markets text[] not null default '{}' check (markets <@ array['dallas', 'austin', 'houston', 'los_angeles']::text[]), -- empty: every market
  bartenders_only boolean not null default false,
  send_now boolean not null default false,
  created_by uuid references public.staff(id) on delete set null,
  created_at timestamptz not null default now()
);

-- One row per person per announcement, so nobody gets two texts for one announcement.
create table if not exists public.announcement_recipients (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  time_zone text not null default 'America/Chicago',
  send_after timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  sent_at timestamptz,
  opened_at timestamptz,
  unique (announcement_id, staff_id)
);
create index if not exists announcement_recipients_due on public.announcement_recipients (status, send_after);
create index if not exists announcement_recipients_staff on public.announcement_recipients (staff_id, opened_at);

-- ----- Event team chat -----
create table if not exists public.event_messages (
  id uuid primary key default gen_random_uuid(),
  session_id text not null references public.sessions(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete set null,
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists event_messages_session on public.event_messages (session_id, created_at);

-- When each person last read a thread, for unread counts.
create table if not exists public.event_message_reads (
  session_id text not null references public.sessions(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  last_read_at timestamptz not null,
  primary key (session_id, staff_id)
);

-- Text batching per person per event: the last text sent, and a held text when one is waiting.
create table if not exists public.event_chat_notices (
  session_id text not null references public.sessions(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  last_sent_at timestamptz,
  pending_after timestamptz,
  primary key (session_id, staff_id)
);
create index if not exists event_chat_notices_pending on public.event_chat_notices (pending_after) where pending_after is not null;

alter table public.announcements enable row level security;
alter table public.announcement_recipients enable row level security;
alter table public.event_messages enable row level security;
alter table public.event_message_reads enable row level security;
alter table public.event_chat_notices enable row level security;
revoke all on public.announcements, public.announcement_recipients, public.event_messages, public.event_message_reads, public.event_chat_notices from anon, authenticated;
