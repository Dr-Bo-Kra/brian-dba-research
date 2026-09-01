import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createResearcherApp } from '../api/researcher/_lib/app.mjs';
import { loadConfig, publicConfigSnapshot } from '../api/researcher/_lib/config.mjs';
import { SQL, assertBoundQuery } from '../api/researcher/_lib/db.mjs';
import {
  assertServerDatabaseUrl,
  createPostgresQueryAdapter,
  createProductionQueryAdapter,
  resolveQueryAdapter,
  wrapQuery,
} from '../api/researcher/_lib/query.mjs';
import { clientRateKey } from '../api/researcher/_lib/rate-limit.mjs';
import { createDatabaseSessionStore } from '../api/researcher/_lib/sessions.mjs';
import { createDatabaseRateLimiter } from '../api/researcher/_lib/rate-limit.mjs';
import { createDatabaseAuditSink } from '../api/researcher/_lib/audit.mjs';
import {
  handleVercelResearcherRequest,
  resetResearcherAppForTests,
  resolveResearcherRequestUrl,
  stripWildcardCors,
} from '../api/researcher/_vercel.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

function readyConfig(extra = {}) {
  return {
    enabled: true,
    exportsEnabled: false,
    deletionsEnabled: false,
    databaseUrl: 'postgresql://researcher-api:unused@127.0.0.1/unused',
    sessionSecret: 'test-session-secret-32-bytes-min',
    supabaseUrl: 'https://test-project.supabase.co',
    supabasePublishableKey: 'sb_publishable_test_not_a_jwt',
    supabaseJwtAudience: 'authenticated',
    supabaseAuthReady: true,
    mfaAssuranceReady: true,
    authReady: true,
    dataReady: true,
    archivePath: '/researcher/',
    sessionMinutes: 20,
    maxPageSize: 50,
    maxExportRows: 2000,
    rateLimitWindowMs: 60_000,
    rateLimitMax: 10_000,
    loginRateLimitMax: 10_000,
    recordRateLimitMax: 10_000,
    qualitativeRateLimitMax: 10_000,
    ...extra,
  };
}

