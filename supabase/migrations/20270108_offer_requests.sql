-- Ranked shift offers need approval (lib/team/offers-db.ts): taking an offer
-- is a request that holds one spot until an admin or manager approves it or
-- passes. Requests use the existing "held" step status and claim kind, so the
-- only new thing stored is the pay floor:
--
-- offer_steps.requested_rate_cents  the service fee rate that applied when the
--                                   person requested the shift; approving
--                                   stores it as event_assignments.accepted_rate_cents.
--                                   Null on gratuity events.
--
-- The 2 hour reminder is claimed in team_notices (offer_request_reminder:<step id>).
-- Until this runs, requests and approvals still work; the floor is then the
-- rate at approval.
--
-- Server only (service role), like the other team tables. Safe to run twice.

begin;

alter table public.offer_steps add column if not exists requested_rate_cents integer check (requested_rate_cents is null or requested_rate_cents >= 0);

commit;
