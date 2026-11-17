-- Business, per event (admins only, enforced on the server).
--
-- event_finance: payment status an admin enters (deposit paid and balance paid,
-- each with an amount and date), and a manual supplies amount for the event.
-- event_other_costs: "Other costs" lines an admin adds, a label and an amount.
-- Server only (service role), like the other team tables.

begin;

create table if not exists public.event_finance (
  session_id         text        primary key references public.sessions (id) on delete cascade,
  deposit_paid_cents integer     check (deposit_paid_cents is null or deposit_paid_cents >= 0),
  deposit_paid_on    date,
  balance_paid_cents integer     check (balance_paid_cents is null or balance_paid_cents >= 0),
  balance_paid_on    date,
  supplies_cents     integer     check (supplies_cents is null or supplies_cents >= 0),
  updated_by         uuid        references public.staff (id) on delete set null,
  updated_at         timestamptz not null default now()
);

create table if not exists public.event_other_costs (
  id         uuid        primary key default gen_random_uuid(),
  session_id text        not null references public.sessions (id) on delete cascade,
  label      text        not null check (length(label) between 2 and 80),
  cents      integer     not null check (cents > 0),
  created_by uuid        references public.staff (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists event_other_costs_session_idx on public.event_other_costs (session_id);

alter table public.event_finance enable row level security;
alter table public.event_other_costs enable row level security;
revoke all on public.event_finance, public.event_other_costs from anon, authenticated;

-- Payroll burden 15% of labor; card processing 2.9% + $0.30 a charge (confirm your rate).
insert into public.team_settings (key, value)
values ('business_costs', '{"burdenPct": 15, "cardPct": 2.9, "cardFixedCents": 30}'::jsonb)
on conflict (key) do nothing;

commit;
