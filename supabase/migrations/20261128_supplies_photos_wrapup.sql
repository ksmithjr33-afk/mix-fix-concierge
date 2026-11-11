-- Supplies from the Shopping list, bar setup photos, and the end of night wrap up.
--
-- 1. staff_supply_views: the supplies list as each bartender last saw it, for
--    the "Updated" note on their Supplies tab.
-- 2. order_sheet_meta.recipe_edits: recipe edits for this event only (display
--    only, never a quantity). staff_list_sent and staff_list_pending_at: the
--    bartenders' list before a burst of admin edits inside 48 hours of the
--    event, until the cron texts assigned staff what changed.
-- 3. bar_ready_reports.removed_at: up to 4 bar setup photos per person, with
--    retake and remove. Removed photos stay in the private bucket and stop
--    showing. Earlier "replaced" photos are marked removed so only the latest shows.
-- 4. event_closeouts: the wrap up inventory (supplies, equipment, client
--    alcohol) and who reviewed it. Reviewed locks it for the bartender.
-- Server only (service role), like the other team tables.

begin;

create table if not exists public.staff_supply_views (
  staff_id   uuid        not null references public.staff (id) on delete cascade,
  session_id text        not null references public.sessions (id) on delete cascade,
  items      jsonb       not null default '[]'::jsonb,
  seen_at    timestamptz not null default now(),
  primary key (staff_id, session_id)
);
alter table public.staff_supply_views enable row level security;
revoke all on public.staff_supply_views from anon, authenticated;

alter table public.order_sheet_meta add column if not exists recipe_edits jsonb not null default '{}'::jsonb;
alter table public.order_sheet_meta add column if not exists staff_list_sent jsonb;
alter table public.order_sheet_meta add column if not exists staff_list_pending_at timestamptz;

alter table public.bar_ready_reports add column if not exists removed_at timestamptz;
update public.bar_ready_reports r
   set removed_at = r.created_at
 where r.removed_at is null
   and exists (
     select 1 from public.bar_ready_reports n
      where n.session_id = r.session_id and n.staff_id = r.staff_id and n.created_at > r.created_at
   );

alter table public.event_closeouts add column if not exists supplies jsonb not null default '[]'::jsonb;
alter table public.event_closeouts add column if not exists equipment jsonb not null default '[]'::jsonb;
alter table public.event_closeouts add column if not exists alcohol_left boolean;
alter table public.event_closeouts add column if not exists alcohol_note text not null default '';
alter table public.event_closeouts add column if not exists reviewed_at timestamptz;
alter table public.event_closeouts add column if not exists reviewed_by uuid references public.staff (id) on delete set null;
alter table public.event_closeouts add column if not exists reviewed_by_name text;

commit;
