-- Scorecard: a real Manual signed tick per person, beside Payroll setup done.
-- Admins tick it (checked on the server in lib/team/scorecard-db.ts), it
-- records who and when, and managers see it read only. It drives the roster
-- flag and the Manual Signed column of the ratings CSV. Nobody ticks it for
-- themselves (checked on the server and below).
--
-- Run after 20261220_staff_scorecard.sql, which creates staff_setup_flags.
-- Until this runs, Manual signed shows as not signed and ticking it says the
-- migration is needed; Payroll setup done keeps working.

begin;

alter table public.staff_setup_flags add column if not exists manual_done    boolean     not null default false;
alter table public.staff_setup_flags add column if not exists manual_by      uuid        references public.staff (id) on delete set null;
alter table public.staff_setup_flags add column if not exists manual_by_name text;
alter table public.staff_setup_flags add column if not exists manual_at      timestamptz;

alter table public.staff_setup_flags drop constraint if exists staff_setup_flags_manual_not_self;
alter table public.staff_setup_flags add constraint staff_setup_flags_manual_not_self check (manual_by is null or manual_by <> staff_id);

commit;
