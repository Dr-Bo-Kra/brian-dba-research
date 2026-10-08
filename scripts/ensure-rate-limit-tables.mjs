/**
 * Idempotent operator script: ensure researcher + submission rate-limit tables,
 * FORCE RLS, and role grants/policies exist. Does not enable collection.
 *
 * Uses SYNTHETIC_OPERATOR_DATABASE_URL only (never researcher_api / submission_inserter).
 * Never prints secrets.
 *
 * Usage: node scripts/ensure-rate-limit-tables.mjs
 */
import pg from 'pg';
import { loadOperatorEnv, logOperatorDatabaseIdentity } from './lib/load-operator-env.mjs';
import { normalizeDatabaseCaCert } from '../api/researcher/_lib/query.mjs';

function isPemCertificate(value) {
  const begin = value.indexOf('-----BEGIN CERTIFICATE-----');
  const end = value.indexOf('-----END CERTIFICATE-----');
  if (begin < 0 || end < 0 || end <= begin) return false;
  const body = value
    .slice(begin + '-----BEGIN CERTIFICATE-----'.length, end)
    .replace(/\s+/g, '');
  return body.length > 0;
}

const DDL = `
create table if not exists public.researcher_rate_limits (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  hit_count integer not null
);

alter table public.researcher_rate_limits enable row level security;
alter table public.researcher_rate_limits force row level security;
revoke all privileges on table public.researcher_rate_limits from anon;
revoke all privileges on table public.researcher_rate_limits from authenticated;

create table if not exists public.submission_rate_limits (
  bucket_key text primary key,
  window_started_at timestamptz not null,
  hit_count integer not null
);

alter table public.submission_rate_limits enable row level security;
alter table public.submission_rate_limits force row level security;
revoke all privileges on table public.submission_rate_limits from anon;
revoke all privileges on table public.submission_rate_limits from authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'researcher_api') then
    grant usage on schema public to researcher_api;
    grant select, insert, update on table public.researcher_rate_limits to researcher_api;
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
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'submission_inserter') then
    grant usage on schema public to submission_inserter;
    grant select, insert, update on table public.submission_rate_limits to submission_inserter;
    revoke all privileges on table public.researcher_rate_limits from submission_inserter;
    drop policy if exists submission_inserter_select_rate_limits on public.submission_rate_limits;
    drop policy if exists submission_inserter_insert_rate_limits on public.submission_rate_limits;
    drop policy if exists submission_inserter_update_rate_limits on public.submission_rate_limits;
    create policy submission_inserter_select_rate_limits
      on public.submission_rate_limits for select to submission_inserter using (true);
    create policy submission_inserter_insert_rate_limits
      on public.submission_rate_limits for insert to submission_inserter with check (true);
    create policy submission_inserter_update_rate_limits
      on public.submission_rate_limits for update to submission_inserter using (true) with check (true);
  end if;
end $$;
`;

const VERIFY = `
select c.relname as table_name,
       has_table_privilege('researcher_api', c.oid, 'INSERT') as researcher_insert,
       has_table_privilege('submission_inserter', c.oid, 'INSERT') as submission_insert
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname in ('researcher_rate_limits', 'submission_rate_limits')
 order by 1;
`;

function sslFor(url, caRaw) {
  if (/localhost|127\.0\.0\.1|::1/i.test(url)) return false;
  const ca = normalizeDatabaseCaCert(caRaw || '');
  if (!ca || !isPemCertificate(ca)) {
    throw new Error('DATABASE_CA_CERT (or SUPABASE_DB_CA) PEM required for non-local operator URL');
  }
  return { rejectUnauthorized: true, ca };
}

async function main() {
  const loadedFrom = loadOperatorEnv();
  const url = String(process.env.SYNTHETIC_OPERATOR_DATABASE_URL || '').trim();
  if (!url) {
    console.error('Missing SYNTHETIC_OPERATOR_DATABASE_URL (operator only). Refusing.');
    process.exit(2);
  }
  if (/researcher_api|submission_inserter/i.test(url)) {
    console.error('Refusing application-role URL; need elevated operator credential.');
    process.exit(2);
  }
  logOperatorDatabaseIdentity(loadedFrom, { source: 'operator' });

  const ca = process.env.DATABASE_CA_CERT || process.env.SUPABASE_DB_CA || '';
  const pool = new pg.Pool({
    connectionString: url,
    max: 1,
    ssl: sslFor(url, ca),
    connectionTimeoutMillis: 15_000,
  });

  try {
    await pool.query(DDL);
    const { rows } = await pool.query(VERIFY);
    console.log('Rate-limit tables ready (names + privilege flags only):');
    for (const row of rows) {
      console.log(
        `  ${row.table_name}: researcher_insert=${row.researcher_insert} submission_insert=${row.submission_insert}`
      );
    }
    if (rows.length < 2) {
      console.error('Expected both rate-limit tables after DDL.');
      process.exit(1);
    }
    console.log('OK — rate-limit DDL applied; collection flags unchanged.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('ensure-rate-limit-tables failed:', err?.code || err?.message || 'error');
  process.exit(1);
});
