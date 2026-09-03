import test from 'node:test';
import assert from 'node:assert/strict';
import { createResearcherApp } from '../api/researcher/_lib/app.mjs';
import { loadConfig } from '../api/researcher/_lib/config.mjs';
import {
  AUTH_DIAGNOSTIC_CATEGORIES,
  AUTH_DIAGNOSTIC_STAGES,
  classifyAuthFetchKind,
  classifyAuthFlowFailure,
  classifyLoginUnavailable,
  compactAuthDiagnostic,
  logLoginUnavailable,
} from '../api/researcher/_lib/auth-diagnostic.mjs';
import { createSupabaseAuthClient, verifyAccessToken } from '../api/researcher/_lib/supabase-auth.mjs';

const SECRET_URL =
  'postgresql://researcher_api:login-secret-do-not-leak@db.abcdefghijkl.supabase.co:6543/postgres';
const PUBLISHABLE = 'sb_publishable_test_not_a_jwt';
const SESSION_SECRET = 'test-session-secret-32-bytes-min';
const BRIAN_SUB = '11111111-2222-3333-4444-555555555555';

function productionishConfig(extra = {}) {
  return {
    enabled: true,
    exportsEnabled: false,
    deletionsEnabled: false,
    dbDiagnosticEnabled: false,
    vercelEnv: '',
    databaseUrl: SECRET_URL,
    databaseCaCert: '-----BEGIN CERTIFICATE-----\nFAKE-TEST-CA-NOT-FOR-PRODUCTION\n-----END CERTIFICATE-----',
    sessionSecret: SESSION_SECRET,
    supabaseUrl: 'https://example.supabase.co',
    supabasePublishableKey: PUBLISHABLE,
    supabaseJwtAudience: 'authenticated',
    supabaseAuthReady: true,
    mfaAssuranceReady: true,
    sessionStore: 'database',
    rateLimitStore: 'database',
    durableSessionReady: true,
    durableRateLimitReady: true,
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
    allowedOrigin: '',
    ...extra,
  };
}

function durableApp(config, extra = {}) {
  return createResearcherApp({
    query: async () => ({ rows: [{ allowed: true }] }),
    limiter: { backend: 'database', allow: async () => true },
    config,
    ...extra,
  });
}

function assertNoSecrets(body) {
  const text = String(body);
  assert.doesNotMatch(text, /login-secret-do-not-leak/);
  assert.doesNotMatch(text, /DATABASE_URL/);
  assert.doesNotMatch(text, /SESSION_SECRET/);
  assert.doesNotMatch(text, /SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(text, /sb_publishable_/);
  assert.doesNotMatch(text, /postgresql:\/\//i);
  assert.doesNotMatch(text, /abcdefghijkl/);
  assert.doesNotMatch(text, /example\.supabase\.co/);
  assert.doesNotMatch(text, /BEGIN CERTIFICATE/);
  assert.doesNotMatch(text, /FAKE-TEST-CA/);
  assert.doesNotMatch(text, new RegExp(BRIAN_SUB));
  assert.doesNotMatch(text, /correct-horse-battery/);
  assert.doesNotMatch(text, /otpauth:/);
  assert.doesNotMatch(text, /\/auth\/v1/);
  assert.doesNotMatch(text, /access_token/);
  assert.doesNotMatch(text, /eyJ/);
  assert.doesNotMatch(text, /jwks\.json/);
}

function captureErrors(fn) {
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.join(' '));
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      console.error = original;
    })
    .then((result) => ({ result, lines }));
}

