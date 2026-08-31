import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createResearcherApp } from '../api/researcher/_lib/app.mjs';
import { loadConfig } from '../api/researcher/_lib/config.mjs';
import { assertBoundQuery } from '../api/researcher/_lib/db.mjs';
import {
  DIAGNOSTIC_SQL,
  DIAGNOSTIC_TABLES,
  isDbDiagnosticAllowed,
  logDiagnosticFailure,
  runDbDiagnostic,
} from '../api/researcher/_lib/db-diagnostic.mjs';
import { classifyQueryError, unavailableFromQueryError } from '../api/researcher/_lib/query.mjs';
import {
  handleVercelResearcherRequest,
  resetResearcherAppForTests,
} from '../api/researcher/_vercel.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const SECRET_URL =
  'postgresql://researcher_api:diag-secret-do-not-leak@db.abcdefghijkl.supabase.co:6543/postgres';

const SURVEY_FROM =
  /\bfrom\s+(only\s+)?(public\.)?(assessment_responses|authorised_researchers|researcher_sessions|researcher_auth_states|researcher_rate_limits|researcher_audit_events)\b/i;

const EXPECTED_POLICY_NAMES = [
  'researcher_api_select_assessment_responses',
  'researcher_api_select_authorised_researchers',
  'researcher_api_select_sessions',
  'researcher_api_insert_sessions',
  'researcher_api_update_sessions',
  'researcher_api_delete_sessions',
  'researcher_api_select_auth_states',
  'researcher_api_insert_auth_states',
  'researcher_api_update_auth_states',
  'researcher_api_select_rate_limits',
  'researcher_api_insert_rate_limits',
  'researcher_api_update_rate_limits',
  'researcher_api_insert_audit',
];

function closedConfig(extra = {}) {
  return {
    enabled: false,
    exportsEnabled: false,
    deletionsEnabled: false,
    dbDiagnosticEnabled: false,
    vercelEnv: '',
    databaseUrl: SECRET_URL,
    sessionSecret: '',
    authReady: false,
    dataReady: false,
    archivePath: '/researcher/',
    sessionMinutes: 20,
    maxPageSize: 50,
    maxExportRows: 2000,
    rateLimitWindowMs: 60_000,
    rateLimitMax: 60,
    loginRateLimitMax: 10,
    recordRateLimitMax: 20,
    qualitativeRateLimitMax: 10,
    allowedOrigin: '',
    ...extra,
  };
}

function privilegeRow(tableName, flags) {
  return {
    table_name: tableName,
    can_select: false,
    can_insert: false,
    can_update: false,
    can_delete: false,
    can_truncate: false,
    can_references: false,
    can_trigger: false,
    ...flags,
  };
}

function catalogFixture(identity = {}) {
  return {
    database_user: 'researcher_api',
    database_name: 'postgres',
    is_superuser: false,
    bypass_rls: false,
    ...identity,
  };
}

function createCatalogQuery(identityOverrides = {}, extra = {}) {
  const statements = [];
  const identity = catalogFixture(identityOverrides);
  const query = async (statement, params = []) => {
    const text = typeof statement === 'string' ? statement : statement.text;
    statements.push({ text, params });
    if (/select 1 as ok/.test(text)) {
      if (extra.failStage === 'connect') throw extra.failError;
      return { rows: [{ ok: 1 }] };
    }
    if (/current_user as database_user/.test(text)) {
      if (extra.failStage === 'identity') throw extra.failError;
      return { rows: extra.identityRows || [identity] };
    }
    if (/relrowsecurity/.test(text)) {
      if (extra.failStage === 'rls') throw extra.failError;
      return {
        rows: extra.rlsRows || DIAGNOSTIC_TABLES.map((table_name) => ({
          table_name,
          rls: true,
          force_rls: true,
        })),
      };
    }
    if (/has_table_privilege/.test(text)) {
      return {
        rows: extra.privilegeRows || [
          privilegeRow('assessment_responses', { can_select: true }),
          privilegeRow('authorised_researchers', { can_select: true }),
          privilegeRow('researcher_sessions', {
            can_select: true,
            can_insert: true,
            can_update: true,
            can_delete: true,
          }),
          privilegeRow('researcher_auth_states', {
            can_select: true,
            can_insert: true,
            can_update: true,
          }),
          privilegeRow('researcher_rate_limits', {
            can_select: true,
            can_insert: true,
            can_update: true,
          }),
          privilegeRow('researcher_audit_events', { can_insert: true }),
        ],
      };
    }
    if (/aclexplode/.test(text)) {
      return { rows: extra.browserGrantRows || [] };
    }
    if (/pg_policy/.test(text)) {
      return {
        rows: extra.policyRows || EXPECTED_POLICY_NAMES.map((policy_name) => ({ policy_name })),
      };
    }
    if (/has_function_privilege/.test(text)) {
      return { rows: extra.deleteExecuteRows || [{ can_execute: false }] };
    }
    throw new Error('unexpected_diagnostic_sql');
  };
  return { query, statements };
}

