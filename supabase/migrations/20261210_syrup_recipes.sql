-- Syrup recipes.
--
-- 1. syrup_recipes: the team's library of house made syrups and prep items
--    (simple syrup, honey syrup, ...), added and edited by admins under
--    Syrup recipes. Starts empty: nothing is made up. Each recipe has its
--    ingredients (amount, unit, item), the ratio, the method, the yield (an
--    amount and a unit, used to scale a batch to the event's shopping list
--    amount), a shelf life note, and aliases so a drink's ingredient name finds
--    it ("simple", "1:1 simple syrup"). bought: "Bought, never made": the
--    item is always bought ready made (maple syrup, agave), so every event
--    shows it as Store bought with no recipe and no Recipe needed, whether or
--    not a store is set on its Shopping list line. A bought entry needs no
--    ingredients.
-- 2. order_sheet_meta.syrup_edits: a recipe changed for one event only, keyed
--    by the syrup's name as a slug, like recipe_edits. The library is untouched.
-- Server only (service role), like the other team tables. Safe to run twice.

begin;

create table if not exists public.syrup_recipes (
  id               uuid        primary key default gen_random_uuid(),
  name             text        not null check (length(btrim(name)) between 1 and 80),
  aliases          text[]      not null default '{}',
  ingredients      jsonb       not null default '[]'::jsonb,  -- [{ "amount": 1, "unit": "cup", "item": "sugar" }]
  ratio            text        not null default '',
  method           text        not null default '',
  yield_amount     numeric,
  yield_unit       text        not null default '',
  shelf_life       text        not null default '',
  bought           boolean     not null default false,
  updated_by       uuid        references public.staff (id) on delete set null,
  updated_by_name  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint syrup_recipes_yield_check check (yield_amount is null or yield_amount > 0)
);
create unique index if not exists syrup_recipes_name_idx on public.syrup_recipes (lower(btrim(name)));

-- For a run of an earlier draft of this file; a no-op on a fresh run.
alter table public.syrup_recipes add column if not exists bought boolean not null default false;

alter table public.order_sheet_meta add column if not exists syrup_edits jsonb not null default '{}'::jsonb;

alter table public.syrup_recipes enable row level security;
revoke all on public.syrup_recipes from anon, authenticated;

commit;
