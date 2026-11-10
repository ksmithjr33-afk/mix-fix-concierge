-- New shift texts are queued here so several shifts posted to one market go
-- out as one text, and nothing is sent in quiet hours (9 PM to 8 AM, market
-- time). The cron sends rows whose send_after has passed. Safe to run twice.

create table if not exists public.shift_notices (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.shift_posts(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  market text not null check (market in ('dallas', 'austin', 'houston', 'los_angeles')),
  created_at timestamptz not null default now(),
  send_after timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'sending', 'sent', 'skipped', 'failed')),
  sent_at timestamptz,
  batch_size int,
  unique (post_id, staff_id)
);

create index if not exists shift_notices_due on public.shift_notices (status, send_after);

alter table public.shift_notices enable row level security;
revoke all on public.shift_notices from anon, authenticated;
