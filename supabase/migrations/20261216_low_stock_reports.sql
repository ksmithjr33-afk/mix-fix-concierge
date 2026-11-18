-- Running low: staff tell the office when they are short on something.
-- kind 'event': tied to an event happening today, texted to admins and
-- managers right away. kind 'kit': no live event (a bartender's own tools or
-- stock for future events), listed in the 9 AM Central summary text.
-- status: open, then on_it (taken_by, taken_at: one person takes it), then
-- resolved (resolved_by, resolved_at). Server only: staff see only their own
-- reports, enforced in lib/team/low-stock-db.ts. Safe to run twice.

begin;

create table if not exists public.low_stock_reports (
  id          uuid        primary key default gen_random_uuid(),
  session_id  text        null references public.sessions (id) on delete set null,
  staff_id    uuid        not null references public.staff (id) on delete cascade,
  item        text        not null check (char_length(item) between 1 and 120),
  level       text        not null check (level in ('low', 'out')),
  note        text        not null default '',
  kind        text        not null check (kind in ('event', 'kit')),
  status      text        not null default 'open' check (status in ('open', 'on_it', 'resolved')),
  taken_by    uuid        null references public.staff (id) on delete set null,
  taken_at    timestamptz null,
  resolved_by uuid        null references public.staff (id) on delete set null,
  resolved_at timestamptz null,
  created_at  timestamptz not null default now()
);

-- The admin list (open, newest first), the Day of tab, the 9 AM summary, and the 30 minute check.
create index if not exists low_stock_reports_open_idx on public.low_stock_reports (created_at desc) where status <> 'resolved';
create index if not exists low_stock_reports_session_idx on public.low_stock_reports (session_id) where session_id is not null;
create index if not exists low_stock_reports_staff_idx on public.low_stock_reports (staff_id, created_at desc);

alter table public.low_stock_reports enable row level security;
revoke all on public.low_stock_reports from anon, authenticated;

commit;
