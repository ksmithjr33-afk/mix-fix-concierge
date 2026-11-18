-- Staff Scorecard: event ratings (with an edit history), internal reviews,
-- weekly check in calls, the Locked by Tuesday check, and the Payroll setup
-- done tick. Admins and managers only, enforced on the server in
-- lib/team/scorecard-db.ts; staff never see any of it. Nobody can rate,
-- review, call or tick about themselves (checked on the server and below).
--
-- Tier thresholds live in team_settings (key scorecard_tiers), which already
-- exists. Until this runs, every Scorecard page loads empty and saving says
-- the migration is needed. Server only (service role), like the other team
-- tables. No old spreadsheet data is imported.

begin;

-- One rating per person per event. Marks are 1 to 5, blank (null) when unknown.
create table if not exists public.staff_ratings (
  id              uuid        primary key default gen_random_uuid(),
  session_id      text        not null references public.sessions (id) on delete cascade,
  staff_id        uuid        not null references public.staff (id) on delete cascade,
  client          smallint    check (client between 1 and 5),
  admin           smallint    check (admin between 1 and 5),
  efficiency      smallint    check (efficiency between 1 and 5),
  shopping        smallint    check (shopping between 1 and 5),
  leftovers       smallint    check (leftovers between 1 and 5),
  comms           smallint    check (comms between 1 and 5),
  confidence      smallint    check (confidence between 1 and 5),
  mark_notes      jsonb       not null default '{}'::jsonb, -- the note for each mark of 3 or lower
  client_feedback text        not null default '' check (length(client_feedback) <= 2000),
  admin_notes     text        not null default '' check (length(admin_notes) <= 2000),
  rated_by        uuid        references public.staff (id) on delete set null,
  rated_by_name   text,
  rated_at        timestamptz not null default now(),
  updated_by      uuid        references public.staff (id) on delete set null,
  updated_by_name text,
  updated_at      timestamptz not null default now(),
  unique (session_id, staff_id),
  constraint staff_ratings_not_self check (rated_by is null or rated_by <> staff_id),
  constraint staff_ratings_not_self_edit check (updated_by is null or updated_by <> staff_id)
);
create index if not exists staff_ratings_staff_idx on public.staff_ratings (staff_id);

-- Every earlier save of a rating, newest last.
create table if not exists public.staff_rating_versions (
  id          uuid        primary key default gen_random_uuid(),
  rating_id   uuid        not null references public.staff_ratings (id) on delete cascade,
  data        jsonb       not null,
  saved_by    uuid        references public.staff (id) on delete set null,
  saved_by_name text,
  saved_at    timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists staff_rating_versions_rating_idx on public.staff_rating_versions (rating_id);

-- Internal reviews not tied to an event.
create table if not exists public.staff_reviews (
  id          uuid        primary key default gen_random_uuid(),
  staff_id    uuid        not null references public.staff (id) on delete cascade,
  kind        text        not null check (kind in ('praise', 'coaching', 'incident', 'general')),
  review_date date        not null,
  body        text        not null check (length(btrim(body)) between 1 and 4000),
  author_id   uuid        references public.staff (id) on delete set null,
  author_name text,
  created_at  timestamptz not null default now(),
  updated_by  uuid        references public.staff (id) on delete set null,
  updated_by_name text,
  updated_at  timestamptz,
  constraint staff_reviews_not_self check (author_id is null or author_id <> staff_id),
  constraint staff_reviews_not_self_edit check (updated_by is null or updated_by <> staff_id)
);
create index if not exists staff_reviews_staff_idx on public.staff_reviews (staff_id, review_date desc);

-- The weekly check in call, one per person per event.
create table if not exists public.staff_checkin_calls (
  session_id     text        not null references public.sessions (id) on delete cascade,
  staff_id       uuid        not null references public.staff (id) on delete cascade,
  done           boolean     not null default false,
  outcome        text        check (outcome in ('good', 'okay', 'bad')),
  confidence     smallint    check (confidence between 1 and 5),
  notes          text        not null default '' check (length(notes) <= 2000),
  called_by      uuid        references public.staff (id) on delete set null,
  called_by_name text,
  called_at      timestamptz,
  updated_at     timestamptz not null default now(),
  primary key (session_id, staff_id),
  constraint staff_checkin_calls_not_self check (called_by is null or called_by <> staff_id)
);

-- Locked by Tuesday, per event.
create table if not exists public.event_week_locks (
  session_id     text        primary key references public.sessions (id) on delete cascade,
  locked         boolean     not null default false,
  locked_by      uuid        references public.staff (id) on delete set null,
  locked_by_name text,
  locked_at      timestamptz
);

-- Payroll setup done, ticked by an admin.
create table if not exists public.staff_setup_flags (
  staff_id         uuid        primary key references public.staff (id) on delete cascade,
  payroll_done     boolean     not null default false,
  payroll_by       uuid        references public.staff (id) on delete set null,
  payroll_by_name  text,
  payroll_at       timestamptz,
  constraint staff_setup_flags_not_self check (payroll_by is null or payroll_by <> staff_id)
);

alter table public.staff_ratings enable row level security;
alter table public.staff_rating_versions enable row level security;
alter table public.staff_reviews enable row level security;
alter table public.staff_checkin_calls enable row level security;
alter table public.event_week_locks enable row level security;
alter table public.staff_setup_flags enable row level security;
revoke all on public.staff_ratings from anon, authenticated;
revoke all on public.staff_rating_versions from anon, authenticated;
revoke all on public.staff_reviews from anon, authenticated;
revoke all on public.staff_checkin_calls from anon, authenticated;
revoke all on public.event_week_locks from anon, authenticated;
revoke all on public.staff_setup_flags from anon, authenticated;

commit;
