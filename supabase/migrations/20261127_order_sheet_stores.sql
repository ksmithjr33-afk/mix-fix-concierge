-- Order sheet stores become a list the team manages.
--
-- 1. order_sheet_stores: each store's name, highlight color, place in the list,
--    and whether it is retired. Starts with Isabel's five, in her legend order.
--    No two stores share a color (unique index), retired ones included, so an
--    old sheet never shows two stores in one color.
-- 2. order_sheet_lines.store drops its fixed four value check and references
--    the stores table instead. The old values (specs, sams, amazon, walmart) are
--    the ids of the starting stores, so every saved selection carries over as is.
-- 3. "Delivery to event on day of" is now a store. The old per event checkbox
--    (order_sheet_meta.delivery_day_of) is kept, not dropped: a sheet that had it
--    ticked still shows it on the legend until an admin sets it on lines.
-- 4. order_sheet_meta.legend_names: the "(Taylor)" next to each legend entry,
--    per event. order_sheet_stores.last_legend_name is the default for the next event.
-- Server only (service role), like the other team tables.

begin;

create table if not exists public.order_sheet_stores (
  id               text        primary key default gen_random_uuid()::text,
  name             text        not null check (length(btrim(name)) between 1 and 60),
  color            text        not null check (color ~ '^#[0-9A-F]{6}$'),
  position         integer     not null default 0,
  retired          boolean     not null default false,
  last_legend_name text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists order_sheet_stores_color_idx on public.order_sheet_stores (color);
create unique index if not exists order_sheet_stores_name_idx on public.order_sheet_stores (lower(name)) where not retired;

insert into public.order_sheet_stores (id, name, color, position) values
  ('specs',    'Spec''s pickup',               '#FF9900', 1),
  ('sams',     'Sam''s Club delivery',         '#00FFFF', 2),
  ('amazon',   'Amazon',                       '#C000C0', 3),
  ('walmart',  'Walmart pickup',               '#00FF00', 4),
  ('delivery', 'Delivery to event on day of',  '#FFFF00', 5)
on conflict (id) do nothing;

-- Any value outside the list (there should be none) is cleared rather than lost silently to an error.
update public.order_sheet_lines
   set store = null, store_item = null, store_by = null, store_by_name = null, store_at = null
 where store is not null and store not in (select id from public.order_sheet_stores);

alter table public.order_sheet_lines drop constraint if exists order_sheet_lines_store_check;
alter table public.order_sheet_lines drop constraint if exists order_sheet_lines_store_fkey;
alter table public.order_sheet_lines
  add constraint order_sheet_lines_store_fkey foreign key (store) references public.order_sheet_stores (id) on update cascade on delete restrict;

alter table public.order_sheet_meta add column if not exists legend_names jsonb not null default '{}'::jsonb;

alter table public.order_sheet_stores enable row level security;
revoke all on public.order_sheet_stores from anon, authenticated;

commit;
