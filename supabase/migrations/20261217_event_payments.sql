-- Business: a payments list per event, so partial payments work (admins only,
-- enforced on the server).
--
-- Each payment is an amount, the date it was paid, an optional free text note
-- ("Zelle", "second payment"), and who recorded it. No card numbers or payment
-- method details: the app stores no card information.
--
-- Existing data: every event with a recorded "Balance paid" becomes one
-- payment, and the old balance columns are cleared so it is not counted twice.
-- Until this runs, the app still shows an old Balance paid amount as a payment.
-- Server only (service role), like the other team tables.

begin;

create table if not exists public.event_payments (
  id              uuid        primary key default gen_random_uuid(),
  session_id      text        not null references public.sessions (id) on delete cascade,
  amount_cents    integer     not null check (amount_cents > 0),
  paid_on         date        not null,
  note            text        not null default '' check (length(note) <= 120),
  created_by      uuid        references public.staff (id) on delete set null,
  created_by_name text,
  created_at      timestamptz not null default now(),
  updated_by      uuid        references public.staff (id) on delete set null,
  updated_at      timestamptz
);
create index if not exists event_payments_session_idx on public.event_payments (session_id);

alter table public.event_payments enable row level security;
revoke all on public.event_payments from anon, authenticated;

-- Keep existing data: a recorded balance paid becomes one payment.
insert into public.event_payments (session_id, amount_cents, paid_on, note, created_by, created_by_name, created_at)
select f.session_id,
       f.balance_paid_cents,
       coalesce(f.balance_paid_on, f.updated_at::date),
       'Balance paid',
       f.updated_by,
       s.name,
       f.updated_at
from public.event_finance f
left join public.staff s on s.id = f.updated_by
where f.balance_paid_cents is not null and f.balance_paid_cents > 0;

update public.event_finance
set balance_paid_cents = null, balance_paid_on = null
where balance_paid_cents is not null;

commit;
