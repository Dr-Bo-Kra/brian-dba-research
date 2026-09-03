-- Lending Desk assessment responses (Brian E Pereira DBA research)
-- Run through a controlled database migration before enabling collection.
--
-- Intended architecture:
--   Participant browser → protected submission API → this table
--   → protected researcher API → authenticated Inquiry Archive
--   Supabase authenticated dashboard remains administrative/fallback access.
--
-- Security model:
--   • browsers have no direct table privileges and no anon key
--   • a protected server/Edge endpoint validates and rate-limits submissions
--   • the endpoint inserts with a server-side credential
--   • researchers review completed results only through a private
--     authenticated dashboard workflow, never through public or anonymous reads
--   • live collection stays disabled until the endpoint and institutional
--     approvals are complete

create extension if not exists "pgcrypto";

create table if not exists public.assessment_responses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  instrument_id text not null,
  client_record_id text,
  profile jsonb not null default '{}'::jsonb,
  responses jsonb not null default '{}'::jsonb,
  assessment jsonb not null default '{}'::jsonb,
  privacy_notice_version text,
  consented_at timestamptz
);

alter table public.assessment_responses
  add column if not exists privacy_notice_version text,
  add column if not exists consented_at timestamptz,
  add column if not exists legal_hold boolean not null default false,
  add column if not exists anonymised_at timestamptz;

comment on column public.assessment_responses.legal_hold is
  'Institutional legal hold. When true, API deletion must refuse the row. Policy is not defined in this repository.';
comment on column public.assessment_responses.anonymised_at is
  'Set when an approved retention process irreversibly anonymises the row. The retention period itself is a launch blocker.';

-- Older drafts stored browser user-agent and page URL. Do not collect them.
alter table public.assessment_responses drop column if exists user_agent;
alter table public.assessment_responses drop column if exists page_url;

comment on table public.assessment_responses is
  'Pseudonymous DBA research submissions received through the protected submission endpoint. Authorised researchers review rows in the private authenticated dashboard; the public site has no table read path.';
comment on column public.assessment_responses.client_record_id is
  'Random participant reference used for deduplication, withdrawal, and researcher deletion before anonymisation.';
comment on column public.assessment_responses.privacy_notice_version is
  'Participant information notice version acknowledged at consent.';
comment on column public.assessment_responses.consented_at is
  'Timestamp of recorded research-participation consent.';

create unique index if not exists assessment_responses_client_record_id_uidx
  on public.assessment_responses (client_record_id)
  where client_record_id is not null;
create index if not exists assessment_responses_created_at_idx
  on public.assessment_responses (created_at desc);
create index if not exists assessment_responses_instrument_id_idx
  on public.assessment_responses (instrument_id);

-- NOT VALID avoids breaking a migration if historical rows predate these
-- controls, while still enforcing each constraint for every new row.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'assessment_instrument_allowed') then
    alter table public.assessment_responses
      add constraint assessment_instrument_allowed
      check (instrument_id = 'brian-dba-inclusive-lending-desk-v3') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'assessment_reference_format') then
    alter table public.assessment_responses
      add constraint assessment_reference_format
      check (client_record_id ~ '^resp_[0-9a-f-]{32,36}$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'assessment_consent_required') then
    alter table public.assessment_responses
      add constraint assessment_consent_required
      check (consented_at is not null and length(privacy_notice_version) between 1 and 40) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'assessment_profile_size') then
    alter table public.assessment_responses
      add constraint assessment_profile_size
      check (octet_length(profile::text) <= 12000) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'assessment_responses_size') then
    alter table public.assessment_responses
      add constraint assessment_responses_size
      check (octet_length(responses::text) <= 60000) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'assessment_scores_size') then
    alter table public.assessment_responses
      add constraint assessment_scores_size
      check (octet_length(assessment::text) <= 24000) not valid;
  end if;
end $$;

alter table public.assessment_responses enable row level security;
alter table public.assessment_responses force row level security;

drop policy if exists "anon_insert_assessment_responses" on public.assessment_responses;
drop policy if exists "anon_select_assessment_responses" on public.assessment_responses;
drop policy if exists "authenticated_select_assessment_responses" on public.assessment_responses;

revoke all privileges on table public.assessment_responses from anon;
revoke all privileges on table public.assessment_responses from authenticated;

create table if not exists public.authorised_researchers (
  id uuid primary key default gen_random_uuid(),
  auth_subject text not null unique,
  role text not null,
  mfa_required boolean not null default true,
  revoked_at timestamptz,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint authorised_researchers_role_allowed
    check (role in ('authorised_researcher', 'researcher_admin'))
);

comment on table public.authorised_researchers is
  'Server-side directory of authorised researcher identities. Lookup is by opaque IdP subject and role. Do not use a person name or email as an application access check. Deny by default when no active row exists.';
