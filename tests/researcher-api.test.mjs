import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createResearcherApp } from '../api/researcher/_lib/app.mjs';
import { loadConfig } from '../api/researcher/_lib/config.mjs';
import { authorize, isActiveResearcher, sanitizeAuditDetail } from '../api/researcher/_lib/authorize.mjs';
import { buildCsv, escapeCsvCell } from '../api/researcher/_lib/csv.mjs';
import { SQL, assertBoundQuery } from '../api/researcher/_lib/db.mjs';
import { parseFilters, parseDeletionBody, parseExportBody, parseParticipantRef } from '../api/researcher/_lib/validate.mjs';
import { SESSION_COOKIE } from '../api/researcher/_lib/http.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(root, relative), 'utf8');

function readyConfig(extra = {}) {
  return {
    enabled: true,
    exportsEnabled: false,
    deletionsEnabled: false,
    databaseUrl: 'postgresql://researcher-api:unused@127.0.0.1/unused',
    sessionSecret: 'test-session-secret-32-bytes-min',
    mfaAssuranceReady: true,
    authReady: false,
    dataReady: true,
    sessionMinutes: 20,
    maxPageSize: 50,
    maxExportRows: 2000,
    rateLimitWindowMs: 60_000,
    rateLimitMax: 10_000,
    loginRateLimitMax: 10_000,
    recordRateLimitMax: 10_000,
    qualitativeRateLimitMax: 10_000,
    auditStoreResearcherIp: false,
    allowedOrigin: '',
    archivePath: '/researcher/',
    ...extra,
  };
}

function testApp(extra = {}) {
  const { records, config, ...rest } = extra;
  return createResearcherApp({
    allowMemoryStores: true,
    records,
    config: readyConfig(config),
    ...rest,
  });
}

function sampleRecord(ref = 'resp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') {
  return {
    client_record_id: ref,
    created_at: '2026-08-01T12:00:00.000Z',
    profile: { countryRegion: 'india', position: 'credit-manager', yearsLending: '6-10' },
    assessment: { overall: { score: 5.2 } },
    qualitative: { openResponses: { G26: 'not for logs' }, roleDescription: 'hidden' },
    legal_hold: false,
  };
}

async function authed(app, extraHeaders = {}) {
  const signed = await app.signInForTests('subject-1');
  return {
    cookie: signed.cookie,
    csrf: signed.csrf,
    headers: {
      cookie: signed.cookie,
      'x-csrf-token': signed.csrf,
      ...extraHeaders,
    },
  };
}

test('researcher API is fail-closed by default', () => {
  const config = loadConfig({
    RESEARCHER_API_ENABLED: 'false',
    EXPORTS_ENABLED: 'false',
    DELETIONS_ENABLED: 'false',
  });
  assert.equal(config.enabled, false);
  assert.equal(config.exportsEnabled, false);
  assert.equal(config.deletionsEnabled, false);
  assert.equal(config.dbDiagnosticEnabled, false);
  assert.equal(config.dataReady, false);
  assert.equal(config.authReady, false);
  assert.equal(config.allowMemoryStores, false);
  const memoryIgnored = loadConfig({
    RESEARCHER_API_ENABLED: 'true',
    SESSION_STORE: 'memory',
    RATE_LIMIT_STORE: 'memory',
    DATABASE_URL: 'postgresql://researcher-api:unused@127.0.0.1/unused',
    SESSION_SECRET: 'test-session-secret-32-bytes-min',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_not_a_jwt',
  });
  assert.equal(memoryIgnored.sessionStore, '');
  assert.equal(memoryIgnored.rateLimitStore, '');
  assert.equal(memoryIgnored.authReady, false);
  const jwtSecretNotRequired = loadConfig({
    RESEARCHER_API_ENABLED: 'true',
    SESSION_STORE: 'database',
    RATE_LIMIT_STORE: 'database',
    DATABASE_URL: 'postgresql://researcher-api:unused@127.0.0.1/unused',
    SESSION_SECRET: 'test-session-secret-32-bytes-min',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_not_a_jwt',
  });
  assert.equal(jwtSecretNotRequired.authReady, true);
  assert.equal(jwtSecretNotRequired.supabasePublishableKey, 'sb_publishable_test_not_a_jwt');
  assert.equal(jwtSecretNotRequired.supabaseJwtSecret, undefined);
});