function vercelPair({ method = 'GET', url, headers = {} } = {}) {
  const req = {
    method,
    url,
    headers,
    body: '',
    socket: { remoteAddress: '10.0.0.9' },
    async *[Symbol.asyncIterator]() {},
  };
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(status, hdrs) {
      this.statusCode = status;
      this.headers = hdrs;
    },
    end(chunk) {
      this.body = chunk;
    },
  };
  return { req, res };
}

function assertNoSecrets(body) {
  const text = String(body);
  assert.doesNotMatch(text, /diag-secret-do-not-leak/);
  assert.doesNotMatch(text, /DATABASE_URL/);
  assert.doesNotMatch(text, /postgresql:\/\//i);
  assert.doesNotMatch(text, /abcdefghijkl/);
  assert.doesNotMatch(text, /supabase\.co/);
  assert.doesNotMatch(text, /:6543/);
  assert.doesNotMatch(text, /select current_user/i);
  assert.doesNotMatch(text, /has_table_privilege/);
  assert.doesNotMatch(text, /resp_/);
  assert.doesNotMatch(text, /service_role/);
}

test('database diagnostic SQL is catalog-only and bound', () => {
  for (const spec of Object.values(DIAGNOSTIC_SQL)) {
    assertBoundQuery(spec);
    assert.doesNotMatch(spec.text, SURVEY_FROM);
    assert.doesNotMatch(spec.text, /\$\{/);
  }
});

test('diagnostic unavailable by default', async () => {
  const loaded = loadConfig({
    RESEARCHER_API_ENABLED: 'false',
    EXPORTS_ENABLED: 'false',
    DELETIONS_ENABLED: 'false',
    DATABASE_URL: SECRET_URL,
    RESEARCHER_DB_DIAGNOSTIC_ENABLED: 'false',
  });
  assert.equal(loaded.dbDiagnosticEnabled, false);
  assert.equal(loaded.enabled, false);
  assert.equal(isDbDiagnosticAllowed(loaded), false);

  const { query, statements } = createCatalogQuery();
  const app = createResearcherApp({
    allowMemoryStores: true,
    query,
    config: closedConfig(),
  });
  const res = await app.handle({
    method: 'GET',
    url: '/api/researcher/diagnostics/db',
    headers: {},
    ip: '1',
  });
  assert.equal(res.status, 503);
  assert.equal(JSON.parse(res.body).error, 'unavailable');
  assert.equal(statements.length, 0);
  assertNoSecrets(res.body);
  assert.match(res.headers['Cache-Control'], /no-store/);
  assert.notEqual(res.headers['Access-Control-Allow-Origin'], '*');
});

test('diagnostic blocked in Production even when the flag is set', async () => {
  const { query, statements } = createCatalogQuery();
  const app = createResearcherApp({
    allowMemoryStores: true,
    query,
    config: closedConfig({
      dbDiagnosticEnabled: true,
      vercelEnv: 'production',
    }),
  });
  const res = await app.handle({
    method: 'GET',
    url: '/diagnostics/db',
    headers: {},
    ip: '1',
  });
  assert.equal(res.status, 503);
  assert.equal(JSON.parse(res.body).error, 'unavailable');
  assert.equal(JSON.parse(res.body).ok, undefined);
  assert.equal(statements.length, 0);
  assert.equal(
    isDbDiagnosticAllowed({ dbDiagnosticEnabled: true, vercelEnv: 'production' }),
    false
  );
  assert.equal(loadConfig({ VERCEL_ENV: 'production', RESEARCHER_DB_DIAGNOSTIC_ENABLED: 'true' }).vercelEnv, 'production');
});

test('missing DATABASE_URL fails closed', async () => {
  const app = createResearcherApp({
    allowMemoryStores: true,
    query: async () => {
      throw new Error('must-not-run');
    },
    config: closedConfig({
      dbDiagnosticEnabled: true,
      vercelEnv: 'preview',
      databaseUrl: '',
    }),
  });
  const res = await app.handle({
    method: 'GET',
    url: '/diagnostics/db',
    headers: {},
    ip: '1',
  });
  assert.equal(res.status, 503);
  assert.equal(JSON.parse(res.body).error, 'unavailable');
  assertNoSecrets(res.body);
});

test('wrong DB user fails without echoing the identity', async () => {
  const { query, statements } = createCatalogQuery({ database_user: 'postgres' });
  const check = await runDbDiagnostic(query);
  assert.equal(check.ok, false);
  assert.equal(check.stage, 'identity');
  assert.equal(check.category, 'query_failed');
  assert.equal(check.result, undefined);
  assert.equal(statements.some((row) => SURVEY_FROM.test(row.text)), false);

  const app = createResearcherApp({
    allowMemoryStores: true,
    query,
    config: closedConfig({
      dbDiagnosticEnabled: true,
      vercelEnv: 'preview',
    }),
  });
  const res = await app.handle({
    method: 'GET',
    url: '/diagnostics/db',
    headers: {},
    ip: '1',
  });
  assert.equal(res.status, 503);
  assert.deepEqual(JSON.parse(res.body), { ok: false });
  assert.doesNotMatch(res.body, /postgres/);
  assertNoSecrets(res.body);
});

test('correct researcher_api user passes compact catalog checks', async () => {
  const { query, statements } = createCatalogQuery();
  const app = createResearcherApp({
    allowMemoryStores: true,
    query,
    config: closedConfig({
      dbDiagnosticEnabled: true,
      vercelEnv: 'preview',
    }),
  });
  const res = await app.handle({
    method: 'GET',
    url: '/api/researcher/diagnostics/db',
    headers: {},
    ip: '1',
  });
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), {
    ok: true,
    databaseUser: 'researcher_api',
    database: 'postgres',
    superuser: false,
    bypassRls: false,
    rlsVerified: true,
    grantsVerified: true,
  });
  assert.equal(statements.length, 7);
  assert.equal(statements.some((row) => SURVEY_FROM.test(row.text)), false);
  assert.equal(
    statements.some((row) => /select 1 as ok/.test(row.text)),
    true
  );
  assertNoSecrets(res.body);
  assert.match(res.headers['Cache-Control'], /no-store/);
  assert.notEqual(res.headers['Access-Control-Allow-Origin'], '*');
});

