-- Reliability record: remember when someone declines a shift they had
-- accepted (a late drop). Everything else in the record comes from rows the
-- portal already keeps. Earlier late drops were not recorded, so they start
-- counting from today.

alter table public.event_assignments add column if not exists dropped_at timestamptz;
create index if not exists event_assignments_dropped_idx on public.event_assignments (staff_id) where dropped_at is not null;
