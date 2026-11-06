-- Change orders with automatic pricing.
--
-- sessions.booked_price: what the client booked (package_price, gratuity,
--   total, bartenders, promo_code, custom_price, discount_amount, tip_jar,
--   deposit_paid, and the basis it was priced for). Set by /api/create-session,
--   computed on first use for older sessions, moved to the new total when a
--   change order is signed.
-- sessions.pending_change: a priced change order waiting on the client's
--   signature. Not applied to event_data until /api/manager-update runs.
-- event_updates.change_order: the pending change as priced when that row's
--   change order was sent.
-- event_updates.change_approval_needed: the concierge passed something to
--   management under the conduct rule.

begin;

alter table public.sessions
  add column if not exists pending_change jsonb,
  add column if not exists booked_price   jsonb;

alter table public.event_updates
  add column if not exists change_order           jsonb,
  add column if not exists change_approval_needed boolean not null default false;

-- /api/manager-update looks up sessions with a pending change order.
create index if not exists sessions_pending_change_idx
  on public.sessions (id)
  where pending_change is not null;

commit;
