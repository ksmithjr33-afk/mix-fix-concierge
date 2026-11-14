-- Price pending: a client change the pricing engine cannot price (a retired
-- package such as Essentials, Tailored Bar or Bartender Only, or no booked
-- total on file) is saved anyway and the event is marked price pending until
-- an admin types the new total on the manager view.
--
-- sessions.price_pending          true while the new total is unknown
-- sessions.price_pending_info     what changed, old and new package, old total,
--                                 any price the client says they were quoted
-- sessions.price_pending_at       when it was marked
-- sessions.price_set_*            who typed the new total, when, and the total
-- Server only (service role), like the other columns. Safe to run twice.

begin;

alter table public.sessions add column if not exists price_pending      boolean not null default false;
alter table public.sessions add column if not exists price_pending_info jsonb;
alter table public.sessions add column if not exists price_pending_at   timestamptz;
alter table public.sessions add column if not exists price_set_at       timestamptz;
alter table public.sessions add column if not exists price_set_by       uuid references public.staff (id) on delete set null;
alter table public.sessions add column if not exists price_set_by_name  text;
alter table public.sessions add column if not exists price_set_total    numeric;

create index if not exists sessions_price_pending_idx on public.sessions (price_pending_at) where price_pending;

commit;
