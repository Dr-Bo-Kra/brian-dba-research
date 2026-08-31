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

function unavailable(reason) {
  return Object.assign(new Error('unavailable'), { code: 'unavailable', reason });
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
    } catch {
      throw unavailable('database_query_failed');
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
