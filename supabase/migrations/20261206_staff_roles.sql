-- Staff types: admin, manager, bartender, bar back, server, event helper.
-- Safe to run twice.
--
-- Managers can do everything an admin can, except deactivate or remove an
-- admin, change an admin's role, or make someone an admin (checked in the
-- app's server code). Bar backs, servers and event helpers get the bartender
-- experience. Existing rows keep their role; nobody changes until an admin
-- picks a new role on the Staff page.

begin;

-- The inline check from 20261110_team_portal.sql is named staff_role_check.
alter table public.staff drop constraint if exists staff_role_check;
alter table public.staff add constraint staff_role_check
  check (role in ('admin', 'manager', 'bartender', 'bar_back', 'server', 'event_helper'));

-- Reopening an approved timesheet row: admins and managers.
create or replace function public.reopen_timesheet_row(p_assignment_id uuid, p_reopened_by uuid, p_reason text)
returns public.time_reopens
language plpgsql as $$
declare
  ap public.time_approvals;
  r  public.time_reopens;
begin
  if not exists (select 1 from public.staff where id = p_reopened_by and role in ('admin', 'manager') and active) then
    raise exception 'only an admin or manager can reopen a timesheet row';
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

revoke all on function public.reopen_timesheet_row(uuid, uuid, text) from public;
revoke all on function public.reopen_timesheet_row(uuid, uuid, text) from anon, authenticated;
grant execute on function public.reopen_timesheet_row(uuid, uuid, text) to service_role;

commit;
