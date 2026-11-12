-- Calendar preferences, cocktail menu pickup, and chat notifications inside the app.
--
-- 1. staff_prefs: each person's last calendar view, market filter, and list or
--    calendar layout, so the portal opens the way they left it.
-- 2. event_menu_pickups: where each event's printed cocktail menu is printed,
--    who picks it up, and who checked "Picked up" and when. The undo is kept
--    on the row (undone_by_name, undone_at) and every change goes in
--    event_menu_pickup_log.
-- 3. event_chat_mutes: an admin's "Mute this chat" per event. Unread counts
--    use the existing event_message_reads table.
-- Server only (service role), like the other team tables. Safe to run twice.

begin;

-- ----- 1. Calendar preferences -----
create table if not exists public.staff_prefs (
  staff_id   uuid        primary key references public.staff (id) on delete cascade,
  calendar   jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ----- 2. Cocktail menu pickup -----
create table if not exists public.event_menu_pickups (
  session_id        text        primary key references public.sessions (id) on delete cascade,
  store             text        check (store in ('walmart', 'walgreens', 'other')),
  store_other       text        check (store_other is null or length(store_other) <= 80),
  location_note     text        check (location_note is null or length(location_note) <= 200),
  order_number      text        check (order_number is null or length(order_number) <= 60),
  assignee_id       uuid        references public.staff (id) on delete set null,
  assigned_by       uuid        references public.staff (id) on delete set null,
  assigned_at       timestamptz,
  not_needed        boolean     not null default false,
  picked_up_at      timestamptz,
  picked_up_by      uuid        references public.staff (id) on delete set null,
  picked_up_by_name text,
  undone_at         timestamptz,
  undone_by         uuid        references public.staff (id) on delete set null,
  undone_by_name    text,
  notify_after      timestamptz, -- the assignment text, held for quiet hours
  notified_at       timestamptz,
  updated_at        timestamptz not null default now()
);
create index if not exists event_menu_pickups_assignee on public.event_menu_pickups (assignee_id) where assignee_id is not null;
create index if not exists event_menu_pickups_notify on public.event_menu_pickups (notify_after) where notify_after is not null and notified_at is null;

create table if not exists public.event_menu_pickup_log (
  id         uuid        primary key default gen_random_uuid(),
  session_id text        not null references public.sessions (id) on delete cascade,
  action     text        not null check (action in ('saved', 'assigned', 'not_needed', 'needed', 'picked_up', 'undo')),
  detail     text,
  by_id      uuid        references public.staff (id) on delete set null,
  by_name    text,
  created_at timestamptz not null default now()
);
create index if not exists event_menu_pickup_log_session on public.event_menu_pickup_log (session_id, created_at);

-- ----- 3. Chat mutes -----
create table if not exists public.event_chat_mutes (
  session_id text        not null references public.sessions (id) on delete cascade,
  staff_id   uuid        not null references public.staff (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (session_id, staff_id)
);

-- The unread check reads recent messages by time, and each person's read times.
create index if not exists event_messages_created on public.event_messages (created_at);
create index if not exists event_message_reads_staff on public.event_message_reads (staff_id);

alter table public.staff_prefs enable row level security;
alter table public.event_menu_pickups enable row level security;
alter table public.event_menu_pickup_log enable row level security;
alter table public.event_chat_mutes enable row level security;
revoke all on public.staff_prefs, public.event_menu_pickups, public.event_menu_pickup_log, public.event_chat_mutes from anon, authenticated;

commit;
