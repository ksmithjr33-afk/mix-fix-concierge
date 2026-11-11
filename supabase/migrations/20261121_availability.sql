-- Availability and time off: days a staff member cannot work. A row is a
-- single date (start_day = end_day) or a range, in the staff member's own
-- market time zone. Safe to run twice.

create table if not exists public.staff_unavailability (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  start_day date not null,
  end_day date not null,
  note text check (note is null or length(note) <= 200),
  created_at timestamptz not null default now(),
  check (end_day >= start_day),
  check (end_day - start_day < 366)
);

create index if not exists staff_unavailability_staff on public.staff_unavailability (staff_id, end_day);
create index if not exists staff_unavailability_days on public.staff_unavailability (start_day, end_day);

alter table public.staff_unavailability enable row level security;
revoke all on public.staff_unavailability from anon, authenticated;
