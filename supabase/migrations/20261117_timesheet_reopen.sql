-- Reopen an approved timesheet row. Any active admin except the staff member
-- whose time it is can reopen a row, with a reason. Reopening logs who, when
-- and why (and which approval it undid) in time_reopens, then removes the
-- approval so the row can be corrected and approved again.
--
-- The only way to remove an approval is reopen_timesheet_row(): the approval
-- trigger refuses every other delete, and every update. Reopen history cannot
-- be changed or removed.

begin;

create table if not exists public.time_reopens (
  id            uuid        primary key default gen_random_uuid(),
  assignment_id uuid        not null references public.event_assignments (id) on delete restrict,
  staff_id      uuid        not null references public.staff (id) on delete restrict,  -- whose time
  reopened_by   uuid        not null references public.staff (id) on delete restrict,
  reason        text        not null,
  approved_by   uuid        not null references public.staff (id) on delete restrict,  -- the approval it undid
  approved_at   timestamptz not null,
  created_at    timestamptz not null default now(),
  constraint time_reopens_reason_check check (length(btrim(reason)) >= 3),
  constraint time_reopens_not_own check (reopened_by <> staff_id)
);
create index if not exists time_reopens_assignment_idx on public.time_reopens (assignment_id);

-- staff_id always comes from the assignment, so the own-time check cannot be dodged.
drop trigger if exists time_reopens_fill on public.time_reopens;
create trigger time_reopens_fill before insert or update on public.time_reopens
  for each row execute function public.time_fill_from_assignment();

create or replace function public.time_reopens_final() returns trigger
language plpgsql as $$
begin
  raise exception 'reopen history for timesheet row % cannot be changed', old.assignment_id;
end;
$$;
drop trigger if exists time_reopens_locked on public.time_reopens;
create trigger time_reopens_locked before update or delete on public.time_reopens
  for each row execute function public.time_reopens_final();

-- Approvals stay final, except a delete made by reopen_timesheet_row() after it
-- logged a reopen for this exact approval.
create or replace function public.time_approvals_final() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE'
     and current_setting('mixfix.reopening', true) = old.assignment_id::text
     and exists (
       select 1 from public.time_reopens
       where assignment_id = old.assignment_id and approved_by = old.approved_by and approved_at = old.approved_at
     ) then
    return old;
  end if;
  raise exception 'timesheet row % is approved and locked', old.assignment_id;
end;
$$;

create or replace function public.reopen_timesheet_row(p_assignment_id uuid, p_reopened_by uuid, p_reason text)
returns public.time_reopens
language plpgsql as $$
declare
  ap public.time_approvals;
  r  public.time_reopens;
begin
  if not exists (select 1 from public.staff where id = p_reopened_by and role = 'admin' and active) then
    raise exception 'only an admin can reopen a timesheet row';
  end if;
  select * into ap from public.time_approvals where assignment_id = p_assignment_id for update;
  if not found then
    raise exception 'timesheet row % is not approved', p_assignment_id;
  end if;
  -- time_reopens_not_own and time_reopens_reason_check refuse your own time and a missing reason.
  insert into public.time_reopens (assignment_id, staff_id, reopened_by, reason, approved_by, approved_at)
  values (p_assignment_id, ap.staff_id, p_reopened_by, btrim(coalesce(p_reason, '')), ap.approved_by, ap.approved_at)
  returning * into r;
  perform set_config('mixfix.reopening', p_assignment_id::text, true);
  delete from public.time_approvals where assignment_id = p_assignment_id;
  perform set_config('mixfix.reopening', '', true);
  return r;
end;
$$;

-- Server only: the app calls this with the service role.
revoke all on function public.reopen_timesheet_row(uuid, uuid, text) from public;
revoke all on function public.reopen_timesheet_row(uuid, uuid, text) from anon, authenticated;
grant execute on function public.reopen_timesheet_row(uuid, uuid, text) to service_role;

alter table public.time_reopens enable row level security;

commit;
