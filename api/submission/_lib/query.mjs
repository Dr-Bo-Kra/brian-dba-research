/**
 * Parameterised query adapter for the submission API (Node.js only).
 * Uses SUBMISSION_DATABASE_URL with the submission_inserter role.
 * Rejects service-role and researcher_api connection strings.
 */
import pg from 'pg';
import { assertBoundQuery, UNIQUE_VIOLATION } from './db.mjs';

export const QUERY_ERROR_CATEGORIES = Object.freeze([
  'authentication_failed',
  'permission_denied',
  'connection_failed',
  'query_failed',
  'unique_violation',
]);

const AUTH_CODES = new Set(['28P01', '28000']);
const PERMISSION_CODES = new Set(['42501']);
const NETWORK_CODES = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ENETUNREACH', 'ECONNRESET']);
const TLS_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'CERT_HAS_EXPIRED',
  'CERT_UNTRUSTED',
  'CERT_SIGNATURE_FAILURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_TLS_HANDSHAKE_TIMEOUT',
  'ERR_SSL_WRONG_VERSION_NUMBER',
  'ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR',
]);

function unavailable(reason, extra = {}) {
  return Object.assign(new Error('unavailable'), { code: 'unavailable', reason, ...extra });
}

export function classifyQueryError(err) {
  const existing = String(err?.category || '');
  if (QUERY_ERROR_CATEGORIES.includes(existing)) return existing;
  const code = String(err?.code || '').toUpperCase();
  if (code === UNIQUE_VIOLATION) return 'unique_violation';
  if (AUTH_CODES.has(code)) return 'authentication_failed';
  if (PERMISSION_CODES.has(code)) return 'permission_denied';
  if (code.startsWith('08')) return 'connection_failed';
  if (NETWORK_CODES.has(code)) return 'connection_failed';
  if (TLS_CODES.has(code)) return 'connection_failed';
  return 'query_failed';
}

export function wrapQuery(rawQuery) {
  if (typeof rawQuery !== 'function') return null;
  return async function query(statement, params = []) {
    const spec = typeof statement === 'string' ? { text: statement } : statement;
    assertBoundQuery(spec);
    if (!Array.isArray(params)) {
      throw Object.assign(new Error('invalid_query'), { code: 'unavailable' });
    }
    return rawQuery(spec.text, params, spec.name);
  };
}

export function assertSubmissionDatabaseUrl(url) {
  const value = String(url || '').trim();
  if (!value) throw unavailable('database_url_required');
  if (!/^postgres(ql)?:\/\//i.test(value)) throw unavailable('invalid_database_url');
  if (/service[_-]?role/i.test(value) || /supabase_admin/i.test(value)) {
    throw unavailable('forbidden_database_role');
  }
  if (/researcher_api/i.test(value)) {
    throw unavailable('forbidden_database_role');
  }
  // Require the dedicated insert-only role — denylist alone is not enough.
  // Allow Supabase pooler usernames: submission_inserter.<project_ref>
  if (
    !/^postgres(ql)?:\/\/submission_inserter(?:\.[A-Za-z0-9_-]+)?(?::|@)/i.test(
      value
    )
  ) {
    throw unavailable('forbidden_database_role');
  }
  return value;
}

function isLocalDatabaseUrl(connectionString) {
  return /localhost|127\.0\.0\.1|::1/i.test(String(connectionString || ''));
}

export function normalizeDatabaseCaCert(raw) {
  let value = String(raw || '').trim();
  if (!value) return '';
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1).trim();
  }
  return value.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n').replace(/\r\n/g, '\n');
}

function isPemCertificate(value) {
  const begin = value.indexOf('-----BEGIN CERTIFICATE-----');
  const end = value.indexOf('-----END CERTIFICATE-----');
  if (begin < 0 || end < 0 || end <= begin) return false;
  const body = value
    .slice(begin + '-----BEGIN CERTIFICATE-----'.length, end)
    .replace(/\s+/g, '');
  return body.length > 0;
}

export function sslConfigForDatabase(config = {}) {
  const connectionString = String(config.databaseUrl || '');
  if (!connectionString || isLocalDatabaseUrl(connectionString)) {
    return false;
  }
  const ca = normalizeDatabaseCaCert(config.databaseCaCert);
  if (!ca) {
    throw unavailable('database_ca_required', { category: 'connection_failed' });
  }
  if (!isPemCertificate(ca)) {
    throw unavailable('invalid_database_ca', { category: 'connection_failed' });
  }
  return { rejectUnauthorized: true, ca };
}

export function createSubmissionPostgresAdapter(config = {}) {
  const connectionString = assertSubmissionDatabaseUrl(config.databaseUrl);
  const ssl = sslConfigForDatabase({ ...config, databaseUrl: connectionString });
  const pool = new pg.Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 5000,
    allowExitOnIdle: true,
    ssl,
  });
  return wrapQuery(async (text, params) => {
    try {
      return await pool.query({ text, values: params });
    } catch (err) {
      if (String(err?.code) === UNIQUE_VIOLATION) {
        throw Object.assign(new Error('duplicate'), {
          code: 'duplicate',
          category: 'unique_violation',
          pgCode: UNIQUE_VIOLATION,
        });
      }
      throw Object.assign(new Error('unavailable'), {
        code: 'unavailable',
        category: classifyQueryError(err),
      });
    }
  });
}

export function createProductionQueryAdapter(config = {}) {
  if (!config?.databaseUrl) return null;
  try {
    return createSubmissionPostgresAdapter(config);
  } catch {
    return null;
  }
}

export function resolveQueryAdapter(config, overrides = {}) {
  if (Object.prototype.hasOwnProperty.call(overrides, 'query')) {
    return overrides.query ? wrapQuery(overrides.query) : null;
  }
  if (overrides.allowMemoryStores === true) return null;
  if (config.rateLimitStore === 'database' && config.databaseUrl) {
    return createProductionQueryAdapter(config);
  }
  return null;
}
