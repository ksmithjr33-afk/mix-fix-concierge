-- Payroll reimbursements: money an admin pays back to one person on one event
-- (ice, menu printing, other), with an optional note. Added to that person's
-- amount on the payout sheet and in payroll in its own column; never wages.
-- Shown on the event's Business tab as "Reimbursed to staff".
--
-- Admins only (role admin, never managers) add, change, or remove them, and
-- only while that person's line is not marked paid: enforced on the server in
-- lib/team/reimbursements-db.ts. A staff member reads only their own.
--
-- Also adds the reimbursement total to the payroll_paid snapshot, so a change
-- after a line is marked paid shows the warning. Run after
-- 20261218_payroll_paid.sql.
--
-- Until this runs, Payroll, the Payout card, Business and My pay all load with
-- no reimbursements, and adding one says the migration is needed. Server only
-- (service role), like the other team tables.

begin;

create table if not exists public.payroll_reimbursements (
  id              uuid         primary key default gen_random_uuid(),
  assignment_id   uuid         not null references public.event_assignments (id) on delete restrict,
  session_id      text         not null references public.sessions (id) on delete restrict,
  staff_id        uuid         not null references public.staff (id) on delete restrict,
  kind            text         not null check (kind in ('ice', 'menu_printing', 'other')),
  amount_cents    integer      not null check (amount_cents > 0 and amount_cents <= 100000),
  note            text         not null default '' check (length(note) <= 120),
  created_by      uuid         references public.staff (id) on delete set null,
  created_by_name text,
  created_at      timestamptz  not null default now(),
  updated_by      uuid         references public.staff (id) on delete set null,
  updated_by_name text,
  updated_at      timestamptz
);

create index if not exists payroll_reimbursements_assignment_idx on public.payroll_reimbursements (assignment_id);
create index if not exists payroll_reimbursements_session_idx on public.payroll_reimbursements (session_id);
create index if not exists payroll_reimbursements_staff_idx on public.payroll_reimbursements (staff_id);

alter table public.payroll_reimbursements enable row level security;
revoke all on public.payroll_reimbursements from anon, authenticated;

-- The snapshot taken when a line is marked paid.
alter table public.payroll_paid
  add column if not exists reimbursements_cents integer not null default 0 check (reimbursements_cents >= 0);

commit;
