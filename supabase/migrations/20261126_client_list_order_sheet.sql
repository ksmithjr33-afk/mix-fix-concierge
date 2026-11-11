-- Client shopping list auto send and the order sheet.
--
-- 1. Two team settings: "Auto send client shopping list" (off) and "Suggest
--    stores on order sheets" (on).
-- 2. client_list_state: the list each client was last sent, so an update only
--    sends when the list changed, and the summary says what changed.
-- 3. client_list_holds: client changes inside six days that would change the
--    list, and first lists of events with a custom recipe, waiting on an admin.
-- 4. client_list_log: every send and hold, with who approved it.
-- 5. order_sheet_lines and order_sheet_meta: the order sheet's hand edits,
--    stores, Ordered checks, added lines, and note, per event only.
-- Server only (service role), like the other team tables.

begin;

insert into public.team_settings (key, value) values ('auto_send_client_shopping_list', 'false'::jsonb) on conflict (key) do nothing;
insert into public.team_settings (key, value) values ('order_sheet_store_suggestions', 'true'::jsonb) on conflict (key) do nothing;

create table if not exists public.client_list_state (
  session_id    text        primary key references public.sessions (id) on delete cascade,
  last_list     jsonb,
  released      boolean     not null default true,
  first_sent_at timestamptz,
  last_sent_at  timestamptz,
  updated_at    timestamptz not null default now()
);

create table if not exists public.client_list_holds (
  id              uuid        primary key default gen_random_uuid(),
  session_id      text        not null references public.sessions (id) on delete cascade,
  created_at      timestamptz not null default now(),
  kind            text        not null check (kind in ('change', 'custom_recipe')),
  status          text        not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  partial         jsonb,
  changes         jsonb,
  summary         text,
  list_changes    text,
  price           jsonb,
  base_version    integer,
  decided_by      uuid        references public.staff (id) on delete set null,
  decided_by_name text,
  decided_at      timestamptz
);
create index if not exists client_list_holds_session_idx on public.client_list_holds (session_id, status);

create table if not exists public.client_list_log (
  id          uuid        primary key default gen_random_uuid(),
  session_id  text        not null references public.sessions (id) on delete cascade,
  created_at  timestamptz not null default now(),
  action      text        not null check (action in ('sent', 'held', 'approved', 'declined', 'not_sent')),
  reason      text        check (reason in ('first', 'updated', 'approved')),
  detail      text        not null default '',
  changes     text,
  list_text   text,
  update_id   uuid        references public.event_updates (id) on delete set null,
  hold_id     uuid        references public.client_list_holds (id) on delete set null,
  by_staff_id uuid        references public.staff (id) on delete set null,
  by_name     text,
  dry_run     boolean     not null default false,
  version     integer
);
create index if not exists client_list_log_session_idx on public.client_list_log (session_id, created_at);
create index if not exists client_list_log_update_idx on public.client_list_log (update_id);

create table if not exists public.order_sheet_lines (
  id              uuid        primary key default gen_random_uuid(),
  session_id      text        not null references public.sessions (id) on delete cascade,
  line_key        text,
  section         text        not null check (section in ('liquor', 'mixers', 'produce', 'baseline', 'ice')),
  kind            text        not null check (kind in ('calc', 'added')),
  name            text,
  quantity        text,
  size            text,
  detail          text,
  base            jsonb,
  removed         boolean     not null default false,
  store           text        check (store in ('walmart', 'sams', 'amazon', 'specs')),
  store_item      text,
  store_by        uuid        references public.staff (id) on delete set null,
  store_by_name   text,
  store_at        timestamptz,
  ordered         boolean     not null default false,
  ordered_by      uuid        references public.staff (id) on delete set null,
  ordered_by_name text,
  ordered_at      timestamptz,
  edited_by       uuid        references public.staff (id) on delete set null,
  edited_by_name  text,
  edited_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
-- One saved row per calculated line per event. Added lines have no key.
create unique index if not exists order_sheet_lines_key_idx on public.order_sheet_lines (session_id, line_key) where line_key is not null;
-- Store suggestions look up the last store an item was given on any event.
create index if not exists order_sheet_lines_store_idx on public.order_sheet_lines (store_item, store_at) where store is not null;

create table if not exists public.order_sheet_meta (
  session_id       text        primary key references public.sessions (id) on delete cascade,
  note             text        not null default '',
  note_by          uuid        references public.staff (id) on delete set null,
  note_by_name     text,
  note_at          timestamptz,
  delivery_day_of  boolean     not null default false,
  delivery_by_name text,
  delivery_at      timestamptz,
  updated_at       timestamptz not null default now()
);

alter table public.client_list_state enable row level security;
alter table public.client_list_holds enable row level security;
alter table public.client_list_log enable row level security;
alter table public.order_sheet_lines enable row level security;
alter table public.order_sheet_meta enable row level security;
revoke all on public.client_list_state from anon, authenticated;
revoke all on public.client_list_holds from anon, authenticated;
revoke all on public.client_list_log from anon, authenticated;
revoke all on public.order_sheet_lines from anon, authenticated;
revoke all on public.order_sheet_meta from anon, authenticated;

commit;
