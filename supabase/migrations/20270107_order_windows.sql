-- Order window: a per event checklist item replacing the weekly deliveries and
-- pickups confirm (lib/team/order-window.ts).
--
-- event_order_windows: one row per person per event, written when they answer
-- "When can you receive the order for this event?".
--   method       delivery or pickup
--   windows      [{ date: 'YYYY-MM-DD', from, to }], from and to in minutes
--                after midnight, on the days leading up to the event
--   note         one short line
--   answered_at  when they last saved it
-- Reminders are claimed in team_notices (order_window:<kind>:<event>:<staff>).
--
-- The weekly confirm is gone: staff_profiles.availability_confirmed_at and the
-- delivery_confirm_deadline setting are no longer read. They are left in place
-- (not dropped) so this is safe to run before or after the deploy.
--
-- Server only (service role), like the other team tables. Safe to run twice.

begin;

create table if not exists public.event_order_windows (
  session_id  text        not null references public.sessions (id) on delete cascade,
  staff_id    uuid        not null references public.staff (id) on delete cascade,
  method      text        not null check (method in ('delivery', 'pickup')),
  windows     jsonb       not null default '[]'::jsonb,
  note        text        check (note is null or length(note) <= 120),
  answered_at timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (session_id, staff_id)
);
create index if not exists event_order_windows_staff_idx on public.event_order_windows (staff_id);

alter table public.event_order_windows enable row level security;
revoke all on public.event_order_windows from anon, authenticated;

commit;
