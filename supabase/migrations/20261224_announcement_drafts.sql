-- Announcement drafts. Safe to run twice.
--
-- A draft is kept apart from public.announcements on purpose: it has no
-- recipient rows, so it can never text anyone, add to an unread count, or show
-- to staff. Sending a draft creates a normal announcement and marks the draft
-- sent. Deleting marks it deleted, so an autosave still in flight can never
-- bring it back.

create table if not exists public.announcement_drafts (
  id              uuid        primary key default gen_random_uuid(),
  title           text        not null default '' check (length(title) <= 120),
  body            text        not null default '' check (length(body) <= 2000),
  audience        text        not null default 'everyone' check (audience in ('everyone', 'markets')),
  markets         text[]      not null default '{}' check (markets <@ array['dallas', 'austin', 'houston', 'los_angeles']::text[]),
  bartenders_only boolean     not null default false,
  send_now        boolean     not null default false,
  attachment_id   uuid        references public.team_attachments (id) on delete set null,
  status          text        not null default 'draft' check (status in ('draft', 'sending', 'sent', 'deleted')),
  announcement_id uuid        references public.announcements (id) on delete set null,
  created_by      uuid        references public.staff (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_by      uuid        references public.staff (id) on delete set null,
  updated_at      timestamptz not null default now()
);
create index if not exists announcement_drafts_open on public.announcement_drafts (updated_at desc) where status = 'draft';

alter table public.announcement_drafts enable row level security;
revoke all on public.announcement_drafts from anon, authenticated;
