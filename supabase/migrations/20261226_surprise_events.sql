-- Surprise events. Safe to run twice.
--
-- A surprise event has a guest of honor (the honoree) who must never be
-- contacted or given access: no text from this app reaches their number, the
-- host gets no welcome text and cannot sign in at /partners, and their phone or
-- email can never be saved as the client phone, the day of contact, a planner,
-- or a host login. The block lifts 30 days after the event date.
--
-- planning_role records the concierge's opening question ("Are you the guest of
-- honor, hosting this for someone else, or a planner booking for a client?") the
-- moment it is answered, so it is never asked twice, even after a reload.
-- surprise_set_at is set whenever the surprise question is answered (yes or no)
-- or an admin changes it, so that question is never asked twice either.
--
-- Every column defaults to the old behavior, and no rows are written: every
-- existing event reads exactly as before (not a surprise, role not asked).

begin;

alter table public.sessions
  add column if not exists is_surprise      boolean     not null default false,
  add column if not exists honoree_name     text,
  add column if not exists honoree_phone    text,        -- normalized like staff phones (+1XXXXXXXXXX)
  add column if not exists honoree_email    text,
  add column if not exists surprise_set_by  text,
  add column if not exists surprise_set_at  timestamptz,
  add column if not exists planning_role    text;

alter table public.sessions drop constraint if exists sessions_planning_role_check;
alter table public.sessions add constraint sessions_planning_role_check
  check (planning_role is null or planning_role in ('guest_of_honor', 'someone_else', 'planner'));

-- The text guard looks up every outgoing number here.
create index if not exists sessions_honoree_phone_idx on public.sessions (honoree_phone) where is_surprise and honoree_phone is not null;

commit;
