-- The staff "Shopping list for this event" on the Supplies tab.
--
-- 1. order_sheet_stores.kind: what kind of source each store is, so staff see
--    lines under plain headings: supply ("Bring from your supply"), delivery
--    ("Being delivered"), or pickup ("Pick up"). Existing stores get the kind
--    their name suggests (the app does the same while kind is empty). Admins
--    change it on Manage stores.
-- 2. A "Bring from your supply" store, added only when no store is a supply
--    store yet, in the first palette color nobody uses.
-- 3. order_sheet_answers: what each person on the event says about a line:
--    "have" (I have it, I already have this) or "out" (I'm out), and an
--    optional note of up to 80 characters, with who and when. store is the
--    line's store when they answered: an "I'm out" stops counting on the admin
--    badge once the line's store changes, or once an admin dismisses it.
-- 4. order_sheet_ready_texts: the one "shopping list is ready" text per person
--    per event, so it is never sent twice. pending rows wait for quiet hours.
-- Server only (service role), like the other team tables. Safe to run twice.

begin;

alter table public.order_sheet_stores add column if not exists kind text;
alter table public.order_sheet_stores drop constraint if exists order_sheet_stores_kind_check;
alter table public.order_sheet_stores add constraint order_sheet_stores_kind_check check (kind is null or kind in ('supply', 'delivery', 'pickup'));

update public.order_sheet_stores set kind = case
    when name ~* '\m(supply|supplies|stock|inventory|on hand|bring)\M' then 'supply'
    when name ~* '\m(deliver|delivery|delivered|deliveries|amazon|shipped|shipping|instacart)\M' then 'delivery'
    else 'pickup'
  end
 where kind is null;

insert into public.order_sheet_stores (name, color, position, retired, kind)
select 'Bring from your supply', c.color, (select coalesce(max(position), 0) + 1 from public.order_sheet_stores), false, 'supply'
  from (values (1, '#E0201B'), (2, '#1F4FE0'), (3, '#008080'), (4, '#7030A0'), (5, '#FFB3D9'), (6, '#BFBFBF'), (7, '#8B5A2B'),
               (8, '#808000'), (9, '#1E7B34'), (10, '#1F2A6B'), (11, '#FF9900'), (12, '#00FFFF'), (13, '#C000C0'), (14, '#00FF00'), (15, '#FFFF00')) as c (i, color)
 where not exists (select 1 from public.order_sheet_stores where kind = 'supply' and not retired)
   and not exists (select 1 from public.order_sheet_stores s where upper(s.color) = c.color)
   and not exists (select 1 from public.order_sheet_stores s where lower(s.name) = 'bring from your supply' and not s.retired)
 order by c.i
 limit 1;

create table if not exists public.order_sheet_answers (
  id                uuid        primary key default gen_random_uuid(),
  session_id        text        not null references public.sessions (id) on delete cascade,
  line_ref          text        not null,
  staff_id          uuid        not null references public.staff (id) on delete cascade,
  answer            text        check (answer is null or answer in ('have', 'out')),
  note              text        not null default '' check (char_length(note) <= 80),
  store             text,
  dismissed_at      timestamptz,
  dismissed_by_name text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (session_id, line_ref, staff_id)
);
create index if not exists order_sheet_answers_session_idx on public.order_sheet_answers (session_id);

create table if not exists public.order_sheet_ready_texts (
  id         uuid        primary key default gen_random_uuid(),
  session_id text        not null references public.sessions (id) on delete cascade,
  staff_id   uuid        not null references public.staff (id) on delete cascade,
  status     text        not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'failed')),
  manual     boolean     not null default false,
  created_at timestamptz not null default now(),
  send_after timestamptz not null default now(),
  sent_at    timestamptz,
  unique (session_id, staff_id)
);
create index if not exists order_sheet_ready_texts_due on public.order_sheet_ready_texts (status, send_after);

alter table public.order_sheet_answers enable row level security;
revoke all on public.order_sheet_answers from anon, authenticated;
alter table public.order_sheet_ready_texts enable row level security;
revoke all on public.order_sheet_ready_texts from anon, authenticated;

commit;
