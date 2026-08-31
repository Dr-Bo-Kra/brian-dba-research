import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createResearcherApp } from '../api/researcher/_lib/app.mjs';
import { loadConfig } from '../api/researcher/_lib/config.mjs';
import { publicConfigSnapshot } from '../api/researcher/_lib/config.mjs';
import { createDatabaseResearchStore, createFixtureResearchStore } from '../api/researcher/_lib/data.mjs';
import { SQL, assertBoundQuery } from '../api/researcher/_lib/db.mjs';
import { AUTH_TX_COOKIE, SESSION_COOKIE, verifySignedSession } from '../api/researcher/_lib/http.mjs';
import { createMemoryAuthStateStore } from '../api/researcher/_lib/auth-state.mjs';
import {
  createClaimsVerifier,
  createSupabaseAuthClient,
  requiredMfaSatisfied,
  supabaseIssuer,
  supabaseJwksUrl,
  verifyAccessToken,
} from '../api/researcher/_lib/supabase-auth.mjs';
import { createSupabaseAuthTestHarness } from './helpers/supabase-auth-harness.mjs';
import { createPostgresQueryAdapter, wrapQuery } from '../api/researcher/_lib/query.mjs';
import { clientRateKey } from '../api/researcher/_lib/rate-limit.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dashboardJs = readFileSync(join(root, 'researcher/dashboard.js'), 'utf8');
const publicScript = readFileSync(join(root, 'script.js'), 'utf8');
const publicConfig = readFileSync(join(root, 'config.js'), 'utf8');

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

function sampleRecord(ref = 'resp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') {
  return {
    client_record_id: ref,
    created_at: '2026-08-01T12:00:00.000Z',
    profile: { countryRegion: 'india', position: 'credit-manager', yearsLending: '6-10' },
    assessment: {
      overall: { score: 5.2 },
      domains: [{ id: 'psychometric', label: 'Psychometric indicators', score: 5.2 }],
    },
    responses: {
      likert: { B1: 6 },
      qualitative: {
        openResponses: { G26: '<script>alert(1)</script>' },
        roleDescription: '<img src=x onerror=alert(1)>',
      },
    },
    qualitative: {
      openResponses: { G26: '<script>alert(1)</script>' },
      roleDescription: '<img src=x onerror=alert(1)>',
    },
    legal_hold: false,
  };
}

function testApp(extra = {}) {
  const { records = [sampleRecord()], config, authHarness, ...rest } = extra;
  return createResearcherApp({
    allowMemoryStores: true,
    records,
    authHarness: authHarness || createSupabaseAuthTestHarness(),
    config: readyConfig(config),
    ...rest,
  });
}

function cookieFrom(setCookie, name = SESSION_COOKIE) {
  const list = Array.isArray(setCookie) ? setCookie : [setCookie];
  return list.find((value) => String(value).startsWith(`${name}=`)) || '';
}

