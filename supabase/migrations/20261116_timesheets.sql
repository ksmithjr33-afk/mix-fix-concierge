-- Bartender portal, phase 4: timesheets. Approved rows lock: once an
-- assignment has a time_approvals row, its punches and edits cannot be added,
-- changed, or removed, and the approval itself cannot be changed or removed.
-- The own-time rules (time_edits_not_own, time_approvals_not_own,
-- time_punches_own_or_admin) come from phase 3.

begin;

create or replace function public.time_refuse_when_approved() returns trigger
language plpgsql as $$
declare
  aid uuid;
begin
  if tg_op = 'DELETE' then
    aid := old.assignment_id;
  else
    aid := new.assignment_id;
  end if;
  if exists (select 1 from public.time_approvals where assignment_id = aid)
     or (tg_op = 'UPDATE' and exists (select 1 from public.time_approvals where assignment_id = old.assignment_id)) then
    raise exception 'timesheet row % is approved and locked', aid;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists time_punches_locked on public.time_punches;
create trigger time_punches_locked before insert or update or delete on public.time_punches
  for each row execute function public.time_refuse_when_approved();
drop trigger if exists time_edits_locked on public.time_edits;
create trigger time_edits_locked before insert or update or delete on public.time_edits
  for each row execute function public.time_refuse_when_approved();

create or replace function public.time_approvals_final() returns trigger
language plpgsql as $$
begin
  raise exception 'timesheet row % is approved and locked', old.assignment_id;
end;
$$;

drop trigger if exists time_approvals_locked on public.time_approvals;
create trigger time_approvals_locked before update or delete on public.time_approvals
  for each row execute function public.time_approvals_final();

create index if not exists time_approvals_staff_idx on public.time_approvals (staff_id);

commit;
