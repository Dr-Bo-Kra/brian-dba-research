-- Lending Desk assessment responses (Brian E Pereira DBA research)
-- Run this once in the Supabase SQL Editor (Dashboard → SQL → New query).
--
-- Security model:
--   • anon (public site) may INSERT only
--   • anon may NOT SELECT / UPDATE / DELETE
--   • Researcher reads rows via Dashboard or service_role key (never ship service_role to the browser)

create extension if not exists "pgcrypto";

create table if not exists public.assessment_responses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  instrument_id text not null,
  client_record_id text,
  profile jsonb not null default '{}'::jsonb,
  responses jsonb not null default '{}'::jsonb,
  assessment jsonb not null default '{}'::jsonb,
  user_agent text,
  page_url text
);

comment on table public.assessment_responses is
  'Lending Desk game assessment submissions from the public research site.';

comment on column public.assessment_responses.responses is
  'Gameplay telemetry / case decisions (formerly local JSON gameplay blob).';

comment on column public.assessment_responses.client_record_id is
  'Optional id from the browser record (resp_…) for dedupe / local cross-ref.';

create index if not exists assessment_responses_created_at_idx
  on public.assessment_responses (created_at desc);

create index if not exists assessment_responses_instrument_id_idx
  on public.assessment_responses (instrument_id);

alter table public.assessment_responses enable row level security;

-- Drop policies if re-running this script
drop policy if exists "anon_insert_assessment_responses" on public.assessment_responses;
drop policy if exists "anon_select_assessment_responses" on public.assessment_responses;

-- Allow anonymous inserts from the static site (Supabase anon key)
create policy "anon_insert_assessment_responses"
  on public.assessment_responses
  for insert
  to anon
  with check (true);

-- Explicitly no SELECT for anon (researcher uses dashboard / service_role).
-- If a SELECT policy for anon ever existed, the drop above removes it.
-- Authenticated users also get no public SELECT by default under RLS.

-- Optional: allow authenticated researchers to read (uncomment if you use Auth)
-- create policy "authenticated_select_assessment_responses"
--   on public.assessment_responses
--   for select
--   to authenticated
--   using (true);

grant usage on schema public to anon, authenticated;
grant insert on table public.assessment_responses to anon;
-- Do not grant SELECT to anon
revoke select on table public.assessment_responses from anon;
grant select, insert on table public.assessment_responses to authenticated;
