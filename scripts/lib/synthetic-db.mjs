/**
 * Operator-only PostgreSQL helpers for synthetic seed/cleanup scripts.
 */
import pg from 'pg';
import {
  assertServerDatabaseUrl,
  normalizeDatabaseCaCert,
  sslConfigForDatabase,
} from '../../api/researcher/_lib/query.mjs';
import {
  SYNTHETIC_REF_SQL_PATTERN,
  assertSchemaShape,
} from './synthetic-batch.mjs';

const SCHEMA_COLUMNS_SQL = `select column_name
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'assessment_responses'`;

export function parseOperatorArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
    confirmSeed: argv.includes('--confirm-synthetic-seed'),
    confirmCleanup: argv.includes('--confirm-synthetic-cleanup'),
  };
}

export function resolveDatabaseUrl() {
  const url = assertServerDatabaseUrl(process.env.DATABASE_URL || '');
  if (/service[_-]?role/i.test(url) || /supabase_admin/i.test(url)) {
    throw new Error('forbidden_database_role');
  }
  return url;
}

export function createOperatorPool() {
  const databaseUrl = resolveDatabaseUrl();
  const ssl = sslConfigForDatabase({
    databaseUrl,
    databaseCaCert: process.env.DATABASE_CA_CERT || process.env.SUPABASE_DB_CA || '',
  });
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 1,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 8000,
    allowExitOnIdle: true,
    ssl,
  });
}

export function safeDatabaseIdentity(databaseUrl) {
  try {
    const parsed = new URL(databaseUrl);
    return {
      host: parsed.hostname,
      port: parsed.port || '5432',
      database: parsed.pathname.replace(/^\//, '') || '(default)',
      user: parsed.username || '(unset)',
      ssl: parsed.searchParams.get('sslmode') || '(driver-config)',
    };
  } catch {
    return { host: '(unparseable)', port: '', database: '', user: '', ssl: '' };
  }
}

export async function verifyAssessmentSchema(client) {
  const result = await client.query(SCHEMA_COLUMNS_SQL);
  assertSchemaShape(result.rows.map((row) => row.column_name));
}

export async function countSyntheticRows(client) {
  const result = await client.query(
    `select count(*)::int as n
       from public.assessment_responses
      where client_record_id ~ $1`,
    [SYNTHETIC_REF_SQL_PATTERN]
  );
  return Number(result.rows[0]?.n) || 0;
}

export async function listSyntheticRows(client) {
  const result = await client.query(
    `select client_record_id, created_at
       from public.assessment_responses
      where client_record_id ~ $1
      order by client_record_id asc`,
    [SYNTHETIC_REF_SQL_PATTERN]
  );
  return result.rows;
}

export { SYNTHETIC_REF_SQL_PATTERN };