test('authorisation denies by default and uses roles not a named person', () => {
  assert.equal(isActiveResearcher(null), false);
  assert.equal(isActiveResearcher({ role: 'authorised_researcher', mfaOk: false }), false);
  assert.equal(authorize({ role: 'authorised_researcher', mfaOk: true }, 'summary').ok, true);
  assert.equal(authorize({ role: 'viewer', mfaOk: true }, 'summary').ok, false);
  const sources = [
    read('api/researcher/_lib/authorize.mjs'),
    read('api/researcher/_lib/app.mjs'),
    read('researcher/dashboard.js'),
    read('researcher/index.html'),
  ];
  for (const source of sources) {
    assert.doesNotMatch(source, /Brian-only/i);
    assert.doesNotMatch(source, /brianpereira@/i);
    assert.doesNotMatch(source, /hard-?code.*email/i);
  }
});

test('filters reject unknown fields, sort, and malformed references', () => {
  assert.equal(parseParticipantRef('resp_not-valid'), null);
  assert.equal(parseFilters({ columns: 'responses' }).ok, false);
  assert.equal(parseFilters({ sort: 'assessment' }).ok, false);
  assert.equal(parseFilters({ region: 'india;drop table' }).ok, false);
  assert.equal(parseFilters({ from: '2026-08-01', to: '2026-08-02' }).ok, true);
  assert.equal(parseDeletionBody({ reference: 'resp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', confirm: true }).ok, true);
  assert.equal(parseDeletionBody({ reference: 'resp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }).ok, false);
  assert.equal(parseExportBody({ confirm: true, sql: 'select 1' }, 10).ok, false);
});

test('CSV export escapes spreadsheet formula injection', () => {
  assert.equal(escapeCsvCell('=CMD'), "'=CMD");
  assert.equal(escapeCsvCell('+1+1'), "'+1+1");
  assert.equal(escapeCsvCell('-2'), "'-2");
  assert.equal(escapeCsvCell('@SUM(1)'), "'@SUM(1)");
  const csv = buildCsv([{ participant_reference: '=1+1', accepted_at: '', region: '', role: '', experience: '', orientation: '' }]);
  assert.match(csv, /'=1\+1/);
  assert.doesNotMatch(csv, /responses/);
});

test('SQL templates are parameterised and do not concatenate user input', () => {
  Object.values(SQL).forEach((query) => assertBoundQuery(query));
  assert.match(SQL.listResponses.text, /\$1/);
  assert.match(SQL.deleteByReference.text, /\$1/);
  assert.doesNotMatch(SQL.listResponses.text, /\$\{/);
});

test('audit sanitiser strips survey answers', () => {
  const clean = sanitizeAuditDetail({
    count: 3,
    responses: { B1: 7 },
    qualitative: { openResponses: { G26: 'secret' } },
    participant_reference: 'resp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  });
  assert.equal(clean.count, 3);
  assert.equal(clean.responses, undefined);
  assert.equal(clean.qualitative, undefined);
});

test('unauthenticated callers never receive survey records', async () => {
  const app = testApp({ records: [sampleRecord()] });
  const closed = testApp({
    records: [sampleRecord()],
    config: { enabled: false, dataReady: false },
  });
  const anon = await app.handle({ method: 'GET', url: '/v1/responses', headers: {}, ip: '1' });
  assert.equal(anon.status, 401);
  assert.doesNotMatch(anon.body, /resp_/);
  const disabled = await closed.handle({ method: 'GET', url: '/v1/responses', headers: {}, ip: '1' });
  assert.equal(disabled.status, 503);
  assert.doesNotMatch(disabled.body, /resp_/);
  const login = await app.handle({
    method: 'POST',
    url: '/v1/session/login',
    headers: {},
    body: { email: 'researcher@example.test', password: 'x' },
    ip: '2',
  });
  assert.equal(login.status, 503);
});

test('authenticated reads return allowlisted ledger fields only', async () => {
  const app = testApp({ records: [sampleRecord()] });
  const { headers } = await authed(app);
  const res = await app.handle({ method: 'GET', url: '/v1/responses', headers, ip: '3' });
  assert.equal(res.status, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.records.length, 1);
  assert.equal(payload.records[0].participant_reference, 'resp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  assert.equal(payload.records[0].qualitative, undefined);
  assert.equal(payload.records[0].responses, undefined);
  assert.equal(payload.records[0].id, undefined);
});

test('export and delete stay unavailable until policy flags are enabled', async () => {
  const app = testApp({ records: [sampleRecord()] });
  const { headers } = await authed(app);
  const exported = await app.handle({
    method: 'POST',
    url: '/v1/exports',
    headers,
    body: { confirm: true },
    ip: '4',
  });
  assert.equal(exported.status, 503);
  const deleted = await app.handle({
    method: 'POST',
    url: '/v1/deletions',
    headers,
    body: { reference: 'resp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', confirm: true },
    ip: '4',
  });
  assert.equal(deleted.status, 503);
});

test('enabled deletion is generic and respects legal hold', async () => {
  const held = sampleRecord('resp_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  held.legal_hold = true;
  const app = testApp({
    records: [sampleRecord(), held],
    config: { deletionsEnabled: true },
  });
  const { headers } = await authed(app);
  const missing = await app.handle({
    method: 'POST',
    url: '/v1/deletions',
    headers,
    body: { reference: 'resp_cccccccccccccccccccccccccccccccc', confirm: true },
    ip: '5',
  });
  assert.equal(missing.status, 200);
  assert.deepEqual(JSON.parse(missing.body), { ok: true });
  const blocked = await app.handle({
    method: 'POST',
    url: '/v1/deletions',
    headers,
    body: { reference: held.client_record_id, confirm: true },
    ip: '5',
  });
  assert.equal(blocked.status, 200);
  assert.equal(
    app.records.some((row) => row.client_record_id === held.client_record_id),
    true
  );
  const noCsrf = await app.handle({
    method: 'POST',
    url: '/v1/deletions',
    headers: { cookie: headers.cookie },
    body: { reference: 'resp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', confirm: true },
    ip: '5',
  });
  assert.equal(noCsrf.status, 403);
});

test('enabled export uses approved schema and cookies are host-scoped', async () => {
  const app = testApp({
    records: [sampleRecord()],
    config: { exportsEnabled: true },
  });
  const { headers, cookie } = await authed(app);
  assert.match(cookie, new RegExp(SESSION_COOKIE));
  const exported = await app.handle({
    method: 'POST',
    url: '/v1/exports',
    headers,
    body: { confirm: true },
    ip: '6',
  });
  assert.equal(exported.status, 200);
  assert.match(exported.headers['Content-Type'], /csv/);
  assert.match(exported.body, /participant_reference/);
  assert.doesNotMatch(exported.body, /not for logs/);
  assert.equal(app.auditLog.some((row) => row.action === 'export'), true);
  assert.equal(
    app.auditLog.some((row) => JSON.stringify(row).includes('not for logs')),
    false
  );
});

test('participant-level export requires auth, CSRF, and approved columns only', async () => {
  const target = sampleRecord('resp_dddddddddddddddddddddddddddddddd');
  const other = sampleRecord('resp_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee');
  const app = testApp({
    records: [target, other],
    config: { exportsEnabled: true },
  });
  const { headers } = await authed(app);
  const noCsrf = await app.handle({
    method: 'POST',
    url: '/v1/exports',
    headers: { cookie: headers.cookie },
    body: { confirm: true, reference: target.client_record_id },
    ip: '6b',
  });
  assert.equal(noCsrf.status, 403);
  const exported = await app.handle({
    method: 'POST',
    url: '/v1/exports',
    headers,
    body: { confirm: true, reference: target.client_record_id },
    ip: '6b',
  });
  assert.equal(exported.status, 200);
  assert.match(exported.body, /resp_dddddddddddddddddddddddddddddddd/);
  assert.doesNotMatch(exported.body, /resp_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee/);
  assert.doesNotMatch(exported.body, /not for logs/);
  assert.doesNotMatch(exported.body, /password|csrf|session/i);
  assert.equal(
    app.auditLog.some(
      (row) =>
        row.action === 'export' &&
        row.detail?.scope === 'participant_export_schema' &&
        row.detail?.participant_reference === target.client_record_id
    ),
    true
  );
});

test('retention review lists due refs without auto-delete and stays authenticated', async () => {
  const old = sampleRecord('resp_ffffffffffffffffffffffffffffffff');
  old.created_at = '2024-01-01T00:00:00.000Z';
  const recent = sampleRecord('resp_99999999999999999999999999999999');
  recent.created_at = new Date().toISOString();
  const app = testApp({
    records: [old, recent],
    config: { retentionMonths: 12 },
  });
  const anon = await app.handle({ method: 'GET', url: '/v1/retention-review', headers: {}, ip: '7' });
  assert.equal(anon.status, 401);
  const { headers } = await authed(app);
  const review = await app.handle({
    method: 'GET',
    url: '/v1/retention-review',
    headers,
    ip: '7',
  });
  assert.equal(review.status, 200);
  const payload = JSON.parse(review.body);
  assert.equal(payload.policy.auto_delete, false);
  assert.equal(payload.policy.basis, 'record_age');
  assert.equal(payload.records.length, 1);
  assert.equal(payload.records[0].participant_reference, old.client_record_id);
  assert.equal(app.records.some((row) => row.client_record_id === old.client_record_id), true);
  assert.equal(app.auditLog.some((row) => row.action === 'retention_review'), true);
});

test('session advertises export and deletion capability flags without enabling them by default', async () => {
  const app = testApp({ records: [sampleRecord()] });
  const { headers } = await authed(app);
  const session = await app.handle({ method: 'GET', url: '/v1/session', headers, ip: '8' });
  assert.equal(session.status, 200);
  const payload = JSON.parse(session.body);
  assert.equal(payload.authenticated, true);
  assert.equal(payload.exportsEnabled, false);
  assert.equal(payload.deletionsEnabled, false);
  assert.equal(payload.retentionAutoDelete, false);
  assert.equal(payload.retentionMonths, 12);
});

test('researcher UI connects to the same-origin API without secrets or a password-only workspace', () => {
  const html = read('researcher/index.html');
  const js = read('researcher/dashboard.js');
  const config = read('researcher/config.js');
  assert.match(config, /RESEARCHER_ENDPOINT:\s*'\/api\/researcher'/);
  assert.doesNotMatch(config, /SUPABASE_/);
  assert.doesNotMatch(config, /DATABASE_URL/);
  assert.doesNotMatch(config, /SESSION_SECRET/);
  assert.match(js, /showDisconnectedWorkspace/);
  assert.match(js, /if \(!apiConfigured\) \{\s*showDisconnectedWorkspace\(\);/);
  assert.match(js, /credentials: 'include'/);
  assert.match(js, /X-CSRF-Token/);
  assert.match(js, /\/v1\/session\/login/);
  assert.match(js, /\/v1\/session\/mfa/);
  assert.match(js, /payload\?\.mfaRequired/);
  assert.match(js, /authenticated !== true/);
  assert.match(js, /showMfaStep/);
  assert.doesNotMatch(js, /localStorage\.setItem/);
  assert.doesNotMatch(js, /sessionStorage\.setItem/);
  assert.doesNotMatch(js, /auth-secret/);
  assert.match(html, /type="password"/);
  assert.match(html, />Sign in</);
  assert.doesNotMatch(html, /Future interface · disconnected/i);
  assert.doesNotMatch(html, /Protected researcher API is not connected/);
  assert.doesNotMatch(js, /service_role/);
  assert.match(html, /no mock login/i);
  assert.doesNotMatch(html, /correct-horse-battery|default password/i);
  assert.match(read('config.js'), /COLLECTION_ENABLED:\s*false/);
  assert.match(read('config.js'), /SUBMISSION_ENDPOINT:\s*''/);
  assert.match(js, /exportsEnabled/);
  assert.match(js, /deletionsEnabled/);
  assert.match(js, /session\?\.exportsEnabled|session\.exportsEnabled/);
  assert.match(js, /session\?\.deletionsEnabled|session\.deletionsEnabled/);
  assert.doesNotMatch(js, /LIVE_EXPORTS_ENABLED\s*=\s*true/);
  assert.doesNotMatch(js, /LIVE_DELETIONS_ENABLED\s*=\s*true/);
  assert.match(js, /\/v1\/exports/);
  assert.match(js, /\/v1\/deletions/);
  assert.match(js, /\/v1\/retention-review/);
});

test('repository files do not embed privileged credentials', () => {
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
  }
});

function quantitativeRecord(ref, overrides = {}) {
  const profile = {
    gender: 'female',
    age: '30-39',
    education: 'masters',
    institutionType: 'commercial-bank',
    position: 'credit-manager',
    yearsLending: '6-10',
    yearsFinancialServices: '6-10',
    areaOperation: 'urban',
    involvement: 'assess',
    usesAltIndicators: 'yes',
    countryRegion: 'india',
    ...(overrides.profile || {}),
  };
  const likert = Object.fromEntries(
    ['B1','B2','B3','B4','B5','C6','C7','C8','C9','C10','D11','D12','D13','D14','D15','E16','E17','E18','E19','E20','F21','F22','F23','F24','F25'].map(
      (id) => [id, overrides.likertFill ?? 5]
    )
  );
  return {
    client_record_id: ref,
    created_at: overrides.created_at || '2026-08-01T12:00:00.000Z',
    profile,
    region: profile.countryRegion,
    role: profile.position,
    experience: profile.yearsLending,
    orientation: 5.0,
    assessment: {
      overall: { score: 5.0 },
      domains: [
        { id: 'psychometric', label: 'Psychometric indicators', score: 5.0 },
        { id: 'social', label: 'Social capital', score: 5.0 },
        { id: 'behavioral', label: 'Behavioral economics', score: 5.0 },
        { id: 'readiness', label: 'Organizational readiness', score: 5.0 },
        { id: 'inclusiveDecision', label: 'Inclusive decision-making', score: 5.0 },
      ],
    },
    responses: {
      quantitative: {
        demographics: { ...profile },
        likert,
      },
    },
    legal_hold: false,
    ...overrides.rest,
  };
}

test('summary exposes last_7d, profile composition, and domain sample SD', async () => {
  const now = new Date().toISOString();
  const app = testApp({
    records: [
      quantitativeRecord('resp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', { created_at: now }),
      quantitativeRecord('resp_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', {
        created_at: '2026-01-01T12:00:00.000Z',
        profile: { countryRegion: 'europe-uk', position: 'risk-manager', gender: 'male' },
      }),
    ],
  });
  const { headers } = await authed(app);
  const response = await app.handle({ method: 'GET', url: '/v1/summary', headers, ip: 'q1' });
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.total, 2);
  assert.ok(Number.isInteger(body.last_7d));
  assert.ok(body.last_7d >= 1);
  assert.ok(body.profile?.countryRegion?.length >= 1);
  assert.ok(body.domains.every((row) => 'sd' in row && Array.isArray(row.counts)));
  assert.doesNotMatch(JSON.stringify(body), /openResponses|roleDescription|not for logs/);
});

test('segments endpoint returns descriptive stats without free-text or significance', async () => {
  const app = testApp({
    records: [
      quantitativeRecord('resp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', {
        profile: { countryRegion: 'india', gender: 'female' },
        likertFill: 6,
      }),
      quantitativeRecord('resp_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', {
        profile: { countryRegion: 'europe-uk', gender: 'male' },
        likertFill: 3,
      }),
    ],
  });
  const { headers } = await authed(app);
  const denied = await app.handle({
    method: 'GET',
    url: '/v1/segments?dimension=countryRegion&measure=overall',
    ip: 'q2',
  });
  assert.equal(denied.status, 401);
  const response = await app.handle({
    method: 'GET',
    url: '/v1/segments?dimension=countryRegion&measure=overall',
    headers,
    ip: 'q2',
  });
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.descriptive_only, true);
  assert.equal(body.dimension, 'countryRegion');
  assert.ok(body.segments.length >= 2);
  assert.ok(body.segments.every((row) => Number.isFinite(row.mean) && Number.isInteger(row.n)));
  assert.doesNotMatch(JSON.stringify(body), /p-value|significant|openResponses|password/i);
  const bad = await app.handle({
    method: 'GET',
    url: '/v1/segments?dimension=password&measure=overall',
    headers,
    ip: 'q2',
  });
  assert.equal(bad.status, 400);
});

test('record detail returns quantitative fields only and export uses study columns', async () => {
  const app = testApp({
    records: [quantitativeRecord('resp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')],
    config: { exportsEnabled: true },
  });
  const { headers } = await authed(app);
  const detail = await app.handle({
    method: 'GET',
    url: '/v1/responses/resp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    headers,
    ip: 'q3',
  });
  assert.equal(detail.status, 200);
  const row = JSON.parse(detail.body);
  assert.equal(row.profile.gender, 'female');
  assert.ok(Array.isArray(row.domains));
  assert.equal(row.likert.B1, 5);
  assert.equal(row.qualitative, undefined);
  assert.doesNotMatch(JSON.stringify(row), /openResponses|roleDescription/);

  const exported = await app.handle({
    method: 'POST',
    url: '/v1/exports',
    headers,
    body: { confirm: true },
    ip: 'q3',
  });
  assert.equal(exported.status, 200);
  assert.match(exported.body, /gender,age,education/);
  assert.match(exported.body, /domain_psychometric/);
  assert.match(exported.body, /,B1,/);
  assert.doesNotMatch(exported.body, /not for logs|openResponses|password|csrf/i);
});