comment on column public.authorised_researchers.auth_subject is
  'Opaque identity-provider subject. Not a browser-side email allowlist.';

alter table public.authorised_researchers enable row level security;
alter table public.authorised_researchers force row level security;
revoke all privileges on table public.authorised_researchers from anon;
revoke all privileges on table public.authorised_researchers from authenticated;

create table if not exists public.researcher_sessions (
  id text primary key,
  auth_subject text not null,
  mfa_ok boolean not null default false,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.researcher_sessions is
  'Server-side researcher sessions. The browser receives only an HttpOnly cookie wrapping the session id, never a database credential.';

alter table public.researcher_sessions enable row level security;
alter table public.researcher_sessions force row level security;
revoke all privileges on table public.researcher_sessions from anon;
revoke all privileges on table public.researcher_sessions from authenticated;

alter table public.authorised_researchers
  add column if not exists disabled_at timestamptz;

create table if not exists public.researcher_auth_states (
  state text primary key,
  nonce text not null,
  code_verifier text not null,
  transaction_id text not null default '',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.researcher_auth_states
  add column if not exists transaction_id text not null default '';

comment on table public.researcher_auth_states is
  'Short-lived MFA login tickets. Server-side only. May hold encrypted Auth bootstrap material. Never store plaintext tokens, MFA secrets, TOTP codes, or survey answers.';

alter table public.researcher_auth_states enable row level security;
alter table public.researcher_auth_states force row level security;
revoke all privileges on table public.researcher_auth_states from anon;
revoke all privileges on table public.researcher_auth_states from authenticated;

create table if not exists public.researcher_rate_limits (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  hit_count integer not null
);

comment on table public.researcher_rate_limits is
  'Durable researcher API rate-limit buckets keyed by server-observed connection identity, not client headers.';

alter table public.researcher_rate_limits enable row level security;
alter table public.researcher_rate_limits force row level security;
revoke all privileges on table public.researcher_rate_limits from anon;
revoke all privileges on table public.researcher_rate_limits from authenticated;

create table if not exists public.researcher_audit_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id text not null,
  action text not null,
  participant_reference text,
  detail jsonb not null default '{}'::jsonb
);

alter table public.researcher_audit_events
  add column if not exists actor_role text;

alter table public.researcher_audit_events enable row level security;
alter table public.researcher_audit_events force row level security;

revoke all privileges on table public.researcher_audit_events from anon;
revoke all privileges on table public.researcher_audit_events from authenticated;

comment on table public.researcher_audit_events is
  'Append-oriented access log for the protected researcher API. Do not store survey answers. Initial-release dashboard review uses processor logs until this API is approved.';

create or replace function public.reject_researcher_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit events cannot be changed';
end;
$$;

drop trigger if exists researcher_audit_events_no_update on public.researcher_audit_events;
create trigger researcher_audit_events_no_update
  before update or delete on public.researcher_audit_events
  for each row
  execute procedure public.reject_researcher_audit_mutation();

-- Least-privilege application roles (created by the operator; skipped if absent).
-- submission_inserter: INSERT into assessment_responses only.
-- researcher_api: SELECT research rows + INSERT audit + session use. No public grants.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'submission_inserter') then
    grant insert (
      instrument_id, client_record_id, profile, responses, assessment,
      privacy_notice_version, consented_at
    ) on table public.assessment_responses to submission_inserter;
  end if;
end $$;

