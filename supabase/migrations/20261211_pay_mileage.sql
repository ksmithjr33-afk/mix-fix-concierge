-- Staff pay estimates: mileage stored per assignment, and the mileage settings.
--
-- assignment_mileage: one way miles from the person's home to the event, stored
-- when they accept so the number does not drift, and any adjustment an admin or
-- manager made for that one person on that one event. Kept apart from
-- event_assignments so no assignment list ever carries pay. Server only.

begin;

create table if not exists public.assignment_mileage (
  assignment_id    uuid         primary key references public.event_assignments (id) on delete cascade,
  session_id       text         not null references public.sessions (id) on delete cascade,
  staff_id         uuid         not null references public.staff (id) on delete cascade,
  one_way_miles    numeric(7,1) check (one_way_miles is null or one_way_miles >= 0),
  miles_reason     text         check (miles_reason is null or miles_reason in ('no_address', 'not_found', 'no_event_location')),
  miles_source     text         not null default 'straight_line' check (miles_source in ('straight_line', 'driving')),
  locked_at        timestamptz,
  override_miles   numeric(7,1) check (override_miles is null or override_miles >= 0),
  override_cents   integer      check (override_cents is null or override_cents >= 0),
  override_note    text         check (override_note is null or length(override_note) <= 300),
  override_by      uuid         references public.staff (id) on delete set null,
  override_by_name text,
  override_at      timestamptz
);
create index if not exists assignment_mileage_session_idx on public.assignment_mileage (session_id);

alter table public.assignment_mileage enable row level security;
revoke all on public.assignment_mileage from anon, authenticated;

-- Threshold 20 miles one way, 20 miles off the round trip once, $0.30 a mile, $0.40 in California.
insert into public.team_settings (key, value)
values ('business_mileage', '{"thresholdMiles": 20, "deductionMiles": 20, "rateCents": 30, "caRateCents": 40}'::jsonb)
on conflict (key) do nothing;

commit;
