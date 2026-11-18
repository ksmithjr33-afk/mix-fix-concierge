-- Payroll: a hand kept record of which lines (one person on one event) an
-- admin marked paid. Admins only (role admin, never managers), enforced on the
-- server in lib/team/payroll-db.ts.
--
-- Marking paid saves who marked it, when, the pay date, an optional note
-- ("Gusto run Nov 20"), and a snapshot of the line's hours, wages, mileage,
-- tips and total, so the app can warn when the live numbers change after it
-- was paid. Undo keeps the row and records who undid it and when; at most one
-- row per line is in force (undone_at is null) at a time.
--
-- Until this runs, the Payroll page loads with everything unpaid and marking
-- paid says the migration is needed. Server only (service role), like the
-- other team tables.

begin;

create table if not exists public.payroll_paid (
  id             uuid         primary key default gen_random_uuid(),
  assignment_id  uuid         not null references public.event_assignments (id) on delete restrict,
  session_id     text         not null references public.sessions (id) on delete restrict,
  staff_id       uuid         not null references public.staff (id) on delete restrict,
  paid_on        date         not null,
  note           text         not null default '' check (length(note) <= 120),
  -- The snapshot: what was paid.
  rate_cents     integer      not null check (rate_cents > 0),
  minutes        integer      not null check (minutes > 0),
  wages_cents    integer      not null check (wages_cents >= 0),
  mileage_miles  numeric(7,1) not null default 0 check (mileage_miles >= 0),
  mileage_cents  integer      not null default 0 check (mileage_cents >= 0),
  tips_cents     integer               check (tips_cents is null or tips_cents >= 0),
  total_cents    integer      not null check (total_cents >= 0),
  marked_by      uuid         references public.staff (id) on delete set null,
  marked_by_name text,
  marked_at      timestamptz  not null default now(),
  undone_by      uuid         references public.staff (id) on delete set null,
  undone_by_name text,
  undone_at      timestamptz
);

-- One paid mark in force per line.
create unique index if not exists payroll_paid_one_active_idx on public.payroll_paid (assignment_id) where undone_at is null;
create index if not exists payroll_paid_staff_idx on public.payroll_paid (staff_id);
create index if not exists payroll_paid_session_idx on public.payroll_paid (session_id);

alter table public.payroll_paid enable row level security;
revoke all on public.payroll_paid from anon, authenticated;

commit;
