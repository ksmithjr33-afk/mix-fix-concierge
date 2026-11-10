-- Admin edits of event details from the team portal are marked on the
-- event_updates row, so the team can tell them apart from client changes.

begin;

alter table public.event_updates add column if not exists updated_by text not null default 'client' check (updated_by in ('client', 'admin'));
alter table public.event_updates add column if not exists updated_by_name text;
alter table public.event_updates add column if not exists updated_by_staff_id uuid references public.staff (id) on delete set null;

commit;
