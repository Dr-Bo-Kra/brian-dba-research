/**
 * Operator-only PostgreSQL helpers for synthetic seed/cleanup scripts.
 *
 * Write paths (real seed/cleanup) require SYNTHETIC_OPERATOR_DATABASE_URL.
 * Inspect/dry-run prefers the operator URL when present, otherwise falls back
 * to DATABASE_URL (researcher_api) for read-only inspection.
 * Application/researcher API code must never import this module's operator URL.
 */
import pg from 'pg';
import {
  assertServerDatabaseUrl,
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

function validateDatabaseUrl(raw) {
  const url = assertServerDatabaseUrl(raw);
  if (/service[_-]?role/i.test(url) || /supabase_admin/i.test(url)) {
    throw new Error('forbidden_database_role');
  }
  return url;
}

/**
 * @deprecated Prefer resolveWriteDatabaseUrl / resolveInspectDatabaseUrl.
 * Kept for callers that expect DATABASE_URL only.
 */
export function resolveDatabaseUrl() {
  return validateDatabaseUrl(process.env.DATABASE_URL || '');
}

/**
 * Real seed/cleanup writes must use the temporary synthetic operator role.
 * @returns {string}
 */
export function resolveWriteDatabaseUrl() {
  const raw = String(process.env.SYNTHETIC_OPERATOR_DATABASE_URL || '').trim();
  if (!raw) {
    throw new Error('synthetic_operator_database_url_required');
  }
  return validateDatabaseUrl(raw);
}

/**
 * Dry-run / inspect: prefer operator URL when set, else researcher DATABASE_URL.
 * @returns {{ url: string, source: 'operator' | 'researcher' }}
 */
export function resolveInspectDatabaseUrl() {
  const operator = String(process.env.SYNTHETIC_OPERATOR_DATABASE_URL || '').trim();
  if (operator) {
    return { url: validateDatabaseUrl(operator), source: 'operator' };
  }
  const researcher = String(process.env.DATABASE_URL || '').trim();
  if (!researcher) {
    throw new Error('database_url_required');
  }
  return { url: validateDatabaseUrl(researcher), source: 'researcher' };
}

/**
 * Create a pool for an already-resolved connection string.
 * Verified TLS / DATABASE_CA_CERT remains mandatory for non-local URLs.
 * @param {string} databaseUrl
 */
export function createOperatorPool(databaseUrl) {
  const connectionString = validateDatabaseUrl(databaseUrl);
  const ssl = sslConfigForDatabase({
    databaseUrl: connectionString,
    databaseCaCert: process.env.DATABASE_CA_CERT || process.env.SUPABASE_DB_CA || '',
  });
  return new pg.Pool({
    connectionString,
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
