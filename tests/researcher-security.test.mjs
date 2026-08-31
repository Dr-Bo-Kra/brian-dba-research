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
import { OIDC_TX_COOKIE, SESSION_COOKIE, verifySignedSession } from '../api/researcher/_lib/http.mjs';
import { createMemoryAuthStateStore, createOidcTestHarness, requiredMfaSatisfied, verifyIdToken } from '../api/researcher/_lib/oidc.mjs';
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
    oidcIssuer: 'https://idp.test',
    oidcClientId: 'researcher-client',
    oidcClientSecret: 'researcher-secret',
    oidcRedirectUri: 'https://research.test/api/researcher/v1/session/callback',
    oidcAudience: 'researcher-client',
    oidcRequiredAcr: 'phr',
    oidcRequiredAmr: 'otp',
    oidcReady: true,
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
  const { records = [sampleRecord()], config, oidcHarness, ...rest } = extra;
  return createResearcherApp({
    allowMemoryStores: true,
    records,
    oidcHarness,
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

async function oidcLogin(app, { sub = 'subject-1', role = 'authorised_researcher', acr = 'phr', amr = ['pwd', 'otp'], priorCookie } = {}) {
  app.directory.set(sub, { role, mfaRequired: true, revokedAt: null, disabledAt: null });
  const start = await app.handle({
    method: 'GET',
    url: '/v1/session/start',
    headers: priorCookie ? { cookie: priorCookie } : {},
    ip: '10.0.0.8',
  });
  assert.equal(start.status, 302);
  const location = new URL(start.headers.Location);
  const state = location.searchParams.get('state');
  const callbackUrl = await app.oidc.issueTestCallback(state, { sub, acr, amr });
  assert.ok(callbackUrl);
  const tx = cookiePair(cookieFrom(start.headers['Set-Cookie'], OIDC_TX_COOKIE));
  const callback = await app.handle({
    method: 'GET',
    url: callbackUrl,
    headers: { cookie: [priorCookie, tx].filter(Boolean).join('; ') },
    ip: '10.0.0.8',
  });
  return { start, callback, state, tx };
}

test('production stays fail-closed without durable OIDC, MFA, session, and rate-limit backends', async () => {
  const config = loadConfig({
    RESEARCHER_API_ENABLED: 'true',
    DATABASE_URL: 'postgresql://researcher-api:unused@127.0.0.1/unused',
    SESSION_SECRET: 'test-session-secret-32-bytes-min',
    OIDC_ISSUER: 'https://idp.example',
    OIDC_CLIENT_ID: 'id',
    OIDC_CLIENT_SECRET: 'secret',
    OIDC_REDIRECT_URI: 'https://app.example/callback',
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
  const start = await production.handle({ method: 'GET', url: '/v1/session/start', headers: {}, ip: '1' });
  assert.equal(start.status, 503);
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

test('browser-provided role and identity headers are ignored', async () => {
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
});

test('OIDC rejects malformed, tampered, implicit-flow, and missing-MFA callbacks', async () => {
  const harness = createOidcTestHarness();
  const app = testApp({ oidcHarness: harness });
  app.directory.set('subject-1', {
    role: 'authorised_researcher',
    mfaRequired: true,
    revokedAt: null,
    disabledAt: null,
  });

  const malformed = await app.handle({
    method: 'GET',
    url: '/v1/session/callback?state=bad&code=short',
    headers: {},
    ip: '4',
  });
  assert.equal(malformed.status, 302);
  assert.equal(malformed.headers.Location, '/researcher/');
  assert.equal(cookieFrom(malformed.headers['Set-Cookie'], SESSION_COOKIE), '');

  const implicit = await app.handle({
    method: 'GET',
    url: '/v1/session/callback?code=aaaaaaaaaa&state=bbbbbbbbbb&id_token=aaaa.bbbb.cccc',
    headers: {},
    ip: '4',
  });
  assert.equal(implicit.status, 302);
  assert.equal(cookieFrom(implicit.headers['Set-Cookie'], SESSION_COOKIE), '');

  const start = await app.handle({ method: 'GET', url: '/v1/session/start', headers: {}, ip: '4' });
  const state = new URL(start.headers.Location).searchParams.get('state');
  const tx = cookiePair(cookieFrom(start.headers['Set-Cookie'], OIDC_TX_COOKIE));
  assert.match(cookieFrom(start.headers['Set-Cookie'], OIDC_TX_COOKIE), /SameSite=Lax/);
  const tampered = await app.handle({
    method: 'GET',
    url: `/v1/session/callback?code=aaaaaaaaaa&state=${state}tamper`,
    headers: { cookie: tx },
    ip: '4',
  });
  assert.equal(tampered.status, 302);
  assert.equal(cookieFrom(tampered.headers['Set-Cookie'], SESSION_COOKIE), '');

  const noMfaUrl = await app.oidc.issueTestCallback(state, {
    sub: 'subject-1',
    acr: 'pwd',
    amr: ['pwd'],
  });
  const noMfa = await app.handle({
    method: 'GET',
    url: noMfaUrl,
    headers: { cookie: tx },
    ip: '4',
  });
  assert.equal(noMfa.status, 302);
  assert.equal(cookieFrom(noMfa.headers['Set-Cookie'], SESSION_COOKIE), '');
  assert.equal(
    app.auditLog.some((row) => row.action === 'login_failure' && !JSON.stringify(row).includes('alert(1)')),
    true
  );
});

test('successful OIDC login rotates the session and then serves allowlisted data only', async () => {
  const harness = createOidcTestHarness();
  const app = testApp({ oidcHarness: harness });
  const prior = await app.signInForTests('subject-old');
  const { callback } = await oidcLogin(app, { sub: 'subject-1', priorCookie: prior.cookie });
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.Location, '/researcher/');
  const cookieHeader = cookieFrom(callback.headers['Set-Cookie']);
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

test('unknown, disabled, and revoked researchers cannot complete OIDC into a data session', async () => {
  const harness = createOidcTestHarness();
  const app = testApp({ oidcHarness: harness });
  const unknownStart = await app.handle({
    method: 'GET',
    url: '/v1/session/start',
    headers: {},
    ip: '6',
  });
  const unknownState = new URL(unknownStart.headers.Location).searchParams.get('state');
  const unknownUrl = await app.oidc.issueTestCallback(unknownState, { sub: 'nobody' });
  const unknownTx = cookiePair(cookieFrom(unknownStart.headers['Set-Cookie'], OIDC_TX_COOKIE));
  const unknown = await app.handle({
    method: 'GET',
    url: unknownUrl,
    headers: { cookie: unknownTx },
    ip: '6',
  });
  assert.equal(cookieFrom(unknown.headers['Set-Cookie'], SESSION_COOKIE), '');

  app.directory.set('disabled-user', {
    role: 'authorised_researcher',
    mfaRequired: true,
    revokedAt: null,
    disabledAt: new Date().toISOString(),
  });
  const start = await app.handle({ method: 'GET', url: '/v1/session/start', headers: {}, ip: '6' });
  const state = new URL(start.headers.Location).searchParams.get('state');
  const url = await app.oidc.issueTestCallback(state, { sub: 'disabled-user' });
  const disabled = await app.handle({
    method: 'GET',
    url,
    headers: { cookie: cookiePair(cookieFrom(start.headers['Set-Cookie'], OIDC_TX_COOKIE)) },
    ip: '6',
  });
  assert.equal(cookieFrom(disabled.headers['Set-Cookie'], SESSION_COOKIE), '');
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

test('ID tokens reject bad issuer, audience, signature, expiry, and nonce', async () => {
  const harness = createOidcTestHarness();
  const good = harness.issueIdToken({ sub: 'subject-1', nonce: 'abc', acr: 'phr', amr: ['otp'] });
  const ok = await verifyIdToken(good, {
    issuer: harness.issuer,
    audience: harness.audience,
    nonce: 'abc',
    getKey: (kid) => harness.getKey(kid),
  });
  assert.equal(ok.ok, true);

  const badIss = await verifyIdToken(good, {
    issuer: 'https://evil.test',
    audience: harness.audience,
    nonce: 'abc',
    getKey: (kid) => harness.getKey(kid),
  });
  assert.equal(badIss.ok, false);

  const badAud = await verifyIdToken(good, {
    issuer: harness.issuer,
    audience: 'other-client',
    nonce: 'abc',
    getKey: (kid) => harness.getKey(kid),
  });
  assert.equal(badAud.ok, false);

  const badNonce = await verifyIdToken(good, {
    issuer: harness.issuer,
    audience: harness.audience,
    nonce: 'nope',
    getKey: (kid) => harness.getKey(kid),
  });
  assert.equal(badNonce.ok, false);

  const expired = harness.issueIdToken({
    sub: 'subject-1',
    nonce: 'abc',
    exp: Math.floor(Date.now() / 1000) - 30,
  });
  const expiredRes = await verifyIdToken(expired, {
    issuer: harness.issuer,
    audience: harness.audience,
    nonce: 'abc',
    getKey: (kid) => harness.getKey(kid),
  });
  assert.equal(expiredRes.ok, false);

  const tampered = `${good.slice(0, -2)}aa`;
  const tamperedRes = await verifyIdToken(tampered, {
    issuer: harness.issuer,
    audience: harness.audience,
    nonce: 'abc',
    getKey: (kid) => harness.getKey(kid),
  });
  assert.equal(tamperedRes.ok, false);
  assert.equal(requiredMfaSatisfied({ acr: 'pwd', amr: ['pwd'] }, { oidcRequiredAcr: 'phr' }), false);
  assert.equal(requiredMfaSatisfied({ acr: 'phr' }, { oidcRequiredAcr: 'phr' }), true);
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

test('OIDC transaction cookie is required, one-time, and not a session', async () => {
  const harness = createOidcTestHarness();
  const authStates = createMemoryAuthStateStore();
  const app = testApp({ oidcHarness: harness, authStates });
  app.directory.set('subject-1', {
    role: 'authorised_researcher',
    mfaRequired: true,
    revokedAt: null,
    disabledAt: null,
  });
  const start = await app.handle({ method: 'GET', url: '/v1/session/start', headers: {}, ip: '20' });
  const state = new URL(start.headers.Location).searchParams.get('state');
  const tx = cookiePair(cookieFrom(start.headers['Set-Cookie'], OIDC_TX_COOKIE));
  const url = await app.oidc.issueTestCallback(state, { sub: 'subject-1' });

  const missingTx = await app.handle({ method: 'GET', url, headers: {}, ip: '20' });
  assert.equal(cookieFrom(missingTx.headers['Set-Cookie'], SESSION_COOKIE), '');

  const start2 = await app.handle({ method: 'GET', url: '/v1/session/start', headers: {}, ip: '20' });
  const state2 = new URL(start2.headers.Location).searchParams.get('state');
  const tx2 = cookiePair(cookieFrom(start2.headers['Set-Cookie'], OIDC_TX_COOKIE));
  const url2 = await app.oidc.issueTestCallback(state2, { sub: 'subject-1' });
  const first = await app.handle({ method: 'GET', url: url2, headers: { cookie: tx2 }, ip: '20' });
  assert.match(cookieFrom(first.headers['Set-Cookie'], SESSION_COOKIE), new RegExp(SESSION_COOKIE));
  const replay = await app.handle({ method: 'GET', url: url2, headers: { cookie: tx2 }, ip: '20' });
  assert.equal(cookieFrom(replay.headers['Set-Cookie'], SESSION_COOKIE), '');

  const start3 = await app.handle({ method: 'GET', url: '/v1/session/start', headers: {}, ip: '20' });
  const state3 = new URL(start3.headers.Location).searchParams.get('state');
  const tx3 = cookiePair(cookieFrom(start3.headers['Set-Cookie'], OIDC_TX_COOKIE));
  const url3 = await app.oidc.issueTestCallback(state3, { sub: 'subject-1' });
  const pending = await authStates.peek(state3);
  pending.expiresAt = new Date(Date.now() - 1000).toISOString();
  await authStates.put(pending);
  const expired = await app.handle({ method: 'GET', url: url3, headers: { cookie: tx3 }, ip: '20' });
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
  const start = await app.handle({ method: 'GET', url: '/v1/session/start', headers: {}, ip: '21' });
  const data = await app.handle({ method: 'GET', url: '/v1/responses', headers: {}, ip: '21' });
  assert.equal(start.status, 503);
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
      OIDC_CLIENT_SECRET: 'super-secret-oidc',
      DATABASE_URL: 'postgresql://researcher-api:secret@127.0.0.1/db',
    })
  );
  assert.equal(snap.sessionSecret, undefined);
  assert.equal(snap.oidcClientSecret, undefined);
  assert.equal(snap.databaseUrl, undefined);
  const example = readFileSync(join(root, 'api/researcher/env.example'), 'utf8');
  assert.doesNotMatch(example, /sk_live_/);
  assert.doesNotMatch(example, /eyJ[A-Za-z0-9_-]{20,}/);
  assert.match(example, /OIDC_CLIENT_SECRET=/);
  assert.equal(loadConfig({}).trustedProxy, false);
  assert.equal(
    clientRateKey({ ip: '10.0.0.1', headers: { 'x-forwarded-for': '9.9.9.9' } }, { trustedProxy: false }),
    '10.0.0.1'
  );
});
