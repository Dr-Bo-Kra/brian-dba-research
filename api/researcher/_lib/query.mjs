/**
 * Parameterised query adapter for the Vercel Node runtime.
 *
 * Client: `pg` (node-postgres). Chosen because it is a server-only Node
 * driver, uses bound parameters (`$1`), and works with Supabase's
 * transaction pooler. It is not Edge-compatible, which is intentional:
 * OIDC, HMAC cookies, and this driver stay on the Node.js runtime.
 *
 * The browser never imports this module. The service-role key is rejected.
 * Named prepared statements are not sent (transaction-mode poolers reject them).
 */
import pg from 'pg';
import { assertBoundQuery } from './db.mjs';

export const QUERY_ERROR_CATEGORIES = Object.freeze([
  'authentication_failed',
  'permission_denied',
  'connection_failed',
  'query_failed',
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
  if (AUTH_CODES.has(code)) return 'authentication_failed';
  if (PERMISSION_CODES.has(code)) return 'permission_denied';
  if (code.startsWith('08')) return 'connection_failed';
  if (NETWORK_CODES.has(code)) return 'connection_failed';
  if (TLS_CODES.has(code)) return 'connection_failed';
  return 'query_failed';
}

export function unavailableFromQueryError(err) {
  return unavailable('database_query_failed', { category: classifyQueryError(err) });
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

export function assertServerDatabaseUrl(url) {
  const value = String(url || '').trim();
  if (!value) throw unavailable('database_url_required');
  if (!/^postgres(ql)?:\/\//i.test(value)) throw unavailable('invalid_database_url');
  if (/service[_-]?role/i.test(value) || /supabase_admin/i.test(value)) {
    throw unavailable('forbidden_database_role');
  }
  return value;
}

function sslForConnection(connectionString) {
  if (/localhost|127\.0\.0\.1/i.test(connectionString)) return false;
  return { rejectUnauthorized: true };
}

export function createSupabasePostgresAdapter(config = {}) {
  const connectionString = assertServerDatabaseUrl(config.databaseUrl);
  const pool = new pg.Pool({
    connectionString,
    max: 1,
    idleTimeoutMillis: 5000,
    connectionTimeoutMillis: 5000,
    allowExitOnIdle: true,
    ssl: sslForConnection(connectionString),
  });
  return wrapQuery(async (text, params) => {
    try {
      return await pool.query({ text, values: params });
    } catch (err) {
      throw unavailableFromQueryError(err);
    }
  });
}

export function createProductionQueryAdapter(config = {}) {
  if (!config?.databaseUrl) return null;
  try {
    return createSupabasePostgresAdapter(config);
  } catch {
    return null;
  }
}

export function resolveQueryAdapter(config, overrides = {}) {
  if (overrides.query) return wrapQuery(overrides.query);
  if (overrides.allowMemoryStores === true) return null;
  if (overrides.useProductionDriver === true && config.databaseUrl) {
    return createProductionQueryAdapter(config);
  }
  if (config.sessionStore === 'database' && config.databaseUrl) {
    return null;
  }
  return null;
}

export function createPostgresQueryAdapter(config) {
  if (!config || !config.databaseUrl) {
    throw unavailable('driver_requires_database_url');
  }
  return createSupabasePostgresAdapter(config);
}
