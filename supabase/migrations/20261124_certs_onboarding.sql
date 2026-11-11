-- Certifications (TABC, California RBS), onboarding steps, and team settings.
-- Certificate files go to a new private bucket that also takes PDFs. Server
-- only (service role), like the other team tables.

create table if not exists public.staff_certifications (
  id          uuid        primary key default gen_random_uuid(),
  staff_id    uuid        not null references public.staff (id) on delete cascade,
  cert_type   text        not null check (cert_type in ('TABC', 'California RBS')),
  file_path   text        not null check (length(file_path) > 0),
  file_type   text        not null,
  expires_on  date        not null,
  status      text        not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text        check (review_note is null or length(review_note) <= 300),
  reviewed_by uuid        references public.staff (id) on delete set null,
  reviewed_at timestamptz,
  uploaded_by uuid        not null references public.staff (id) on delete restrict,
  created_at  timestamptz not null default now(),
  -- Nobody reviews their own certification.
  constraint staff_certifications_not_own_review check (reviewed_by is null or reviewed_by <> staff_id),
  constraint staff_certifications_reject_note check (status <> 'rejected' or length(btrim(coalesce(review_note, ''))) >= 3)
);
create index if not exists staff_certifications_staff on public.staff_certifications (staff_id, cert_type);
create index if not exists staff_certifications_expiry on public.staff_certifications (expires_on) where status in ('approved', 'pending');

create table if not exists public.staff_onboarding (
  staff_id        uuid        not null references public.staff (id) on delete cascade,
  item_id         text        not null check (length(item_id) between 1 and 60),
  acknowledged_at timestamptz not null default now(),
  primary key (staff_id, item_id)
);

create table if not exists public.team_settings (
  key        text        primary key,
  value      jsonb       not null,
  updated_by uuid        references public.staff (id) on delete set null,
  updated_at timestamptz not null default now()
);
-- Enforce certifications starts off: warnings only.
insert into public.team_settings (key, value) values ('enforce_certifications', 'false'::jsonb) on conflict (key) do nothing;

alter table public.staff_certifications enable row level security;
alter table public.staff_onboarding enable row level security;
alter table public.team_settings enable row level security;
revoke all on public.staff_certifications from anon, authenticated;
revoke all on public.staff_onboarding from anon, authenticated;
revoke all on public.team_settings from anon, authenticated;

-- Private bucket for certificates: photos and PDFs, 10 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('staff-documents', 'staff-documents', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do update set public = false, allowed_mime_types = excluded.allowed_mime_types;