test('classifier names only allowlisted stages and categories', () => {
  const cases = [
    [{ runtimeStoresReady: false, limiter: { backend: 'unavailable' } }, 'rate_limit_unavailable'],
    [
      {
        runtimeStoresReady: false,
        limiter: { backend: 'database' },
        sessions: { backend: 'unavailable' },
        authStates: { backend: 'database' },
      },
      'session_store_unavailable',
    ],
    [
      {
        config: productionishConfig({ enabled: false, authReady: false }),
        runtimeStoresReady: true,
        limiter: { backend: 'database' },
        sessions: { backend: 'database' },
        authStates: { backend: 'database' },
      },
      'api_disabled',
    ],
    [
      {
        config: productionishConfig({ sessionSecret: '', authReady: false }),
        runtimeStoresReady: true,
        limiter: { backend: 'database' },
        sessions: { backend: 'database' },
        authStates: { backend: 'database' },
      },
      'session_secret_missing',
    ],
    [
      {
        config: productionishConfig({
          supabaseUrl: '',
          supabasePublishableKey: PUBLISHABLE,
          supabaseAuthReady: false,
          authReady: false,
        }),
        runtimeStoresReady: true,
        limiter: { backend: 'database' },
        sessions: { backend: 'database' },
        authStates: { backend: 'database' },
      },
      'supabase_url_missing',
    ],
    [
      {
        config: productionishConfig({
          supabasePublishableKey: '',
          supabaseAuthReady: false,
          authReady: false,
        }),
        runtimeStoresReady: true,
        limiter: { backend: 'database' },
        sessions: { backend: 'database' },
        authStates: { backend: 'database' },
      },
      'supabase_key_missing',
    ],
    [
      {
        config: productionishConfig({ authReady: true }),
        auth: null,
        runtimeStoresReady: true,
        limiter: { backend: 'database' },
        sessions: { backend: 'database' },
        authStates: { backend: 'database' },
      },
      'auth_not_constructed',
    ],
  ];
  for (const [input, category] of cases) {
    const classified = classifyLoginUnavailable(input);
    assert.equal(classified.category, category);
    assert.ok(AUTH_DIAGNOSTIC_STAGES.includes(classified.stage));
    assert.ok(AUTH_DIAGNOSTIC_CATEGORIES.includes(classified.category));
  }
});

test('compact diagnostic never copies secrets or tokens', () => {
  const snapshot = compactAuthDiagnostic({
    config: productionishConfig({
      sessionSecret: SESSION_SECRET,
      supabasePublishableKey: PUBLISHABLE,
      databaseUrl: SECRET_URL,
    }),
    auth: { passwordGrant: async () => ({}) },
    runtimeStoresReady: true,
    limiter: { backend: 'database' },
    sessions: { backend: 'database' },
    authStates: { backend: 'database' },
  });
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.hasSessionSecret, true);
  assert.equal(snapshot.hasPublishableKey, true);
  assert.equal(snapshot.hasSupabaseUrl, true);
  assert.equal(snapshot.authClientPresent, true);
  assertNoSecrets(JSON.stringify(snapshot));
  assert.equal(snapshot.sessionSecret, undefined);
  assert.equal(snapshot.supabasePublishableKey, undefined);
  assert.equal(snapshot.databaseUrl, undefined);
  assert.equal(snapshot.supabaseUrl, undefined);
});

test('login 503 before outbound when durable stores are ready but auth is not', async () => {
  const fetches = [];
  const app = durableApp(
    productionishConfig({
      enabled: false,
      authReady: false,
      dbDiagnosticEnabled: true,
      vercelEnv: 'preview',
    })
  );
  const session = await app.handle({ method: 'GET', url: '/v1/session', headers: {}, ip: '1' });
  assert.equal(session.status, 200);
  assert.equal(JSON.parse(session.body).authenticated, false);

  const { result: login, lines } = await captureErrors(() =>
    app.handle({
      method: 'POST',
      url: '/v1/session/login',
      headers: {},
      body: { email: 'researcher@example.test', password: 'correct-horse-battery' },
      ip: '1',
    })
  );
  assert.equal(login.status, 503);
  assert.equal(JSON.parse(login.body).error, 'unavailable');
  assert.equal(JSON.parse(login.body).stage, undefined);
  assert.equal(JSON.parse(login.body).category, undefined);
  assert.equal(fetches.length, 0);
  assert.equal(lines.length, 1);
  const logged = JSON.parse(lines[0]);
  assert.equal(logged.diagnostic, 'login');
  assert.equal(logged.ok, false);
  assert.equal(logged.stage, 'auth_ready');
  assert.equal(logged.category, 'api_disabled');
  assertNoSecrets(lines[0]);
  assertNoSecrets(login.body);

  const diagnostic = await app.handle({
    method: 'GET',
    url: '/diagnostics/auth',
    headers: {},
    ip: '1',
  });
  assert.equal(diagnostic.status, 200);
  const payload = JSON.parse(diagnostic.body);
  assert.equal(payload.ok, false);
  assert.equal(payload.enabled, false);
  assert.equal(payload.authReady, false);
  assert.equal(payload.runtimeStoresReady, true);
  assert.equal(payload.authClientPresent, false);
  assert.equal(payload.category, 'api_disabled');
  assertNoSecrets(diagnostic.body);
});

test('login diagnostic is blocked outside Preview even when the flag is set', async () => {
  const app = durableApp(
    productionishConfig({
      dbDiagnosticEnabled: true,
      vercelEnv: 'production',
    })
  );
  const res = await app.handle({ method: 'GET', url: '/diagnostics/auth', headers: {}, ip: '1' });
  assert.equal(res.status, 503);
  assert.equal(JSON.parse(res.body).error, 'unavailable');
  assert.equal(JSON.parse(res.body).enabled, undefined);
  assert.equal(JSON.parse(res.body).ok, undefined);
  assertNoSecrets(res.body);
});

