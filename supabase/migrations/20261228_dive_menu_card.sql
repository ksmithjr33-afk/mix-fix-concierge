-- Dive Bar menu card on request (2026-11-20).
--
-- Dive Bar has no printed menu unless the client asks for a menu card
-- (event_data.dive_menu_card true). From now on the app keeps
-- event_menu_pickups.not_needed in step with the card on every save
-- (lib/dive-menu-pickup-db.ts). This backfills submitted Dive Bar events that
-- already exist: no card and no older printed menu request means
-- "No printed menu for this event".
--
-- Rows an admin already gave a person, or marked picked up, are left alone.
-- No schema change: dive_menu_card lives in sessions.event_data.

insert into public.event_menu_pickups (session_id, not_needed, updated_at)
select s.id, true, now()
from public.sessions s
where s.status = 'submitted'
  and lower(coalesce(s.event_data->>'package', s.package_type, '')) like '%dive%'
  and coalesce(s.event_data->>'dive_menu_card', 'false') <> 'true'
  and coalesce(s.event_data->>'dive_menu_requested', 'false') <> 'true'
on conflict (session_id) do update
  set not_needed = true, updated_at = now()
  where public.event_menu_pickups.not_needed = false
    and public.event_menu_pickups.assignee_id is null
    and public.event_menu_pickups.picked_up_at is null;
