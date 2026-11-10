-- Hidden events: admins can hide an event (a test session, say) from the team
-- portal. Only this table is written; sessions and the client side are untouched,
-- and unhiding deletes the row. Server only, so RLS is on with no policies.

begin;

create table if not exists public.team_hidden_events (
  session_id text        primary key references public.sessions (id) on delete cascade,
  hidden_by  uuid        references public.staff (id) on delete set null,
  hidden_at  timestamptz not null default now()
);

alter table public.team_hidden_events enable row level security;

commit;
