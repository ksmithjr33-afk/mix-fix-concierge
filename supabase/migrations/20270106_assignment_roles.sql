-- A role for each person on each event, and the $25 support rate.
--
--   event_assignments.role   the role worked on this event: bartender,
--                            bar_back (Barback), event_helper or server. A
--                            bartender can work an event as a barback or an
--                            event helper. Existing rows get the default from
--                            the person's profile (admins and managers:
--                            bartender) and can be changed on the Team tab.
--                            Service fee pay follows it; gratuity model events
--                            record and show it but pay exactly as before.
--
--   team_settings business_service_fee_rates.support
--                            a support rate saved at $30 becomes $25 (stored in
--                            cents: 3000 becomes 2500). Any other saved number
--                            is left as it is. Gratuity model events never read it.
--
-- Server only (service role), like the other team tables. Until this runs the
-- app reads each person's role from their profile and role changes on the
-- Team tab are refused. Safe to run twice.

begin;

alter table public.event_assignments add column if not exists role text check (role is null or role in ('bartender', 'bar_back', 'event_helper', 'server'));

update public.event_assignments a
   set role = case when s.role in ('bartender', 'bar_back', 'event_helper', 'server') then s.role else 'bartender' end
  from public.staff s
 where s.id = a.staff_id
   and a.role is null;

update public.team_settings
   set value = jsonb_set(value, '{support}', '2500'::jsonb), updated_at = now()
 where key = 'business_service_fee_rates'
   and jsonb_typeof(value -> 'support') = 'number'
   and (value ->> 'support')::numeric = 3000;

commit;
