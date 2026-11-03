-- Track GHL delivery per event_updates row, so the chat route records whether
-- the note and the GHL_UPDATE_WEBHOOK_URL payload went out, and
-- /api/update-webhook can retry only the rows that did not.

begin;

alter table public.event_updates
  add column if not exists note_created    boolean     not null default false,
  add column if not exists webhook_sent    boolean     not null default false,
  add column if not exists webhook_sent_at timestamptz,
  add column if not exists webhook_error   text;

-- Version 1 initial submission rows went to GHL through the intake webhook.
update public.event_updates
set note_created = true,
    webhook_sent = true
where summary = 'Initial submission';

create index if not exists event_updates_unsent_idx
  on public.event_updates (session_id)
  where not webhook_sent;

commit;
