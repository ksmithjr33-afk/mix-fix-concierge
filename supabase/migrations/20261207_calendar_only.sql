-- Calendar only events: already confirmed outside the concierge, added to our
-- calendar for the team. Nothing goes to GHL or the client while
-- calendar_only is true (see lib/calendar-only.ts). "Turn on client messages"
-- clears it, records who and when, and sends the intake payload once.
-- Safe to run twice.

begin;

alter table public.sessions add column if not exists calendar_only         boolean not null default false;
alter table public.sessions add column if not exists client_messages_on_at timestamptz;
alter table public.sessions add column if not exists client_messages_on_by text;

create index if not exists sessions_calendar_only_idx on public.sessions (id) where calendar_only;

commit;
