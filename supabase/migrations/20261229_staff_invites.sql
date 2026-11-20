-- Resend invite (2026-11-20).
--
-- One row per welcome text an admin or manager sends from the Staff page or a
-- staff profile: who it went to, the number it went to, who sent it, when,
-- and whether the text went out. The app reads it for the two minute limit
-- per person and for "Last invite" on the Staff page (lib/team/invites-db.ts).
--
-- ok is null while the text is being sent (it holds the two minute slot so a
-- double tap sends one text), true when it went out, false when it failed.
-- A failed send never counts toward the limit.
--
-- Only the server (service role key) reads it, like the other team tables.

begin;

create table if not exists public.staff_invites (
  id         uuid        primary key default gen_random_uuid(),
  staff_id   uuid        not null references public.staff (id) on delete cascade,
  sent_by    uuid        references public.staff (id) on delete set null,
  phone      text        not null,
  ok         boolean,
  created_at timestamptz not null default now()
);
create index if not exists staff_invites_staff_idx on public.staff_invites (staff_id, created_at desc);

alter table public.staff_invites enable row level security;
revoke all on public.staff_invites from anon, authenticated;

commit;
