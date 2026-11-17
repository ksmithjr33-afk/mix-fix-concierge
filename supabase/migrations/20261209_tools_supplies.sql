-- 1 Tools, 2 Supplies: "I have gone through the supplies list", one row per
-- person per event. Its own table, so unchecking a Tools item (which clears
-- staff_confirmations) never wipes it. missing_count is how many items were
-- left unchecked and reported missing. Server only. Safe to run twice.

begin;

create table if not exists public.staff_supplies_confirmations (
  staff_id      uuid        not null references public.staff (id) on delete cascade,
  session_id    text        not null references public.sessions (id) on delete cascade,
  confirmed_at  timestamptz not null default now(),
  missing_count integer     not null default 0,
  primary key (staff_id, session_id)
);

alter table public.staff_supplies_confirmations enable row level security;
revoke all on public.staff_supplies_confirmations from anon, authenticated;

commit;
