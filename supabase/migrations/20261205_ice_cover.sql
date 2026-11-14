-- Ice pickup: "I picked up the ice instead", covering for someone. Safe to run twice.
--
-- When someone on the event picks up the ice in place of a person assigned to
-- it, that person's row is marked picked up and covered_by says who covered.
-- The row then counts as done, so the ice is complete without an admin
-- removing anyone.

begin;

alter table public.event_ice_pickup_people add column if not exists covered_by uuid references public.staff (id) on delete set null;
alter table public.event_ice_pickup_people add column if not exists covered_by_name text;

commit;
