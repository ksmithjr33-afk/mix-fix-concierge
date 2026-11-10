-- Bartender portal, phase 1: staff, text code login, sessions, and checkbox
-- state for the event page checklist and shopping list. Only the server (with
-- the service role key) reads these tables, so RLS is on with no policies.

begin;

create table if not exists public.staff (
  id         uuid        primary key default gen_random_uuid(),
  name       text        not null default '',
  phone      text        not null unique,
  role       text        not null default 'bartender' check (role in ('bartender', 'admin')),
  active     boolean     not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.staff_login_codes (
  id         uuid        primary key default gen_random_uuid(),
  phone      text        not null,
  code_hash  text        not null,
  expires_at timestamptz not null,
  attempts   integer     not null default 0,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists staff_login_codes_phone_idx on public.staff_login_codes (phone, created_at desc);

create table if not exists public.staff_sessions (
  token_hash text        primary key,
  staff_id   uuid        not null references public.staff (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists staff_sessions_staff_idx on public.staff_sessions (staff_id);

-- One row per staff member, event, list, and item name. quantity is the
-- item's quantity when the row was written, so a client update that changes
-- it brings the item back unchecked.
create table if not exists public.staff_checks (
  staff_id   uuid        not null references public.staff (id) on delete cascade,
  session_id text        not null references public.sessions (id) on delete cascade,
  list       text        not null check (list in ('checklist', 'shopping')),
  item_key   text        not null,
  checked    boolean     not null default false,
  quantity   text        not null default '',
  updated_at timestamptz not null default now(),
  primary key (staff_id, session_id, list, item_key)
);

alter table public.staff             enable row level security;
alter table public.staff_login_codes enable row level security;
alter table public.staff_sessions    enable row level security;
alter table public.staff_checks      enable row level security;

commit;
