-- Hourly pay rates, one per staff member, set by admins. Kept in their own
-- table, never on the staff row, so no staff list or teammate lookup can carry
-- them. Server only (service role), like the other team tables.

create table if not exists public.staff_pay_rates (
  staff_id          uuid        primary key references public.staff (id) on delete cascade,
  hourly_rate_cents integer     not null check (hourly_rate_cents > 0 and hourly_rate_cents <= 20000),
  updated_by        uuid        references public.staff (id) on delete set null,
  updated_at        timestamptz not null default now()
);

alter table public.staff_pay_rates enable row level security;
revoke all on public.staff_pay_rates from anon, authenticated;