test('login diagnostic is unavailable by default', async () => {
  const app = durableApp(productionishConfig());
  const res = await app.handle({ method: 'GET', url: '/diagnostics/auth', headers: {}, ip: '1' });
  assert.equal(res.status, 503);
  assert.equal(JSON.parse(res.body).error, 'unavailable');
});

test('stores-unready login 503 is classified without calling Supabase', async () => {
  const { result: login, lines } = await captureErrors(() => {
    const app = createResearcherApp({
      config: productionishConfig({ authReady: true }),
    });
    return app.handle({
      method: 'POST',
      url: '/v1/session/login',
      headers: {},
      body: { email: 'researcher@example.test', password: 'correct-horse-battery' },
      ip: '1',
    });
  });
  assert.equal(login.status, 503);
  assert.equal(JSON.parse(login.body).error, 'unavailable');
  assert.equal(lines.length, 1);
  const logged = JSON.parse(lines[0]);
  assert.equal(logged.stage, 'runtime_stores');
  assert.ok(['rate_limit_unavailable', 'session_store_unavailable', 'auth_state_unavailable', 'runtime_stores_unready'].includes(logged.category));
  assertNoSecrets(lines[0]);
});

test('authReady login reaches password grant', async () => {
  const fetches = [];
  const config = productionishConfig({ authReady: true });
  const app = durableApp(config, {
    auth: createSupabaseAuthClient(config, {
      fetchImpl: async (url) => {
        fetches.push(String(url));
        return new Response(JSON.stringify({}), { status: 400 });
      },
    }),
  });
  const login = await app.handle({
    method: 'POST',
    url: '/v1/session/login',
    headers: {},
    body: { email: 'researcher@example.test', password: 'correct-horse-battery' },
    ip: '1',
  });
  assert.equal(login.status, 401);
  assert.ok(fetches.some((url) => url.includes('/auth/v1/token?grant_type=password')));
  assert.doesNotMatch(JSON.stringify(fetches), /correct-horse-battery/);
  assertNoSecrets(login.body);
});

test('loadConfig still requires an exact true flag and both durable stores', () => {
  const ready = loadConfig({
    RESEARCHER_API_ENABLED: 'true',
    SESSION_STORE: 'database',
    RATE_LIMIT_STORE: 'database',
    DATABASE_URL: SECRET_URL,
    SESSION_SECRET: SESSION_SECRET,
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
  });
  assert.equal(ready.authReady, true);
  const spaced = loadConfig({
    RESEARCHER_API_ENABLED: 'true\n',
    SESSION_STORE: 'database',
    RATE_LIMIT_STORE: 'database',
    DATABASE_URL: SECRET_URL,
    SESSION_SECRET: SESSION_SECRET,
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
  });
  assert.equal(spaced.enabled, false);
  assert.equal(spaced.authReady, false);
});

test('auth fetch kinds map to allowlisted names without echoing URLs', () => {
  const cases = [
    ['https://example.supabase.co/auth/v1/token?grant_type=password', 'POST', 'password_exchange'],
    ['https://example.supabase.co/auth/v1/.well-known/jwks.json', 'GET', 'jwks'],
    ['https://example.supabase.co/auth/v1/user', 'GET', 'get_user'],
    ['https://example.supabase.co/auth/v1/factors', 'GET', 'factor_list'],
    ['https://example.supabase.co/auth/v1/factors', 'POST', 'totp_enroll'],
  ];
  for (const [url, method, kind] of cases) {
    assert.equal(classifyAuthFetchKind(url, method), kind);
    assert.notEqual(classifyAuthFetchKind(url, method), url);
  }
  const classified = classifyAuthFlowFailure({
    stage: 'token_verify',
    category: 'get_claims_threw',
    fetchKind: 'jwks',
  });
  assert.equal(classified.stage, 'token_verify');
  assert.equal(classified.category, 'jwks');
  assert.ok(AUTH_DIAGNOSTIC_STAGES.includes(classified.stage));
  assert.ok(AUTH_DIAGNOSTIC_CATEGORIES.includes(classified.category));
});