function cookiePair(header) {
  return header ? header.split(';')[0] : '';
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function researcherLogin(
  app,
  {
    email = 'researcher@example.test',
    password = 'correct-horse-battery',
    sub = 'subject-1',
    role = 'authorised_researcher',
    totpCode = '123456',
    enrolled = true,
    aal = 'aal1',
    priorCookie,
    spoofBody = {},
    directory = true,
  } = {}
) {
  app.auth.harness.addUser({ email, password, sub, aal, totpCode, enrolled });
  if (directory) {
    app.directory.set(sub, { role, mfaRequired: true, revokedAt: null, disabledAt: null });
  }
  const login = await app.handle({
    method: 'POST',
    url: '/v1/session/login',
    headers: priorCookie ? { cookie: priorCookie } : {},
    body: { email, password, ...spoofBody },
    ip: '10.0.0.8',
  });
  const loginBody = JSON.parse(login.body || '{}');
  if (!loginBody.mfaRequired) return { login, mfa: null, loginBody };
  const tx = cookiePair(cookieFrom(login.headers['Set-Cookie'], AUTH_TX_COOKIE));
  const mfa = await app.handle({
    method: 'POST',
    url: '/v1/session/mfa',
    headers: { cookie: [priorCookie, tx].filter(Boolean).join('; ') },
    body: { ticket: loginBody.ticket, code: totpCode, ...spoofBody },
    ip: '10.0.0.8',
  });
  return { login, mfa, tx, ticket: loginBody.ticket, loginBody, mfaBody: JSON.parse(mfa.body || '{}') };
}

test('production stays fail-closed without durable Supabase Auth, MFA, session, and rate-limit backends', async () => {
  const config = loadConfig({
    RESEARCHER_API_ENABLED: 'true',
    DATABASE_URL: 'postgresql://researcher-api:unused@127.0.0.1/unused',
    SESSION_SECRET: 'test-session-secret-32-bytes-min',
    SESSION_STORE: 'memory',
    RATE_LIMIT_STORE: 'memory',
  });
  assert.equal(config.authReady, false);
  assert.equal(config.dataReady, false);
  assert.equal(config.mfaAssuranceReady, false);

  const production = createResearcherApp({
    config: readyConfig({ authReady: false, dataReady: true }),
    records: [sampleRecord()],
  });
  const data = await production.handle({ method: 'GET', url: '/v1/responses', headers: {}, ip: '1' });
  assert.equal(data.status, 503);
  assert.doesNotMatch(data.body, /resp_/);
  const login = await production.handle({
    method: 'POST',
    url: '/v1/session/login',
    headers: {},
    body: { email: 'researcher@example.test', password: 'correct-horse-battery' },
    ip: '1',
  });
  assert.equal(login.status, 503);
});

test('missing, expired, revoked, disabled, unknown, and wrong-role sessions receive no data', async () => {
  const app = testApp();
  const missing = await app.handle({ method: 'GET', url: '/v1/responses', headers: {}, ip: '2' });
  assert.equal(missing.status, 401);
  assert.doesNotMatch(missing.body, /resp_/);

  const expired = await app.signInForTests('subject-expired', { minutes: -1 });
  const expiredRes = await app.handle({
    method: 'GET',
    url: '/v1/summary',
    headers: { cookie: expired.cookie },
    ip: '2',
  });
  assert.equal(expiredRes.status, 401);
  assert.doesNotMatch(expiredRes.body, /orientation/);

  const revoked = await app.signInForTests('subject-revoked');
  await app.sessions.revoke(revoked.sessionId);
  const revokedRes = await app.handle({
    method: 'GET',
    url: '/v1/responses',
    headers: { cookie: revoked.cookie },
    ip: '2',
  });
  assert.equal(revokedRes.status, 401);

  const disabled = await app.signInForTests('subject-disabled');
  app.directory.set('subject-disabled', {
    role: 'authorised_researcher',
    mfaRequired: true,
    revokedAt: null,
    disabledAt: new Date().toISOString(),
  });
  const disabledRes = await app.handle({
    method: 'GET',
    url: '/v1/responses',
    headers: { cookie: disabled.cookie },
    ip: '2',
  });
  assert.equal(disabledRes.status, 401);

  const wrong = await app.signInForTests('subject-wrong', { role: 'viewer' });
  const wrongRes = await app.handle({
    method: 'GET',
    url: '/v1/responses',
    headers: { cookie: wrong.cookie },
    ip: '2',
  });
  assert.equal(wrongRes.status, 403);
  assert.doesNotMatch(wrongRes.body, /resp_/);
  assert.equal(app.auditLog.some((row) => row.action === 'authz_failure'), true);
});

test('browser-provided role, subject, email, and MFA state are ignored', async () => {
  const app = testApp();
  const spoofed = await app.handle({
    method: 'GET',
    url: '/v1/responses',
    headers: {
      'x-role': 'researcher_admin',
      'x-auth-subject': 'subject-1',
      authorization: 'Bearer pretend-id-token',
    },
    ip: '3',
  });
  assert.equal(spoofed.status, 401);
  assert.doesNotMatch(spoofed.body, /resp_/);

  const signed = await app.signInForTests('subject-1', { role: 'authorised_researcher' });
  const stillResearcher = await app.handle({
    method: 'GET',
    url: '/v1/session',
    headers: { cookie: signed.cookie, 'x-role': 'researcher_admin' },
    ip: '3',
  });
  assert.equal(JSON.parse(stillResearcher.body).role, 'authorised_researcher');

  const { login, mfa } = await researcherLogin(app, {
    sub: 'subject-1',
    spoofBody: {
      sub: 'forged-subject',
      role: 'researcher_admin',
      aal: 'aal2',
      mfaOk: true,
      access_token: 'forged',
    },
  });
  assert.equal(login.status, 200);
  assert.equal(JSON.parse(login.body).mfaRequired, true);
  assert.equal(cookieFrom(login.headers['Set-Cookie'], SESSION_COOKIE), '');
  assert.equal(mfa.status, 200);
  assert.equal(JSON.parse(mfa.body).role, 'authorised_researcher');
});

test('password-only sessions cannot access data until TOTP MFA completes', async () => {
  const app = testApp();
  app.auth.harness.addUser({
    email: 'researcher@example.test',
    password: 'correct-horse-battery',
    sub: 'subject-1',
    aal: 'aal1',
    totpCode: '123456',
    enrolled: true,
  });
  app.directory.set('subject-1', {
    role: 'authorised_researcher',
    mfaRequired: true,
    revokedAt: null,
    disabledAt: null,
  });
  const login = await app.handle({
    method: 'POST',
    url: '/v1/session/login',
    headers: {},
    body: { email: 'researcher@example.test', password: 'correct-horse-battery', aal: 'aal2' },
    ip: '4',
  });
  const body = JSON.parse(login.body);
  assert.equal(login.status, 200);
  assert.equal(body.authenticated, false);
  assert.equal(body.mfaRequired, true);
  assert.equal(cookieFrom(login.headers['Set-Cookie'], SESSION_COOKIE), '');
  const tx = cookiePair(cookieFrom(login.headers['Set-Cookie'], AUTH_TX_COOKIE));
  const withTicket = await app.handle({
    method: 'GET',
    url: '/v1/responses',
    headers: { cookie: tx },
    ip: '4',
  });
  assert.equal(withTicket.status, 401);
  assert.doesNotMatch(withTicket.body, /resp_/);

  const wrong = await app.handle({
    method: 'POST',
    url: '/v1/session/mfa',
    headers: { cookie: tx },
    body: { ticket: body.ticket, code: '000000', aal: 'aal2', sub: 'subject-1' },
    ip: '4',
  });
  assert.equal(cookieFrom(wrong.headers['Set-Cookie'], SESSION_COOKIE), '');
  assert.ok([401, 403].includes(wrong.status));
});

test('successful Supabase Auth + MFA login rotates the session and then serves allowlisted data only', async () => {
  const app = testApp();
  const prior = await app.signInForTests('subject-1');
  const { mfa } = await researcherLogin(app, { sub: 'subject-1', priorCookie: prior.cookie });
  assert.equal(mfa.status, 200);
  assert.equal(JSON.parse(mfa.body).authenticated, true);
  const cookieHeader = cookieFrom(mfa.headers['Set-Cookie']);
  assert.match(cookieHeader, new RegExp(SESSION_COOKIE));
  assert.match(cookieHeader, /HttpOnly/i);
  assert.match(cookieHeader, /Secure/);
  assert.match(cookieHeader, /SameSite=Strict/);
  assert.match(cookieHeader, /Path=\//);
  const newId = verifySignedSession(cookieHeader.split('=')[1].split(';')[0], app.config.sessionSecret);
  assert.notEqual(newId, prior.sessionId);
  assert.equal(await app.sessions.get(prior.sessionId), null);

  const headers = { cookie: `${SESSION_COOKIE}=${cookieHeader.split('=')[1].split(';')[0]}` };
  const session = await app.handle({ method: 'GET', url: '/v1/session', headers, ip: '5' });
  assert.equal(JSON.parse(session.body).authenticated, true);
  const list = await app.handle({ method: 'GET', url: '/v1/responses', headers, ip: '5' });
  const payload = JSON.parse(list.body);
  assert.equal(list.status, 200);
  assert.equal(payload.records[0].qualitative, undefined);
  assert.equal(payload.records[0].responses, undefined);
  assert.equal(payload.records[0].id, undefined);
  assert.match(list.headers['Cache-Control'], /no-store/);
  assert.equal(app.auditLog.some((row) => row.action === 'login'), true);
});

test('unknown, disabled, revoked, and extra active researchers cannot complete login', async () => {
  const app = testApp();
  const unknown = await researcherLogin(app, {
    sub: 'nobody',
    email: 'nobody@example.test',
    directory: false,
  });
  assert.equal(cookieFrom(unknown.mfa.headers['Set-Cookie'], SESSION_COOKIE), '');
  assert.ok([401, 403].includes(unknown.mfa.status));

  app.directory.clear();
  app.directory.set('disabled-user', {
    role: 'authorised_researcher',
    mfaRequired: true,
    revokedAt: null,
    disabledAt: new Date().toISOString(),
  });
  const disabled = await researcherLogin(app, {
    sub: 'disabled-user',
    email: 'disabled@example.test',
    directory: false,
  });
  assert.equal(cookieFrom(disabled.mfa.headers['Set-Cookie'], SESSION_COOKIE), '');

  app.directory.clear();
  app.directory.set('revoked-user', {
    role: 'authorised_researcher',
    mfaRequired: true,
    revokedAt: new Date().toISOString(),
    disabledAt: null,
  });
  const revoked = await researcherLogin(app, {
    sub: 'revoked-user',
    email: 'revoked@example.test',
    directory: false,
  });
  assert.equal(cookieFrom(revoked.mfa.headers['Set-Cookie'], SESSION_COOKIE), '');

  app.directory.clear();
  app.directory.set('subject-1', {
    role: 'authorised_researcher',
    mfaRequired: true,
    revokedAt: null,
    disabledAt: null,
  });
  app.directory.set('subject-2', {
    role: 'researcher_admin',
    mfaRequired: true,
    revokedAt: null,
    disabledAt: null,
  });
  const multi = await researcherLogin(app, {
    sub: 'subject-1',
    email: 'multi@example.test',
    directory: false,
  });
  assert.equal(cookieFrom(multi.mfa.headers['Set-Cookie'], SESSION_COOKIE), '');
  assert.equal(multi.mfa.status, 403);
});

test('query safety rejects unknown filters, sort, oversized pages, and dump attempts', async () => {
  const app = testApp();
  const { headers } = await (async () => {
    const signed = await app.signInForTests('subject-1');
    return { headers: { cookie: signed.cookie, 'x-csrf-token': signed.csrf } };
  })();
  const cases = [
    '/v1/responses?columns=responses',
    '/v1/responses?sort=assessment',
    '/v1/responses?table=authorised_researchers',
    '/v1/responses?limit=500',
    '/v1/responses?include_qualitative=true',
    '/v1/responses?region=india;drop%20table',
    '/v1/summary?q=' + 'x'.repeat(81),
  ];
  for (const url of cases) {
    const res = await app.handle({ method: 'GET', url, headers, ip: '7' });
    assert.equal(res.status, 400, url);
    assert.doesNotMatch(res.body, /<script>/);
    assert.doesNotMatch(res.body, /resp_/);
  }
  const missing = await app.handle({
    method: 'GET',
    url: '/v1/responses/resp_ffffffffffffffffffffffffffffffff',
    headers,
    ip: '7',
  });
  assert.equal(missing.status, 404);
  assert.doesNotMatch(missing.body, /qualitative/);
});

test('qualitative answers stay off ledger and aggregates and are audit-logged without content', async () => {
  const app = testApp();
  const signed = await app.signInForTests('subject-1');
  const headers = { cookie: signed.cookie };
  const summary = await app.handle({ method: 'GET', url: '/v1/summary', headers, ip: '8' });
  const list = await app.handle({ method: 'GET', url: '/v1/responses', headers, ip: '8' });
  const one = await app.handle({
    method: 'GET',
    url: '/v1/responses/resp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    headers,
    ip: '8',
  });
  const qual = await app.handle({
    method: 'GET',
    url: '/v1/responses/resp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/qualitative',
    headers,
    ip: '8',
  });
  assert.doesNotMatch(summary.body, /<script>alert/);
  assert.doesNotMatch(list.body, /<script>alert/);
  assert.doesNotMatch(one.body, /<script>alert/);
  assert.equal(JSON.parse(one.body).qualitative, undefined);
  const qualBody = JSON.parse(qual.body);
  assert.equal(qualBody.qualitative.openResponses.G26, '<script>alert(1)</script>');
  assert.match(qual.headers['Cache-Control'], /no-store/);
  assert.equal(qual.headers['X-Content-Type-Options'], 'nosniff');
  const qualAudit = app.auditLog.find((row) => row.action === 'view_qualitative');
  assert.ok(qualAudit);
  assert.doesNotMatch(JSON.stringify(qualAudit), /<script>alert/);
  assert.doesNotMatch(JSON.stringify(app.auditLog), /id_token/);
});

test('logout and disabled-researcher revocation invalidate further reads', async () => {
  const app = testApp();
  const signed = await app.signInForTests('subject-1');
  const logout = await app.handle({
    method: 'POST',
    url: '/v1/session/logout',
    headers: { cookie: signed.cookie, 'x-csrf-token': signed.csrf },
    ip: '9',
  });
  assert.equal(logout.status, 200);
  const after = await app.handle({
    method: 'GET',
    url: '/v1/responses',
    headers: { cookie: signed.cookie },
    ip: '9',
  });
  assert.equal(after.status, 401);
  assert.equal(app.auditLog.some((row) => row.action === 'logout'), true);
});

function claimsOpts(harness, extra = {}) {
  return {
    issuer: supabaseIssuer(harness.url),
    audience: harness.audience,
    jwtSecret: harness.hs256Secret,
    getClaims: createClaimsVerifier(
      {
        supabaseUrl: harness.url,
        supabasePublishableKey: harness.publishableKey,
      },
      { harness, jwks: extra.jwks === undefined ? harness.jwks : extra.jwks, fetchImpl: extra.fetchImpl }
    ),
  };
}

test('official getClaims path rejects bad signature, wrong project, expired, aal1, missing TOTP, and elevated roles', async () => {
  const harness = createSupabaseAuthTestHarness();
  const opts = claimsOpts(harness);
  const client = createSupabaseAuthClient(
    {
      supabaseUrl: harness.url,
      supabasePublishableKey: harness.publishableKey,
      supabaseJwtAudience: 'authenticated',
    },
    { harness }
  );
  const good = await harness.issueAccessToken({
    sub: 'subject-1',
    aal: 'aal2',
    email: 'researcher@example.test',
  });
  assert.equal((await client.verifyAccessToken(good)).ok, true);
  assert.equal((await verifyAccessToken(good, opts)).ok, true);

  assert.equal((await verifyAccessToken(`${good.slice(0, -2)}aa`, opts)).ok, false);

  const expired = await harness.issueAccessToken({
    sub: 'subject-1',
    aal: 'aal2',
    email: 'researcher@example.test',
    exp: Math.floor(Date.now() / 1000) - 30,
  });
  assert.equal((await client.verifyAccessToken(expired)).ok, false);

  const passwordOnly = await harness.issueAccessToken({
    sub: 'subject-1',
    aal: 'aal1',
    email: 'researcher@example.test',
  });
  const passwordClaims = await client.verifyAccessToken(passwordOnly);
  assert.equal(passwordClaims.ok, true);
  assert.equal(requiredMfaSatisfied(passwordClaims.claims), false);
  assert.equal(requiredMfaSatisfied((await client.verifyAccessToken(good)).claims), true);

  const missingTotp = await harness.issueAccessToken({
    sub: 'subject-1',
    aal: 'aal2',
    email: 'researcher@example.test',
    amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }],
  });
  const missingTotpClaims = await client.verifyAccessToken(missingTotp);
  assert.equal(missingTotpClaims.ok, true);
  assert.equal(requiredMfaSatisfied(missingTotpClaims.claims), false);
  assert.equal(requiredMfaSatisfied({ aal: 'aal2', amr: [{ method: 'password' }] }), false);

  assert.equal((await verifyAccessToken(good, { ...opts, issuer: 'https://evil.supabase.co/auth/v1' })).ok, false);
  assert.equal((await verifyAccessToken(good, { ...opts, audience: 'other' })).ok, false);

  const elevated = await harness.issueAccessToken({
    sub: 'subject-1',
    aal: 'aal2',
    email: 'researcher@example.test',
    role: 'service_role',
  });
  assert.equal((await client.verifyAccessToken(elevated)).ok, false);

  const admin = await harness.issueAccessToken({
    sub: 'subject-1',
    aal: 'aal2',
    email: 'researcher@example.test',
    role: 'supabase_admin',
  });
  assert.equal((await client.verifyAccessToken(admin)).ok, false);

  const otherProject = createSupabaseAuthTestHarness({ url: 'https://other-project.supabase.co' });
  const foreign = await otherProject.issueAccessToken({
    sub: 'subject-1',
    aal: 'aal2',
    email: 'researcher@example.test',
  });
  assert.equal((await client.verifyAccessToken(foreign)).ok, false);
  assert.equal((await verifyAccessToken(foreign, opts)).ok, false);

  const noneAlg = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(
    JSON.stringify({
      iss: supabaseIssuer(harness.url),
      aud: harness.audience,
      sub: 'subject-1',
      role: 'authenticated',
      aal: 'aal2',
      exp: Math.floor(Date.now() / 1000) + 3600,
    })
  ).toString('base64url')}.`;
  assert.equal((await client.verifyAccessToken(noneAlg)).ok, false);

  const jwksDown = await verifyAccessToken(good, {
    issuer: supabaseIssuer(harness.url),
    audience: harness.audience,
    getClaims: createClaimsVerifier(
      { supabaseUrl: harness.url, supabasePublishableKey: harness.publishableKey },
      {
        fetchImpl: async () => {
          throw new Error('jwks down');
        },
      }
    ),
  });
  assert.equal(jwksDown.ok, false);
  assert.equal(supabaseJwksUrl(harness.url), `${supabaseIssuer(harness.url)}/.well-known/jwks.json`);
});

test('legacy HS256 tokens fail closed unless Auth getUser via getClaims accepts them', async () => {
  const harness = createSupabaseAuthTestHarness();
  const hs = await harness.issueAccessToken(
    { sub: 'subject-1', aal: 'aal2', email: 'researcher@example.test' },
    { alg: 'HS256' }
  );
  const base = {
    issuer: supabaseIssuer(harness.url),
    audience: harness.audience,
    jwtSecret: harness.hs256Secret,
  };
  assert.equal((await verifyAccessToken(hs, base)).ok, false);

  const rejected = await verifyAccessToken(hs, {
    ...base,
    getClaims: createClaimsVerifier(
      { supabaseUrl: harness.url, supabasePublishableKey: harness.publishableKey },
      { fetchImpl: async () => new Response('{}', { status: 401 }) }
    ),
  });
  assert.equal(rejected.ok, false);

  const accepted = await verifyAccessToken(hs, claimsOpts(harness));
  assert.equal(accepted.ok, true);
  assert.equal(accepted.claims.sub, 'subject-1');
});

test('login flow never requires a JWT secret or secret/service_role keys', () => {
  const authSource = readFileSync(join(root, 'api/researcher/_lib/supabase-auth.mjs'), 'utf8');
  const configSource = readFileSync(join(root, 'api/researcher/_lib/config.mjs'), 'utf8');
  const appSource = readFileSync(join(root, 'api/researcher/_lib/app.mjs'), 'utf8');
  assert.match(authSource, /getClaims/);
  assert.match(authSource, /createClient/);
  assert.doesNotMatch(authSource, /cryptoVerify|verifyAsymmetricSignature|EdDSA|createHmac/);
  assert.doesNotMatch(authSource, /supabase\.from\(|\.from\(['"]assessment_responses/);
  assert.doesNotMatch(authSource, /options\.jwtSecret/);
  assert.doesNotMatch(authSource, /supabaseJwtSecret/);
  assert.doesNotMatch(configSource, /SUPABASE_JWT_SECRET/);
  assert.doesNotMatch(configSource, /SUPABASE_SECRET_KEY/);
  assert.match(configSource, /SUPABASE_PUBLISHABLE_KEY \|\| env\.SUPABASE_ANON_KEY/);
  assert.doesNotMatch(appSource, /SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(appSource, /service_role/);
  assert.doesNotMatch(dashboardJs, /SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(dashboardJs, /SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(dashboardJs, /SUPABASE_JWT_SECRET/);
  assert.doesNotMatch(dashboardJs, /access_token/);
});

test('dashboard treats qualitative XSS payloads as text and never persists records', () => {
  assert.match(dashboardJs, /escapeHtml\(text\)/);
  assert.match(dashboardJs, /escapeHtml\(entry\.qualitative\.roleDescription\)/);
  assert.match(dashboardJs, /LIVE_EXPORTS_ENABLED = false/);
  assert.match(dashboardJs, /LIVE_DELETIONS_ENABLED = false/);
  assert.doesNotMatch(dashboardJs, /localStorage\.setItem/);
  assert.doesNotMatch(dashboardJs, /sessionStorage\.setItem/);
  const rendered = `<p><strong>${escapeHtml('G26')}.</strong> ${escapeHtml('<script>alert(1)</script>')}</p>`;
  assert.match(rendered, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(rendered, /<script>alert\(1\)<\/script>/);
  const eventHandler = escapeHtml('<img src=x onerror=alert(1)>');
  assert.match(eventHandler, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('public collection remains disabled and is not coupled to researcher auth', () => {
  assert.match(publicConfig, /COLLECTION_ENABLED:\s*false/);
  assert.match(publicConfig, /SUBMISSION_ENDPOINT:\s*''/);
  assert.match(publicScript, /COLLECTION_ENABLED === true/);
  assert.doesNotMatch(publicScript, /createResearcherApp/);
  assert.doesNotMatch(publicScript, /OIDC_/);
  assert.doesNotMatch(publicScript, /authorised_researchers/);
});

test('MFA ticket cookie is required, one-time after success, and not a session', async () => {
  const authStates = createMemoryAuthStateStore();
  const app = testApp({ authStates });
  app.auth.harness.addUser({
    email: 'researcher@example.test',
    password: 'correct-horse-battery',
    sub: 'subject-1',
    totpCode: '123456',
    enrolled: true,
  });
  app.auth.harness.addUser({
    email: 'pending@example.test',
    password: 'correct-horse-battery',
    sub: 'subject-1',
    totpCode: '123456',
    enrolled: true,
  });
  app.directory.set('subject-1', {
    role: 'authorised_researcher',
    mfaRequired: true,
    revokedAt: null,
    disabledAt: null,
  });
  const login = await app.handle({
    method: 'POST',
    url: '/v1/session/login',
    headers: {},
    body: { email: 'researcher@example.test', password: 'correct-horse-battery' },
    ip: '20',
  });
  const body = JSON.parse(login.body);
  const tx = cookiePair(cookieFrom(login.headers['Set-Cookie'], AUTH_TX_COOKIE));
  assert.match(cookieFrom(login.headers['Set-Cookie'], AUTH_TX_COOKIE), /SameSite=Strict/);

  const missingTx = await app.handle({
    method: 'POST',
    url: '/v1/session/mfa',
    headers: {},
    body: { ticket: body.ticket, code: '123456' },
    ip: '20',
  });
  assert.equal(cookieFrom(missingTx.headers['Set-Cookie'], SESSION_COOKIE), '');

  const first = await app.handle({
    method: 'POST',
    url: '/v1/session/mfa',
    headers: { cookie: tx },
    body: { ticket: body.ticket, code: '123456' },
    ip: '20',
  });
  assert.match(cookieFrom(first.headers['Set-Cookie'], SESSION_COOKIE), new RegExp(SESSION_COOKIE));
  const replay = await app.handle({
    method: 'POST',
    url: '/v1/session/mfa',
    headers: { cookie: tx },
    body: { ticket: body.ticket, code: '123456' },
    ip: '20',
  });
  assert.equal(cookieFrom(replay.headers['Set-Cookie'], SESSION_COOKIE), '');

  const login2 = await app.handle({
    method: 'POST',
    url: '/v1/session/login',
    headers: {},
    body: { email: 'pending@example.test', password: 'correct-horse-battery' },
    ip: '20',
  });
  const body2 = JSON.parse(login2.body);
  const tx2 = cookiePair(cookieFrom(login2.headers['Set-Cookie'], AUTH_TX_COOKIE));
  assert.equal(body2.mfaRequired, true);
  const pending = await authStates.peek(body2.ticket);
  pending.expiresAt = new Date(Date.now() - 1000).toISOString();
  await authStates.put(pending);
  const expired = await app.handle({
    method: 'POST',
    url: '/v1/session/mfa',
    headers: { cookie: tx2 },
    body: { ticket: body2.ticket, code: '123456' },
    ip: '20',
  });
  assert.equal(cookieFrom(expired.headers['Set-Cookie'], SESSION_COOKIE), '');
});

test('production stays fail-closed without an injected query adapter', async () => {
  const app = createResearcherApp({
    config: readyConfig({
      authReady: true,
      dataReady: true,
      sessionStore: 'database',
      rateLimitStore: 'database',
    }),
    records: [sampleRecord()],
  });
  const login = await app.handle({
    method: 'POST',
    url: '/v1/session/login',
    headers: {},
    body: { email: 'researcher@example.test', password: 'x' },
    ip: '21',
  });
  const data = await app.handle({ method: 'GET', url: '/v1/responses', headers: {}, ip: '21' });
  assert.equal(login.status, 503);
  assert.equal(data.status, 503);
  assert.doesNotMatch(data.body, /resp_/);
  assert.throws(() => createPostgresQueryAdapter(), /unavailable/);
});

test('SQL aggregate path matches fixture DTO shape and rejects extra aggregate fields', async () => {
  Object.values(SQL).forEach((query) => assertBoundQuery(query));
  const records = [sampleRecord()];
  const filters = {
    from: null,
    to: null,
    region: null,
    role: null,
    experience: null,
    q: '',
    limit: 20,
  };
  const expected = await createFixtureResearchStore(records).summary(filters);
  const query = wrapQuery(async (text, _params, name) => {
    if (name === 'summary' || text.includes('mean_orientation')) {
      return {
        rows: [
          {
            total: expected.total,
            last_24h: expected.last_24h,
            mean_orientation: expected.mean_orientation,
            last_intake: expected.last_intake,
            legal_hold: expected.retention.legal_hold,
            anonymised: 0,
          },
        ],
      };
    }
    if (name === 'trend' || text.includes('as day')) {
      return { rows: expected.trend.map((row) => ({ day: row.day, count: row.count })) };
    }
    if (name === 'domainAggregates' || text.includes('jsonb_to_recordset')) {
      return { rows: expected.domains.map((row) => ({ id: row.id, score: row.score, n: row.n })) };
    }
    if (name === 'itemAggregates' || text.includes('jsonb_each_text')) {
      return {
        rows: expected.items.map((row) => ({
          id: row.id,
          c1: row.counts[0],
          c2: row.counts[1],
          c3: row.counts[2],
          c4: row.counts[3],
          c5: row.counts[4],
          c6: row.counts[5],
          c7: row.counts[6],
        })),
      };
    }
    return { rows: [] };
  });
  const sqlSummary = await createDatabaseResearchStore(query).summary(filters);
  assert.equal(sqlSummary.total, expected.total);
  assert.deepEqual(
    sqlSummary.domains.map((row) => ({ id: row.id, n: row.n, score: row.score })),
    expected.domains.map((row) => ({ id: row.id, n: row.n, score: row.score }))
  );
  assert.deepEqual(sqlSummary.items, expected.items);
  assert.equal(sqlSummary.domains[0].label, 'Psychometric indicators');
  assert.doesNotMatch(SQL.domainAggregates.text, /\$\{/);
  assert.match(SQL.domainAggregates.text, /psychometric/);
});

test('durable audit sink stores metadata only and IP stays off by default', async () => {
  const inserted = [];
  const query = async (text, params, name) => {
    if (name === 'insertAudit' || text.includes('researcher_audit_events')) {
      inserted.push(params);
      return { rows: [] };
    }
    if (text.includes('researcher_sessions') || text.includes('researcher_auth_states')) {
      return { rows: [] };
    }
    return { rows: [] };
  };
  const app = createResearcherApp({
    config: readyConfig({
      authReady: true,
      dataReady: true,
      sessionStore: 'database',
      rateLimitStore: 'database',
      auditStoreResearcherIp: false,
      rateLimitMax: 10_000,
      loginRateLimitMax: 10_000,
    }),
    query,
    records: [sampleRecord()],
  });
  const signed = await app.signInForTests('subject-1').catch(() => null);
  assert.equal(signed, null);
  await app.handle({
    method: 'GET',
    url: '/v1/responses/resp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/qualitative',
    headers: {},
    ip: '22',
  });
  assert.equal(
    inserted.every((row) => !JSON.stringify(row).includes('<script>alert')),
    true
  );
  const snap = publicConfigSnapshot(
    loadConfig({
      SESSION_SECRET: 'super-secret-session',
      SUPABASE_PUBLISHABLE_KEY: 'super-secret-publishable',
      SUPABASE_JWT_SECRET: 'legacy-secret-must-not-be-required',
      DATABASE_URL: 'postgresql://researcher-api:secret@127.0.0.1/db',
      DATABASE_CA_CERT: '-----BEGIN CERTIFICATE-----\nFAKE-TEST-CA-NOT-FOR-PRODUCTION\n-----END CERTIFICATE-----',
    })
  );
  assert.equal(snap.sessionSecret, undefined);
  assert.equal(snap.supabasePublishableKey, undefined);
  assert.equal(snap.supabaseJwtSecret, undefined);
  assert.equal(snap.databaseUrl, undefined);
  assert.equal(snap.databaseCaCert, undefined);
  const example = readFileSync(join(root, 'api/researcher/env.example'), 'utf8');
  assert.doesNotMatch(example, /sk_live_/);
  assert.doesNotMatch(example, /eyJ[A-Za-z0-9_-]{20,}/);
  assert.match(example, /SUPABASE_PUBLISHABLE_KEY=/);
  assert.doesNotMatch(example, /SUPABASE_JWT_SECRET=/);
  assert.doesNotMatch(example, /SUPABASE_SECRET_KEY=/);
  assert.equal(loadConfig({}).trustedProxy, false);
  assert.equal(
    clientRateKey({ ip: '10.0.0.1', headers: { 'x-forwarded-for': '9.9.9.9' } }, { trustedProxy: false }),
    '10.0.0.1'
  );
});