test('secret values never appear in diagnostic responses', async () => {
  const { query } = createCatalogQuery({ database_user: 'postgres' });
  const app = createResearcherApp({
    allowMemoryStores: true,
    query,
    config: closedConfig({
      dbDiagnosticEnabled: true,
      vercelEnv: 'preview',
      databaseUrl: SECRET_URL,
      sessionSecret: 'session-secret-must-not-leak',
      oidcClientSecret: 'oidc-secret-must-not-leak',
    }),
  });
  const res = await app.handle({
    method: 'GET',
    url: '/diagnostics/db',
    headers: {},
    ip: '1',
  });
  assertNoSecrets(res.body);
  assert.doesNotMatch(res.body, /session-secret-must-not-leak/);
  assert.doesNotMatch(res.body, /oidc-secret-must-not-leak/);
  const headers = JSON.stringify(res.headers);
  assert.doesNotMatch(headers, /diag-secret-do-not-leak/);
  assert.doesNotMatch(headers, /postgresql:\/\//i);
});

test('no survey-row query is executed by the diagnostic', async () => {
  const { query, statements } = createCatalogQuery();
  const result = await runDbDiagnostic(query);
  assert.equal(result.ok, true);
  assert.ok(statements.length > 0);
  for (const row of statements) {
    assert.doesNotMatch(row.text, SURVEY_FROM);
    assert.doesNotMatch(row.text, /\bcount\s*\(/i);
    assert.doesNotMatch(row.text, /anonymised_at/);
    assert.doesNotMatch(row.text, /client_record_id/);
    assert.doesNotMatch(row.text, /qualitative/);
  }
});

test('normal researcher routes remain unchanged when the diagnostic is enabled', async () => {
  const { query } = createCatalogQuery();
  const app = createResearcherApp({
    allowMemoryStores: true,
    query,
    records: [
      {
        client_record_id: 'resp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        created_at: '2026-08-01T12:00:00.000Z',
        profile: { countryRegion: 'india' },
        assessment: { overall: { score: 5 } },
        legal_hold: false,
      },
    ],
    config: closedConfig({
      enabled: true,
      dbDiagnosticEnabled: true,
      vercelEnv: 'preview',
      sessionSecret: 'test-session-secret-32-bytes-min',
      dataReady: true,
      authReady: true,
    }),
  });
  const summary = await app.handle({
    method: 'GET',
    url: '/v1/summary',
    headers: {},
    ip: '2',
  });
  assert.equal(summary.status, 401);
  assert.doesNotMatch(summary.body, /resp_/);
  const exported = await app.handle({
    method: 'POST',
    url: '/v1/exports',
    headers: {},
    ip: '2',
  });
  assert.ok([401, 403, 503].includes(exported.status));
  const deleted = await app.handle({
    method: 'POST',
    url: '/v1/deletions',
    headers: {},
    ip: '2',
  });
  assert.ok([401, 403, 503].includes(deleted.status));
});

test('collection remains disabled and researcher API stays fail-closed', () => {
  assert.match(read('config.js'), /COLLECTION_ENABLED:\s*false/);
  assert.match(read('config.js'), /SUBMISSION_ENDPOINT:\s*''/);
  assert.match(read('researcher/config.js'), /RESEARCHER_ENDPOINT:\s*''/);
  const example = read('api/researcher/env.example');
  assert.match(example, /RESEARCHER_API_ENABLED=false/);
  assert.match(example, /EXPORTS_ENABLED=false/);
  assert.match(example, /DELETIONS_ENABLED=false/);
  assert.match(example, /RESEARCHER_DB_DIAGNOSTIC_ENABLED=false/);
  const loaded = loadConfig({});
  assert.equal(loaded.enabled, false);
  assert.equal(loaded.exportsEnabled, false);
  assert.equal(loaded.deletionsEnabled, false);
  assert.equal(loaded.dbDiagnosticEnabled, false);
});

test('Vercel Preview rewrite can reach the diagnostic without auth bypass', async () => {
  resetResearcherAppForTests();
  const { query, statements } = createCatalogQuery();
  const app = createResearcherApp({
    allowMemoryStores: true,
    query,
    config: closedConfig({
      dbDiagnosticEnabled: true,
      vercelEnv: 'preview',
    }),
  });
  const rewritten = vercelPair({
    url: '/api/researcher',
    headers: { 'x-forwarded-uri': '/api/researcher/diagnostics/db' },
  });
  const result = await handleVercelResearcherRequest(rewritten.req, rewritten.res, { app });
  assert.equal(result.status, 200);
  assert.equal(JSON.parse(result.body).databaseUser, 'researcher_api');
  assert.equal(statements.some((row) => SURVEY_FROM.test(row.text)), false);
  assertNoSecrets(result.body);
  assert.match(result.headers['Cache-Control'], /no-store/);
  assert.notEqual(result.headers['Access-Control-Allow-Origin'], '*');

  const protectedData = await handleVercelResearcherRequest(
    ...Object.values(vercelPair({ url: '/api/researcher/v1/summary' })),
    { app }
  );
  assert.ok([401, 403, 503].includes(protectedData.status));
  assert.doesNotMatch(String(protectedData.body), /resp_/);
});

function leakyError(code, extra = {}) {
  return Object.assign(new Error('password authentication failed for user "researcher_api" at db.abcdefghijkl.supabase.co:6543'), {
    code,
    detail: SECRET_URL,
    hint: 'check DATABASE_URL postgresql://researcher_api:diag-secret-do-not-leak@db.abcdefghijkl.supabase.co:6543/postgres',
    ...extra,
  });
}

async function withCapturedErrors(fn) {
  const lines = [];
  const original = console.error;
  console.error = (...args) => {
    lines.push(args.map((item) => (typeof item === 'string' ? item : String(item))).join(' '));
  };
  try {
    return { result: await fn(), lines };
  } finally {
    console.error = original;
  }
}

function assertSafeLog(line, stage, category) {
  const payload = JSON.parse(line);
  assert.deepEqual(payload, {
    diagnostic: 'db',
    ok: false,
    stage,
    category,
  });
  assert.deepEqual(Object.keys(payload).sort(), ['category', 'diagnostic', 'ok', 'stage']);
  assertNoSecrets(line);
  assert.doesNotMatch(line, /password authentication failed/);
  assert.doesNotMatch(line, /detail/i);
  assert.doesNotMatch(line, /hint/i);
  assert.doesNotMatch(line, /select 1/);
}

test('connect/auth failure logs stage=connect and stays generic on the wire', async () => {
  const { query } = createCatalogQuery({}, {
    failStage: 'connect',
    failError: leakyError('28P01'),
  });
  const app = createResearcherApp({
    allowMemoryStores: true,
    query,
    config: closedConfig({
      dbDiagnosticEnabled: true,
      vercelEnv: 'preview',
    }),
  });
  const { result, lines } = await withCapturedErrors(() =>
    app.handle({ method: 'GET', url: '/diagnostics/db', headers: {}, ip: '1' })
  );
  assert.equal(result.status, 503);
  assert.deepEqual(JSON.parse(result.body), { ok: false });
  assert.equal(lines.length, 1);
  assertSafeLog(lines[0], 'connect', 'authentication_failed');
  assertNoSecrets(result.body);
});

test('identity query failure logs stage=identity', async () => {
  const { query } = createCatalogQuery({}, {
    failStage: 'identity',
    failError: leakyError('XX000'),
  });
  const check = await runDbDiagnostic(query);
  assert.equal(check.ok, false);
  assert.equal(check.stage, 'identity');
  assert.equal(check.category, 'query_failed');
  const { result, lines } = await withCapturedErrors(() => {
    const app = createResearcherApp({
      allowMemoryStores: true,
      query,
      config: closedConfig({
        dbDiagnosticEnabled: true,
        vercelEnv: 'preview',
      }),
    });
    return app.handle({ method: 'GET', url: '/diagnostics/db', headers: {}, ip: '1' });
  });
  assert.deepEqual(JSON.parse(result.body), { ok: false });
  assertSafeLog(lines[0], 'identity', 'query_failed');
});

test('later RLS failure logs stage=rls', async () => {
  const { query } = createCatalogQuery({}, {
    failStage: 'rls',
    failError: leakyError('42501'),
  });
  const { result, lines } = await withCapturedErrors(() => {
    const app = createResearcherApp({
      allowMemoryStores: true,
      query,
      config: closedConfig({
        dbDiagnosticEnabled: true,
        vercelEnv: 'preview',
      }),
    });
    return app.handle({ method: 'GET', url: '/diagnostics/db', headers: {}, ip: '1' });
  });
  assert.equal(result.status, 503);
  assert.deepEqual(JSON.parse(result.body), { ok: false });
  assertSafeLog(lines[0], 'rls', 'permission_denied');
});

test('SQLSTATE and network/TLS codes map to fixed categories without leaking messages', () => {
  assert.equal(classifyQueryError({ code: '28P01' }), 'authentication_failed');
  assert.equal(classifyQueryError({ code: '28000' }), 'authentication_failed');
  assert.equal(classifyQueryError({ code: '42501' }), 'permission_denied');
  assert.equal(classifyQueryError({ code: '08006' }), 'connection_failed');
  assert.equal(classifyQueryError({ code: '08P01' }), 'connection_failed');
  assert.equal(classifyQueryError({ code: 'ECONNREFUSED' }), 'connection_failed');
  assert.equal(classifyQueryError({ code: 'ETIMEDOUT' }), 'connection_failed');
  assert.equal(classifyQueryError({ code: 'ENOTFOUND' }), 'connection_failed');
  assert.equal(classifyQueryError({ code: 'ENETUNREACH' }), 'connection_failed');
  assert.equal(classifyQueryError({ code: 'ECONNRESET' }), 'connection_failed');
  assert.equal(classifyQueryError({ code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }), 'connection_failed');
  assert.equal(classifyQueryError({ code: 'CERT_HAS_EXPIRED' }), 'connection_failed');
  assert.equal(classifyQueryError({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' }), 'connection_failed');
  assert.equal(classifyQueryError({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }), 'connection_failed');
  assert.equal(classifyQueryError({ code: 'SELF_SIGNED_CERT_IN_CHAIN' }), 'connection_failed');
  assert.equal(classifyQueryError({ code: '42P01', message: SECRET_URL }), 'query_failed');
  assert.equal(classifyQueryError({ code: 'unavailable', category: 'authentication_failed' }), 'authentication_failed');

  const mapped = unavailableFromQueryError(leakyError('28P01'));
  assert.equal(mapped.message, 'unavailable');
  assert.equal(mapped.code, 'unavailable');
  assert.equal(mapped.category, 'authentication_failed');
  assert.equal(mapped.detail, undefined);
  assert.equal(mapped.hint, undefined);
  assert.doesNotMatch(mapped.message, /postgresql/i);
  assertNoSecrets(JSON.stringify({ category: mapped.category, code: mapped.code, reason: mapped.reason }));
});

test('raw error message/detail never appear in diagnostic logs', () => {
  const { lines } = (() => {
    const captured = [];
    const original = console.error;
    console.error = (...args) => captured.push(args.join(' '));
    try {
      logDiagnosticFailure({
        stage: 'connect',
        category: 'authentication_failed',
        message: leakyError('28P01').message,
        detail: SECRET_URL,
      });
    } finally {
      console.error = original;
    }
    return { lines: captured };
  })();
  assert.equal(lines.length, 1);
  assertSafeLog(lines[0], 'connect', 'authentication_failed');
});
