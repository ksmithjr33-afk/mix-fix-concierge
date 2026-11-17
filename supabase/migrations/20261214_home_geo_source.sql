-- Which service found each home address on the map: google, openstreetmap,
-- or none (neither found it). Null for addresses saved before this column,
-- so it is unknown which service found those. Event addresses already record
-- this in sessions.geo_source.

begin;

alter table public.staff_profiles add column if not exists home_geo_source text;

alter table public.staff_profiles drop constraint if exists staff_profiles_home_geo_source_check;
alter table public.staff_profiles add constraint staff_profiles_home_geo_source_check
  check (home_geo_source is null or home_geo_source in ('google', 'openstreetmap', 'none'));

commit;
