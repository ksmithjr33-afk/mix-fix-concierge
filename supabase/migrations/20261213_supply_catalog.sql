-- Supply costs (admins only, enforced on the server): the cost catalog.
-- One row per product: brand, size, cost, store, and aliases (other names the
-- Shopping list uses for it). Matched to each event's "we buy" lines by name.
-- Server only (service role), like the other team tables.

begin;

create table if not exists public.supply_catalog (
  id         uuid        primary key default gen_random_uuid(),
  product    text        not null check (length(product) between 2 and 120),
  brand      text        not null default '' check (length(brand) <= 80),
  size       text        not null default '' check (length(size) <= 60),
  cost_cents integer     not null check (cost_cents >= 0),
  store      text        not null default '' check (length(store) <= 80),
  aliases    text[]      not null default '{}',
  created_by uuid        references public.staff (id) on delete set null,
  updated_by uuid        references public.staff (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists supply_catalog_product_idx on public.supply_catalog (lower(product));

alter table public.supply_catalog enable row level security;
revoke all on public.supply_catalog from anon, authenticated;

commit;