function vercelPair({ method = 'GET', url, headers = {}, body = '', ip = '10.0.0.9' } = {}) {
  const req = {
    method,
    url,
    headers,
    body,
    socket: { remoteAddress: ip },
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

test('Vercel routes share the protected app and do not bypass auth', async () => {
  resetResearcherAppForTests();
  const app = createResearcherApp({
    allowMemoryStores: true,
    config: readyConfig(),
    records: [],
  });
  const protectedData = [
    '/api/researcher/v1/summary',
    '/api/researcher/v1/responses',
    '/api/researcher/v1/responses/resp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '/api/researcher/v1/responses/resp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/qualitative',
  ];
  for (const url of protectedData) {
    const { req, res } = vercelPair({ url });
    const result = await handleVercelResearcherRequest(req, res, { app });
    assert.ok([401, 403, 503].includes(result.status), url);
    assert.doesNotMatch(String(result.body), /resp_/);
    assert.match(result.headers['Cache-Control'], /no-store/);
    assert.notEqual(result.headers['Access-Control-Allow-Origin'], '*');
  }
  const session = await handleVercelResearcherRequest(
    ...Object.values(vercelPair({ url: '/api/researcher/v1/session' })),
    { app }
  );
  assert.equal(JSON.parse(session.body).authenticated, false);
  const login = await handleVercelResearcherRequest(
    ...Object.values(
      vercelPair({
        method: 'POST',
        url: '/api/researcher/v1/session/login',
        body: JSON.stringify({ email: 'researcher@example.test', password: 'x' }),
      })
    ),
    { app }
  );
  assert.ok([401, 403, 503].includes(login.status));
  const { req, res } = vercelPair({ url: '/api/researcher/health' });
  const health = await handleVercelResearcherRequest(req, res, { app });
  assert.equal(health.status, 200);
  assert.doesNotMatch(health.body, /SESSION_SECRET|DATABASE_URL|service_role/);
  const logout = vercelPair({ method: 'POST', url: '/api/researcher/v1/session/logout' });
  const loggedOut = await handleVercelResearcherRequest(logout.req, logout.res, { app });
  assert.ok([200, 403].includes(loggedOut.status));
});

test('Vercel nested paths reach the shared app and stay fail-closed', async () => {
  resetResearcherAppForTests();
  const app = createResearcherApp({
    allowMemoryStores: true,
    config: readyConfig(),
    records: [],
  });

  const rewritten = vercelPair({
    url: '/api/researcher',
    headers: { 'x-forwarded-uri': '/api/researcher/v1/summary' },
  });
  const rewrittenSummary = await handleVercelResearcherRequest(rewritten.req, rewritten.res, { app });
  assert.ok([401, 403, 503].includes(rewrittenSummary.status));
  assert.doesNotMatch(String(rewrittenSummary.body), /resp_/);
  assert.match(rewrittenSummary.headers['Cache-Control'], /no-store/);

  const unknown = await handleVercelResearcherRequest(
    ...Object.values(vercelPair({ url: '/api/researcher/v1/not-a-route' })),
    { app }
  );
  assert.ok([401, 404, 503].includes(unknown.status));
  assert.equal(typeof JSON.parse(unknown.body).error, 'string');
  assert.doesNotMatch(String(unknown.body), /resp_/);

  const restored = resolveResearcherRequestUrl(
    { url: '/api/researcher?ticket=abc' },
    { host: 'example.test', 'x-forwarded-uri': '/api/researcher/v1/session/login' }
  );
  assert.match(restored, /\/api\/researcher\/v1\/session\/login/);
  assert.match(restored, /ticket=abc/);
});

test('Vercel adapters are thin Node wrappers with no duplicate auth logic', () => {
  const indexSrc = read('api/researcher/index.mjs');
  const vercel = read('api/researcher/_vercel.mjs');
  assert.match(indexSrc, /maxDuration:\s*15/);
  assert.doesNotMatch(indexSrc, /runtime:\s*'edge'/);
  assert.doesNotMatch(indexSrc, /nodejs20\.x/);
  assert.match(indexSrc, /handleVercelResearcherRequest/);
  assert.doesNotMatch(indexSrc, /authorize\(/);
  assert.match(vercel, /createResearcherApp/);
  assert.doesNotMatch(vercel, /runtime:\s*'edge'/);
  const vercelJson = read('vercel.json');
  assert.doesNotMatch(vercelJson, /"runtime"\s*:/);
  assert.doesNotMatch(vercelJson, /Access-Control-Allow-Origin/);
  assert.match(vercelJson, /\/api\/researcher\/:path\*/);
  assert.match(vercelJson, /"destination": "\/api\/researcher"/);
  assert.match(vercelJson, /no-store/);
  assert.doesNotMatch(vercelJson, /\[\.\.\.path\]/);
});

test('production query adapter requires DATABASE_URL and rejects service-role', () => {
  assert.equal(createProductionQueryAdapter({}), null);
  assert.equal(createProductionQueryAdapter({ databaseUrl: '' }), null);
  assert.equal(
    createProductionQueryAdapter({
      databaseUrl: 'postgresql://postgres.service_role:x@127.0.0.1/db',
    }),
    null
  );
  assert.throws(() => createPostgresQueryAdapter(), /unavailable/);
  assert.throws(() => assertServerDatabaseUrl(''), /unavailable/);
  assert.throws(
    () => assertServerDatabaseUrl('postgresql://service_role:x@127.0.0.1/db'),
    /unavailable/
  );
  assert.equal(
    resolveQueryAdapter({ sessionStore: 'database', databaseUrl: 'postgresql://researcher-api:unused@127.0.0.1/unused' }),
    null
  );
  const bound = wrapQuery(async (text, params) => ({ rows: [{ text, params }] }));
  assert.equal(typeof bound, 'function');
});

test('SQL session, rate-limit, and audit adapters use the production query abstraction', async () => {
  const calls = [];
  const query = wrapQuery(async (text, params, name) => {
    calls.push({ text, params, name });
    if (text.includes('hit_count')) return { rows: [{ allowed: true }] };
    if (text.includes('researcher_sessions') && text.includes('select')) {
      return {
        rows: [
          {
            id: params[0],
            auth_subject: 'subject-1',
            mfa_ok: true,
            expires_at: new Date(Date.now() + 60_000).toISOString(),
            revoked_at: null,
            role: 'authorised_researcher',
            mfa_required: true,
          },
        ],
      };
    }
    return { rows: [] };
  });
  const sessions = createDatabaseSessionStore(query);
  const id = await sessions.create({
    authSubject: 'subject-1',
    mfaOk: true,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.match(id, /^[a-f0-9]{64}$/);
  const row = await sessions.get(id);
  assert.equal(row.authSubject, 'subject-1');
  assert.doesNotMatch(JSON.stringify(row), /G26|qualitative/);
  const limiter = createDatabaseRateLimiter({
    query,
    windowMs: 1000,
    limits: { login: 5, api: 5, record: 5, qualitative: 5 },
  });
  assert.equal(await limiter.allow('login', '10.0.0.1'), true);
  const sink = createDatabaseAuditSink(query, { auditStoreResearcherIp: false });
  await sink.write({
    actor_id: 'subject-1',
    action: 'view_record',
    participant_reference: 'resp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    detail: { outcome: 'ok', answers: 'not-for-audit', qualitative: { G26: 'secret-text' } },
    researcher_ip: '9.9.9.9',
  });
  const auditCall = calls.find((item) => item.name === 'insertAudit' || item.text.includes('researcher_audit_events'));
  assert.ok(auditCall);
  assert.doesNotMatch(JSON.stringify(auditCall.params), /secret-text|not-for-audit|9\.9\.9\.9/);
  Object.values(SQL).forEach((statement) => assertBoundQuery(statement));
});

test('Vercel trusted-proxy mode cannot be spoofed with X-Forwarded-For', () => {
  const request = {
    ip: '10.0.0.1',
    headers: {
      'x-forwarded-for': '9.9.9.9',
      'x-real-ip': '8.8.8.8',
      'x-vercel-forwarded-for': '203.0.113.10',
    },
  };
  assert.equal(clientRateKey(request, { trustedProxy: false }), '10.0.0.1');
  assert.equal(
    clientRateKey(request, {
      trustedProxy: true,
      trustedProxyPlatform: 'vercel',
      trustedClientIpHeader: 'x-vercel-forwarded-for',
    }),
    '203.0.113.10'
  );
  assert.equal(
    clientRateKey(request, {
      trustedProxy: true,
      trustedProxyPlatform: 'vercel',
      trustedClientIpHeader: 'x-forwarded-for',
    }),
    '10.0.0.1'
  );
  const vercelCfg = loadConfig({ TRUSTED_PROXY: 'vercel' });
  assert.equal(vercelCfg.trustedProxyPlatform, 'vercel');
  assert.equal(vercelCfg.trustedClientIpHeader, 'x-vercel-forwarded-for');
  assert.equal(loadConfig({}).trustedProxy, false);
  assert.deepEqual(stripWildcardCors({ 'Access-Control-Allow-Origin': '*' }), {});
});

test('missing production secrets fail closed and stay out of public config', () => {
  const cfg = loadConfig({ RESEARCHER_API_ENABLED: 'true' });
  assert.equal(cfg.authReady, false);
  assert.equal(cfg.dataReady, false);
  const snap = publicConfigSnapshot(
    loadConfig({
      SESSION_SECRET: 'do-not-publish',
      SUPABASE_PUBLISHABLE_KEY: 'do-not-publish',
      DATABASE_URL: 'postgresql://researcher-api:unused@127.0.0.1/unused',
      DATABASE_CA_CERT: '-----BEGIN CERTIFICATE-----\nFAKE-TEST-CA-NOT-FOR-PRODUCTION\n-----END CERTIFICATE-----',
    })
  );
  assert.equal(snap.sessionSecret, undefined);
  assert.equal(snap.supabasePublishableKey, undefined);
  assert.equal(snap.supabaseJwtSecret, undefined);
  assert.equal(snap.databaseUrl, undefined);
  assert.equal(snap.databaseCaCert, undefined);
  const example = read('api/researcher/env.example');
  assert.match(example, /SERVER-ONLY/);
  assert.doesNotMatch(example, /eyJ[A-Za-z0-9_-]{20,}/);
  assert.doesNotMatch(example, /sk_live_/);
});

test('browser files have no Supabase credentials or direct database access', () => {
  const files = [
    'researcher/dashboard.js',
    'researcher/auth-field-mode.mjs',
    'researcher/config.js',
    'researcher/config.example.js',
    'script.js',
    'config.js',
    'config.example.js',
  ];
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /createClient\s*\(/);
    assert.doesNotMatch(source, /service_role/);
    assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE/);
    assert.doesNotMatch(source, /SUPABASE_SECRET_KEY/);
    assert.doesNotMatch(source, /SUPABASE_PUBLISHABLE_KEY/);
    assert.doesNotMatch(source, /SUPABASE_JWT_SECRET/);
    assert.doesNotMatch(source, /DATABASE_URL/);
    assert.doesNotMatch(source, /from\s+['"]pg['"]/);
    assert.doesNotMatch(source, /postgresql:\/\//);
  }
  assert.match(read('researcher/config.js'), /RESEARCHER_ENDPOINT:\s*'\/api\/researcher'/);
  assert.match(read('config.js'), /COLLECTION_ENABLED:\s*false/);
  assert.match(read('config.js'), /SUBMISSION_ENDPOINT:\s*''/);
  assert.doesNotMatch(read('researcher/dashboard.js'), /LIVE_EXPORTS_ENABLED = true/);
  assert.doesNotMatch(read('researcher/dashboard.js'), /LIVE_DELETIONS_ENABLED = true/);
});

test('repository scan finds no committed env secrets or service-role keys', () => {
  assert.equal(existsSync(join(root, '.env')), false);
  const ignore = read('.gitignore');
  assert.match(ignore, /\.env/);
  const walk = (dir, acc = []) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (['.git', 'node_modules', '.serena'].includes(name.name)) continue;
      const full = join(dir, name.name);
      if (name.isDirectory()) walk(full, acc);
      else if (/\.(js|mjs|html|json|yml|md|sql|txt|example)$/.test(name.name)) acc.push(full);
    }
    return acc;
  };
  for (const file of walk(root)) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\./);
    assert.doesNotMatch(source, /service_role_[A-Za-z0-9]/);
    assert.doesNotMatch(source, new RegExp(['NEXT', 'PUBLIC', 'OIDC', 'CLIENT', 'SECRET'].join('_')));
    assert.doesNotMatch(source, new RegExp(['NEXT', 'PUBLIC', 'DATABASE', 'URL'].join('_')));
  }
});
