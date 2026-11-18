-- Receipts: one place per event where receipts are uploaded, reviewed, and
-- tied to reimbursements and event costs.
--
-- 1. event_receipts: one row per receipt on one event. Who paid is a staff
--    member (paid_by 'staff', staff_id set, with their assignment) or the
--    company (paid_by 'company', staff_id null). Type is ice, menu printing,
--    supplies or other; the amount is in cents; one to six photos live in the
--    private bar-photos bucket under receipts/<event>/<uploader>/..., the same
--    bucket, size limit, photo types and phone resizing as bar setup photos,
--    and are only shown through short lived signed links after the access
--    check. Status is submitted, approved, or not_approved (with a reason the
--    staff member sees). Deleting keeps the row (deleted_at) and the files.
-- 2. payroll_reimbursements.receipt_id: approving a staff receipt creates the
--    reimbursement for that person on that event, linked here. Reopening the
--    receipt removes it, unless that person's line is already marked paid.
--    The reimbursement types gain 'supplies' (only ever from a receipt).
--
-- Rules, all enforced on the server in lib/team/receipts-db.ts:
--   staff upload, edit and delete only their own, only while Submitted, and
--   only until 14 days after the event; they never read anyone else's.
--   Admins and managers read and upload every receipt and choose the payer.
--   Approving, Not approved and reopening are admins only (never managers).
--
-- Run after 20261219_payroll_reimbursements.sql. Until this runs, every page
-- loads with no receipts and uploading says the migration is needed. Server
-- only (service role), like the other team tables.

begin;

create table if not exists public.event_receipts (
  id               uuid         primary key default gen_random_uuid(),
  session_id       text         not null references public.sessions (id) on delete restrict,
  paid_by          text         not null check (paid_by in ('staff', 'company')),
  staff_id         uuid         references public.staff (id) on delete restrict,
  assignment_id    uuid         references public.event_assignments (id) on delete set null,
  kind             text         not null check (kind in ('ice', 'menu_printing', 'supplies', 'other')),
  amount_cents     integer      not null check (amount_cents > 0 and amount_cents <= 500000),
  note             text         not null default '' check (length(note) <= 200),
  photo_paths      text[]       not null check (cardinality(photo_paths) between 1 and 6),
  status           text         not null default 'submitted' check (status in ('submitted', 'approved', 'not_approved')),
  reason           text         not null default '' check (length(reason) <= 200),
  uploaded_by      uuid         references public.staff (id) on delete set null,
  uploaded_by_name text,
  created_at       timestamptz  not null default now(),
  updated_at       timestamptz,
  reviewed_by      uuid         references public.staff (id) on delete set null,
  reviewed_by_name text,
  reviewed_at      timestamptz,
  deleted_at       timestamptz,
  deleted_by       uuid         references public.staff (id) on delete set null,
  constraint event_receipts_payer check ((paid_by = 'staff') = (staff_id is not null)),
  constraint event_receipts_reason check (status <> 'not_approved' or length(trim(reason)) > 0)
);

create index if not exists event_receipts_session_idx on public.event_receipts (session_id, created_at desc) where deleted_at is null;
create index if not exists event_receipts_staff_idx on public.event_receipts (staff_id, created_at desc) where deleted_at is null;
create index if not exists event_receipts_status_idx on public.event_receipts (status) where deleted_at is null;

alter table public.event_receipts enable row level security;
revoke all on public.event_receipts from anon, authenticated;

-- The reimbursement an approved staff receipt created: one at most.
alter table public.payroll_reimbursements
  add column if not exists receipt_id uuid references public.event_receipts (id) on delete set null;
create unique index if not exists payroll_reimbursements_receipt_uniq on public.payroll_reimbursements (receipt_id) where receipt_id is not null;

alter table public.payroll_reimbursements drop constraint if exists payroll_reimbursements_kind_check;
alter table public.payroll_reimbursements
  add constraint payroll_reimbursements_kind_check check (kind in ('ice', 'menu_printing', 'supplies', 'other'));

commit;