test('token verification unavailable after JWKS or getUser is classified', async () => {
  let fetchKind = 'password_exchange';
  const jwks = await verifyAccessToken('header.payload.sig', {
    getClaims: async () => {
      fetchKind = 'jwks';
      throw Object.assign(new Error('network fetch failed'), { status: 503 });
    },
    getFetchKind: () => fetchKind,
  });
  assert.equal(jwks.ok, false);
  assert.equal(jwks.error, 'unavailable');
  assert.equal(jwks.diagnostic.stage, 'token_verify');
  assert.equal(jwks.diagnostic.category, 'jwks');
  assertNoSecrets(JSON.stringify(jwks.diagnostic));

  fetchKind = 'password_exchange';
  const getUser = await verifyAccessToken('header.payload.sig', {
    getClaims: async () => {
      fetchKind = 'get_user';
      return { error: Object.assign(new Error('network fetch failed'), { status: 503 }) };
    },
    getFetchKind: () => fetchKind,
  });
  assert.equal(getUser.error, 'unavailable');
  assert.equal(getUser.diagnostic.category, 'get_user');
});

test('post-outbound login 503s log allowlisted stages only', async () => {
  const aal1 = {
    ok: true,
    accessToken: 'access-token-must-not-log',
    claims: { sub: BRIAN_SUB, aal: 'aal1', amr: [{ method: 'password' }] },
  };
  const cases = [
    [
      { passwordGrant: async () => { throw new Error('network fetch failed'); } },
      'password_exchange',
      'exchange_threw',
    ],
    [
      {
        passwordGrant: async () => ({
          ok: false,
          error: 'unavailable',
          diagnostic: { stage: 'token_verify', category: 'jwks' },
        }),
      },
      'token_verify',
      'jwks',
    ],
    [
      {
        passwordGrant: async () => aal1,
        listVerifiedTotpFactors: async () => ({
          ok: false,
          error: 'unavailable',
          diagnostic: { stage: 'factor_list', category: 'list_unavailable' },
        }),
      },
      'factor_list',
      'list_unavailable',
    ],
    [
      {
        passwordGrant: async () => aal1,
        listVerifiedTotpFactors: async () => ({ ok: true, factors: [] }),
        enrollTotp: async () => ({
          ok: false,
          error: 'unavailable',
          diagnostic: { stage: 'totp_enroll', category: 'enroll_unavailable' },
        }),
      },
      'totp_enroll',
      'enroll_unavailable',
    ],
  ];
  for (const [auth, stage, category] of cases) {
    const { result: login, lines } = await captureErrors(() =>
      durableApp(productionishConfig({ authReady: true }), { auth }).handle({
        method: 'POST',
        url: '/v1/session/login',
        headers: {},
        body: { email: 'researcher@example.test', password: 'correct-horse-battery' },
        ip: '1',
      })
    );
    assert.equal(login.status, 503, stage);
    assert.equal(JSON.parse(login.body).error, 'unavailable');
    assert.equal(JSON.parse(login.body).stage, undefined);
    assert.equal(JSON.parse(login.body).category, undefined);
    assert.equal(lines.length, 1, stage);
    const logged = JSON.parse(lines[0]);
    assert.equal(logged.stage, stage);
    assert.equal(logged.category, category);
    assert.deepEqual(Object.keys(logged).sort(), ['category', 'diagnostic', 'ok', 'stage']);
    assertNoSecrets(lines[0]);
    assertNoSecrets(login.body);
  }
});

test('failed password exchange stays 401 and does not log a post-outbound 503 class', async () => {
  const { result: login, lines } = await captureErrors(() => {
    const config = productionishConfig({ authReady: true });
    return durableApp(config, {
      auth: createSupabaseAuthClient(config, {
        fetchImpl: async () => new Response(JSON.stringify({}), { status: 400 }),
      }),
    }).handle({
      method: 'POST',
      url: '/v1/session/login',
      headers: {},
      body: { email: 'researcher@example.test', password: 'correct-horse-battery' },
      ip: '1',
    });
  });
  assert.equal(login.status, 401);
  assert.equal(lines.length, 0);
  assertNoSecrets(login.body);
});

test('login unavailable logs drop unknown fields and secrets', () => {
  const { lines } = (() => {
    const captured = [];
    const original = console.error;
    console.error = (...args) => captured.push(args.join(' '));
    try {
      logLoginUnavailable({
        stage: 'auth_ready',
        category: 'api_disabled',
        password: 'correct-horse-battery',
        supabasePublishableKey: PUBLISHABLE,
        databaseUrl: SECRET_URL,
        sessionSecret: SESSION_SECRET,
        sub: BRIAN_SUB,
      });
    } finally {
      console.error = original;
    }
    return { lines: captured };
  })();
  assert.equal(lines.length, 1);
  const logged = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(logged).sort(), ['category', 'diagnostic', 'ok', 'stage']);
  assertNoSecrets(lines[0]);
});
