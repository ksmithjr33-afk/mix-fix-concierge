-- Bartender pay by tier on service fee events.
--
--   event_assignments.accepted_rate_cents  the service fee rate that applied
--                                          when the person accepted the event:
--                                          they are never paid less on it
--   time_approvals.rate_cents              the rate used when the hours were
--   time_approvals.rate_reason             approved (Top, Core, Developing, not
--                                          placed, new hire, accepted, own,
--                                          support), so a later tier or settings
--                                          change never rewrites past pay
--
-- Service fee events only: gratuity model events never write these. Server
-- only (service role), like the other team tables. Until this runs, accepts
-- and approvals still work, without the stored rates. Safe to run twice.

begin;

alter table public.event_assignments add column if not exists accepted_rate_cents integer check (accepted_rate_cents is null or accepted_rate_cents > 0);
alter table public.time_approvals add column if not exists rate_cents integer check (rate_cents is null or rate_cents > 0);
alter table public.time_approvals add column if not exists rate_reason text check (rate_reason is null or rate_reason in ('top', 'core', 'developing', 'not_placed', 'new_hire', 'accepted', 'own', 'support'));

commit;
