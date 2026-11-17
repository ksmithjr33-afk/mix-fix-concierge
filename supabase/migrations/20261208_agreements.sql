-- Client agreements: the signed agreement and change orders, uploaded on the
-- manager view by admins and managers. More than one file per event, each
-- with an optional label. They carry pricing: server only, and the app shows
-- them to admins and managers only. Files live in the private
-- event-agreements bucket (PDF, PNG, JPG, 15 MB), opened only through short
-- signed links. Safe to run twice.

begin;

create table if not exists public.event_agreements (
  id               uuid        primary key default gen_random_uuid(),
  session_id       text        not null references public.sessions (id) on delete cascade,
  file_path        text        not null,
  file_type        text        not null,
  file_name        text,
  size_bytes       integer,
  label            text        check (label is null or length(label) <= 80),
  status           text        not null default 'pending' check (status in ('pending', 'current', 'replaced', 'removed')),
  uploaded_by      uuid        references public.staff (id) on delete set null,
  uploaded_by_name text,
  replaces_id      uuid        references public.event_agreements (id) on delete set null,
  removed_at       timestamptz,
  removed_by_name  text,
  created_at       timestamptz not null default now()
);
create index if not exists event_agreements_session on public.event_agreements (session_id, status);

alter table public.event_agreements enable row level security;
revoke all on public.event_agreements from anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('event-agreements', 'event-agreements', false, 15728640, array['application/pdf', 'image/png', 'image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

commit;