create or replace function public.delete_assessment_by_reference(p_ref text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_ref !~ '^resp_[0-9a-f-]{32,36}$' then
    return;
  end if;
  delete from public.assessment_responses
   where client_record_id = p_ref
     and legal_hold is not true
     and anonymised_at is null;
end;
$$;

revoke all on function public.delete_assessment_by_reference(text) from public;
revoke all on function public.delete_assessment_by_reference(text) from anon;
revoke all on function public.delete_assessment_by_reference(text) from authenticated;

-- Trust boundary for researcher_api:
--   Browser roles (anon, authenticated) have no grants and no policies.
--   The Vercel Node process connects as researcher_api with DATABASE_URL.
--   FORCE RLS stays on. This role is not BYPASSRLS. Access is GRANT plus
--   role-scoped policies below — not a public or browser SELECT policy.
--   The Inquiry Archive browser never receives this connection string.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'researcher_api') then
    grant usage on schema public to researcher_api;
    grant select on table public.assessment_responses to researcher_api;
    grant select on table public.authorised_researchers to researcher_api;
    grant select, insert, update, delete on table public.researcher_sessions to researcher_api;
    grant select, insert, update on table public.researcher_auth_states to researcher_api;
    grant select, insert, update on table public.researcher_rate_limits to researcher_api;
    grant insert on table public.researcher_audit_events to researcher_api;
    revoke all on function public.delete_assessment_by_reference(text) from researcher_api;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'researcher_api') then
    drop policy if exists researcher_api_select_assessment_responses on public.assessment_responses;
    create policy researcher_api_select_assessment_responses
      on public.assessment_responses
      for select
      to researcher_api
      using (anonymised_at is null);

    drop policy if exists researcher_api_select_authorised_researchers on public.authorised_researchers;
    create policy researcher_api_select_authorised_researchers
      on public.authorised_researchers
      for select
      to researcher_api
      using (true);

    drop policy if exists researcher_api_select_sessions on public.researcher_sessions;
    drop policy if exists researcher_api_insert_sessions on public.researcher_sessions;
    drop policy if exists researcher_api_update_sessions on public.researcher_sessions;
    drop policy if exists researcher_api_delete_sessions on public.researcher_sessions;
    create policy researcher_api_select_sessions
      on public.researcher_sessions for select to researcher_api using (true);
    create policy researcher_api_insert_sessions
      on public.researcher_sessions for insert to researcher_api with check (true);
    create policy researcher_api_update_sessions
      on public.researcher_sessions for update to researcher_api using (true) with check (true);
    create policy researcher_api_delete_sessions
      on public.researcher_sessions for delete to researcher_api using (expires_at < now());

    drop policy if exists researcher_api_select_auth_states on public.researcher_auth_states;
    drop policy if exists researcher_api_insert_auth_states on public.researcher_auth_states;
    drop policy if exists researcher_api_update_auth_states on public.researcher_auth_states;
    create policy researcher_api_select_auth_states
      on public.researcher_auth_states for select to researcher_api using (true);
    create policy researcher_api_insert_auth_states
      on public.researcher_auth_states for insert to researcher_api with check (true);
    create policy researcher_api_update_auth_states
      on public.researcher_auth_states for update to researcher_api using (true) with check (true);

    drop policy if exists researcher_api_select_rate_limits on public.researcher_rate_limits;
    drop policy if exists researcher_api_insert_rate_limits on public.researcher_rate_limits;
    drop policy if exists researcher_api_update_rate_limits on public.researcher_rate_limits;
    drop policy if exists researcher_api_write_rate_limits on public.researcher_rate_limits;
    create policy researcher_api_select_rate_limits
      on public.researcher_rate_limits for select to researcher_api using (true);
    create policy researcher_api_insert_rate_limits
      on public.researcher_rate_limits for insert to researcher_api with check (true);
    create policy researcher_api_update_rate_limits
      on public.researcher_rate_limits for update to researcher_api using (true) with check (true);

    drop policy if exists researcher_api_insert_audit on public.researcher_audit_events;
    create policy researcher_api_insert_audit
      on public.researcher_audit_events
      for insert
      to researcher_api
      with check (true);
  end if;
end $$;

-- Do not add a public, anonymous, or authenticated PostgREST read or insert
-- policy. Browsers must never SELECT or INSERT these tables.
-- Do not publish a Realtime channel on assessment_responses.
--
-- Researcher review (initial release / fallback):
--   Authorised researchers use the authenticated Supabase dashboard with
--   MFA, least privilege, and a role-based identity model. Brian may be
--   the only provisioned authorised researcher at first. Application code
--   must not hard-code his name or email as an access check. There is no
--   public SELECT policy and the service-role key must not reach the browser.
--
-- Protected researcher API (Vercel Node, fail-closed until secrets exist):
--   Privileged reads happen only from the trusted researcher API using the
--   researcher_api database role. The Inquiry Archive browser talks only to
--   that API with an HttpOnly session cookie. Never the service-role key.
--
-- Administrator bootstrap (password stays in a secret manager, not Git):
--   1. In the Supabase SQL editor, create the login role. Do not paste a
--      real password into any file in this repository:
--        create role researcher_api login password '<from-secret-manager>';
--   2. Grant database connect if the platform requires it:
--        grant connect on database postgres to researcher_api;
--   3. Re-run this schema file so the grants and researcher_api RLS policies
--      above apply. Do not grant BYPASSRLS, CREATEROLE, or table ownership.
--   4. Issue a pooled connection URI for researcher_api (transaction pooler
--      for Vercel Node). Store it as the server-only DATABASE_URL secret.
--   5. Do not create a browser anon/authenticated policy for survey data.
--
-- Inquiry archive (researcher/):
--   Future interface. Keep it disconnected until the protected researcher
--   API is implemented (not merely scaffolded), authorisation is live,
--   institutional approval permits its use, and the host can protect the
--   route. GitHub Pages cannot. Crawl hints are not access controls.
--
-- Public survey submissions:
--   A separate protected endpoint should validate an allowlisted Origin,
--   enforce Content-Type and a request-size cap, rate-limit abuse, reject
--   unexpected fields (including user_agent and page_url), and insert with
--   a server-side credential.
