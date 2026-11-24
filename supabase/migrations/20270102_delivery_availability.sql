-- Deliveries and pickups on the staff profile, and admin edits held for the team.
--
-- 1. staff_profiles: structured deliveries and pickups, replacing the free
--    text dropoff_time (kept, read only, until the person saves the section).
--      delivery_windows          per weekday (mon .. sun): { receive: { on, from, to },
--                                pickup: { on, from, to } }, from and to in
--                                minutes after midnight
--      home_type                 house or apartment
--      handoff_pref              delivery, pickup, or either
--      delivery_notes            one short line
--      availability_confirmed_at the last "Still correct for this week" or save
--                                by the person themself; confirmed for a week
--                                when it falls on or after that week's Monday
--                                (Chicago)
--    The weekly deadline is a team_settings row (delivery_confirm_deadline),
--    Wednesday 6 PM Central when not set. The Wednesday reminder is claimed in
--    team_notices (delivery_confirm:<monday>:<staff id>), so no new table.
--
-- 2. event_updates: admin and manager edits are saved right away but held
--    from staff until someone presses Notify the team or Do not notify.
--      staff_notice         null (client changes and rows from before this:
--                           already handled), 'held', 'sent', or 'skipped'
--      staff_notice_at      when it was sent or skipped
--      staff_notice_by      who pressed the button
--      held_reminded_at     the one reminder to the editor (2 hours unsent, or
--                           inside 48 hours of the event)
--
-- Server only (service role), like the other team tables. Safe to run twice.

begin;

alter table public.staff_profiles add column if not exists delivery_windows jsonb;
alter table public.staff_profiles add column if not exists home_type text;
alter table public.staff_profiles add column if not exists handoff_pref text;
alter table public.staff_profiles add column if not exists delivery_notes text;
alter table public.staff_profiles add column if not exists availability_confirmed_at timestamptz;

alter table public.staff_profiles drop constraint if exists staff_profiles_home_type_check;
alter table public.staff_profiles add constraint staff_profiles_home_type_check check (home_type is null or home_type in ('house', 'apartment'));
alter table public.staff_profiles drop constraint if exists staff_profiles_handoff_pref_check;
alter table public.staff_profiles add constraint staff_profiles_handoff_pref_check check (handoff_pref is null or handoff_pref in ('delivery', 'pickup', 'either'));
alter table public.staff_profiles drop constraint if exists staff_profiles_delivery_notes_check;
alter table public.staff_profiles add constraint staff_profiles_delivery_notes_check check (delivery_notes is null or length(delivery_notes) <= 120);

alter table public.event_updates add column if not exists staff_notice text;
alter table public.event_updates add column if not exists staff_notice_at timestamptz;
alter table public.event_updates add column if not exists staff_notice_by uuid references public.staff (id) on delete set null;
alter table public.event_updates add column if not exists held_reminded_at timestamptz;

alter table public.event_updates drop constraint if exists event_updates_staff_notice_check;
alter table public.event_updates add constraint event_updates_staff_notice_check check (staff_notice is null or staff_notice in ('held', 'sent', 'skipped'));

create index if not exists event_updates_held_idx on public.event_updates (session_id) where staff_notice = 'held';

commit;
