import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubmissionApp } from '../api/submission/_lib/app.mjs';
import { loadConfig, publicConfigSnapshot } from '../api/submission/_lib/config.mjs';
import { SQL, assertBoundQuery } from '../api/submission/_lib/db.mjs';
import { validateSubmissionPayload } from '../api/submission/_lib/validate.mjs';
import { createFixtureResearchStore } from '../api/researcher/_lib/data.mjs';
import { DOMAIN_ORDER as RESEARCHER_DOMAIN_ORDER, ITEM_ORDER as RESEARCHER_ITEM_ORDER } from '../api/researcher/_lib/data.mjs';
import { DOMAIN_ORDER, ITEM_ORDER } from '../api/submission/_lib/constants.mjs';
import {
  buildAssessment,
  buildLikert,
  buildValidSubmissionPayload,
  readySubmissionConfig,
} from './helpers/submission-payload.mjs';

function testApp(extra = {}) {
  const { config, ...rest } = extra;
  return createSubmissionApp({
    allowMemoryStores: true,
    config: readySubmissionConfig(config),
    ...rest,
  });
}

function originHeaders(extra = {}) {
  return {
    origin: 'https://survey.example',
    'content-type': 'application/json',
    host: 'survey.example',
    ...extra,
  };
}

async function post(app, body, headers = originHeaders(), url = 'https://survey.example/api/submission') {
  return app.handle({
    method: 'POST',
    url,
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ip: '203.0.113.10',
  });
}

test('submission instrument constants match researcher analytics order', () => {
  assert.deepEqual([...ITEM_ORDER], [...RESEARCHER_ITEM_ORDER]);
  assert.deepEqual([...DOMAIN_ORDER], [...RESEARCHER_DOMAIN_ORDER]);
});

test('public config enables protected HTTPS collection endpoint', async () => {
  const { readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const configJs = readFileSync(join(root, 'config.js'), 'utf8');
  assert.match(configJs, /COLLECTION_ENABLED:\s*true/);
  assert.match(configJs, /SUBMISSION_ENDPOINT:\s*'https:\/\/brian-dba-research\.vercel\.app\/api\/submission'/);
});

test('server kill switch fail-closed when SUBMISSION_API_ENABLED is not true', async () => {
  const app = createSubmissionApp({
    allowMemoryStores: true,
    config: readySubmissionConfig({ enabled: false, dataReady: false }),
  });
  const res = await post(app, buildValidSubmissionPayload());
  assert.equal(res.status, 503);
  assert.equal(JSON.parse(res.body).error, 'unavailable');
});

test('missing server database configuration fails closed', () => {
  const config = loadConfig({
    SUBMISSION_API_ENABLED: 'false',
    SUBMISSION_DATABASE_URL: '',
    SUBMISSION_RATE_LIMIT_STORE: '',
  });
  assert.equal(config.enabled, false);
  assert.equal(config.dataReady, false);
  assert.equal(publicConfigSnapshot(config).databaseUrl, undefined);
});

test('wrong methods and content-type are rejected', async () => {
  const app = testApp();
  const get = await app.handle({
    method: 'GET',
    url: 'https://survey.example/api/submission',
    headers: originHeaders(),
    ip: '203.0.113.10',
  });
  assert.equal(get.status, 400);

  const badType = await post(app, buildValidSubmissionPayload(), originHeaders({ 'content-type': 'text/plain' }));
  assert.equal(badType.status, 400);
});

test('malformed JSON and oversized bodies are rejected', async () => {
  const app = testApp({ config: { maxBodyBytes: 256 } });
  const malformed = await post(app, '{"instrument_id":');
  assert.equal(malformed.status, 400);

  const huge = await post(app, buildValidSubmissionPayload(), originHeaders(), 'https://survey.example/api/submission');
  // Still may pass validation size; force oversized via raw buffer path
  const oversized = await app.handle({
    method: 'POST',
    url: 'https://survey.example/api/submission',
    headers: originHeaders(),
    body: 'y'.repeat(300),
    ip: '203.0.113.10',
  });
  assert.equal(oversized.status, 400);
});

test('unknown fields and missing required fields are rejected', async () => {
  const app = testApp();
  const unknown = buildValidSubmissionPayload({
    patch: (payload) => {
      payload.user_agent = 'evil';
    },
  });
  assert.equal((await post(app, unknown)).status, 400);

  const missing = buildValidSubmissionPayload({
    patch: (payload) => {
      delete payload.consented_at;
    },
  });
  assert.equal((await post(app, missing)).status, 400);
});

test('bad participant refs and synthetic seed prefix are rejected', async () => {
  const app = testApp();
  assert.equal(
    (await post(app, buildValidSubmissionPayload({ client_record_id: 'resp_short' }))).status,
    400
  );
  assert.equal(
    (
      await post(
        app,
        buildValidSubmissionPayload({
          client_record_id: 'resp_00000000-0000-4000-8000-000000000001',
        })
      )
    ).status,
    400
  );
});

test('bad timestamps and invalid Likert values are rejected', async () => {
  const app = testApp();
  assert.equal(
    (await post(app, buildValidSubmissionPayload({ consented_at: 'not-a-date' }))).status,
    400
  );

  const missingLikert = buildValidSubmissionPayload({
    patch: (payload) => {
      delete payload.responses.quantitative.likert.B1;
    },
  });
  assert.equal((await post(app, missingLikert)).status, 400);

  const outOfRange = buildValidSubmissionPayload({
    likert: { ...buildLikert(5), B1: 8 },
    assessment: buildAssessment({ ...buildLikert(5), B1: 5 }),
  });
  // Force inconsistent / invalid likert after assessment build
  outOfRange.responses.quantitative.likert.B1 = 8;
  assert.equal((await post(app, outOfRange)).status, 400);
});

test('excessive assessment narrative length and malformed domains are rejected', async () => {
  const app = testApp();
  const longSummary = buildValidSubmissionPayload({
    patch: (payload) => {
      payload.assessment.overall.summary = 'x'.repeat(1201);
    },
  });
  assert.equal((await post(app, longSummary)).status, 400);

  const badDomain = buildValidSubmissionPayload({
    patch: (payload) => {
      payload.assessment.domains[0].id = 'not-a-domain';
    },
  });
  assert.equal((await post(app, badDomain)).status, 400);
});

test('qualitative smuggling and free-text profile keys are rejected', async () => {
  const app = testApp();
  const withQual = buildValidSubmissionPayload({
    patch: (payload) => {
      payload.responses.qualitative = {
        yearsFinancialServices: '6-10',
        roleDescription: 'smuggled free text that must be rejected',
        openResponses: { Q1: 'should not accept qualitative on live contract' },
      };
    },
  });
  assert.equal((await post(app, withQual)).status, 400);

  const withRole = buildValidSubmissionPayload({
    patch: (payload) => {
      payload.profile.roleDescription = 'smuggled role description';
      payload.responses.quantitative.demographics.roleDescription = 'smuggled role description';
    },
  });
  assert.equal((await post(app, withRole)).status, 400);

  const withDisclaimer = buildValidSubmissionPayload({
    patch: (payload) => {
      payload.responses.disclaimer = 'attacker free text channel';
    },
  });
  assert.equal((await post(app, withDisclaimer)).status, 400);

  const ok = await post(
    app,
    buildValidSubmissionPayload({ client_record_id: 'resp_ffffffff-ffff-4fff-8fff-ffffffffffff' })
  );
  assert.equal(ok.status, 200);
  assert.equal(JSON.parse(ok.body).ok, true);
});

test('accepted quantitative payload omits qualitative keys', () => {
  const validated = validateSubmissionPayload(buildValidSubmissionPayload());
  assert.equal(validated.ok, true);
  assert.equal(validated.row.responses.qualitative, undefined);
  assert.equal(validated.row.profile.roleDescription, undefined);
  assert.equal(validated.row.responses.instrumentType, 'quantitative-desk-assessment');
  assert.ok(validated.row.profile.yearsFinancialServices);
  assert.equal(
    validated.row.responses.quantitative.demographics.yearsFinancialServices,
    validated.row.profile.yearsFinancialServices
  );
});

test('non-finite browser assessment scores are replaced; JSON null scores rejected', async () => {
  const app = testApp();
  const direct = validateSubmissionPayload(
    buildValidSubmissionPayload({
      patch: (body) => {
        body.assessment.overall.score = Number.NaN;
        body.assessment.domains[0].score = Number.POSITIVE_INFINITY;
      },
    })
  );
  assert.equal(direct.ok, true);
  assert.equal(direct.row.assessment.overall.score, 5);
  assert.equal(direct.row.assessment.domains[0].score, 5);

  // JSON cannot encode NaN/Infinity; they become null and fail the wire contract.
  const jsonNull = buildValidSubmissionPayload({
    client_record_id: 'resp_44444444-4444-4444-8444-444444444444',
    patch: (body) => {
      body.assessment.overall.score = null;
    },
  });
  assert.equal((await post(app, jsonNull)).status, 400);
});

test('origin rejection and restrictive CORS', async () => {
  const app = testApp();
  const rejected = await post(
    app,
    buildValidSubmissionPayload(),
    originHeaders({ origin: 'https://evil.example' })
  );
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers['Access-Control-Allow-Origin'], undefined);

  const ok = await post(app, buildValidSubmissionPayload({ client_record_id: 'resp_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }));
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['Access-Control-Allow-Origin'], 'https://survey.example');
  assert.notEqual(ok.headers['Access-Control-Allow-Origin'], '*');

  const preflight = await app.handle({
    method: 'OPTIONS',
    url: 'https://survey.example/api/submission',
    headers: originHeaders(),
    ip: '203.0.113.10',
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['Access-Control-Allow-Origin'], 'https://survey.example');
});

test('rate limit returns generic 429', async () => {
  const app = testApp({ config: { rateLimitMax: 2 } });
  const a = await post(app, buildValidSubmissionPayload({ client_record_id: 'resp_cccccccc-cccc-4ccc-8ccc-cccccccccccc' }));
  const b = await post(app, buildValidSubmissionPayload({ client_record_id: 'resp_dddddddd-dddd-4ddd-8ddd-dddddddddddd' }));
  const c = await post(app, buildValidSubmissionPayload({ client_record_id: 'resp_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' }));
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(c.status, 429);
  assert.equal(JSON.parse(c.body).error, 'rate_limited');
});

test('duplicate replay is idempotent without existence leak', async () => {
  const app = testApp();
  const payload = buildValidSubmissionPayload({
    client_record_id: 'resp_ffffffff-ffff-4fff-8fff-ffffffffffff',
  });
  const first = await post(app, payload);
  const second = await post(app, payload);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(JSON.parse(first.body), { ok: true });
  assert.deepEqual(JSON.parse(second.body), { ok: true });
  assert.equal(app.store.rows.size, 1);
});

test('database unavailable surfaces sanitized unavailable error', async () => {
  const app = createSubmissionApp({
    allowMemoryStores: true,
    config: readySubmissionConfig(),
    store: {
      backend: 'memory',
      async insert() {
        throw Object.assign(new Error('boom'), { code: 'unavailable' });
      },
    },
  });
  const res = await post(app, buildValidSubmissionPayload({ client_record_id: 'resp_11111111-1111-4111-8111-111111111111' }));
  assert.equal(res.status, 503);
  assert.equal(JSON.parse(res.body).error, 'unavailable');
  assert.doesNotMatch(res.body, /boom|password|postgresql/i);
});

test('successful synthetic-shaped payload stores researcher-compatible row', async () => {
  const app = testApp();
  const payload = buildValidSubmissionPayload({
    client_record_id: 'resp_22222222-2222-4222-8222-222222222222',
  });
  const res = await post(app, payload);
  assert.equal(res.status, 200);
  const stored = app.store.rows.get(payload.client_record_id);
  assert.ok(stored);
  assert.equal(stored.instrument_id, payload.instrument_id);
  assert.deepEqual(stored.responses.quantitative.likert.B1, 5);

  const researchStore = createFixtureResearchStore([
    {
      client_record_id: stored.client_record_id,
      created_at: stored.created_at,
      profile: stored.profile,
      responses: stored.responses,
      assessment: stored.assessment,
      legal_hold: false,
    },
  ]);
  const summary = await researchStore.summary({});
  assert.equal(summary.total, 1);
  assert.ok(Number.isFinite(summary.mean_orientation));
  assert.ok(summary.domains.length > 0);
  assert.ok(summary.items.length > 0);
  const list = await researchStore.list({ limit: 10, q: '', from: null, to: null, region: null, role: null, experience: null });
  assert.equal(list.records[0].participant_reference, payload.client_record_id);
  assert.equal(list.records[0].region, 'india');
});

test('SQL helpers stay bound and insert-only', () => {
  assertBoundQuery(SQL.insertSubmission);
  assertBoundQuery(SQL.hitRateLimit);
  assert.match(SQL.insertSubmission.text, /insert into public\.assessment_responses/i);
  assert.doesNotMatch(SQL.insertSubmission.text, /\bselect\b/i);
  assert.match(SQL.hitRateLimit.text, /submission_rate_limits/);
});

test('direct validator accepts canonical payload and replaces score drift', () => {
  const ok = validateSubmissionPayload(buildValidSubmissionPayload());
  assert.equal(ok.ok, true);
  assert.equal(ok.row.assessment.overall.score, 5);

  const drifted = buildValidSubmissionPayload({
    patch: (payload) => {
      payload.assessment.overall.score = 1.11;
      payload.assessment.overall.level = 'spoofed';
      payload.assessment.overall.strongestDomain = 'behavioral';
    },
  });
  const replaced = validateSubmissionPayload(drifted);
  assert.equal(replaced.ok, true);
  assert.equal(replaced.row.assessment.overall.score, 5);
  assert.equal(replaced.row.assessment.overall.level, 'balanced');
  assert.equal(replaced.row.assessment.overall.strongestDomain, 'psychometric');
});

test('health is public and secret-free', async () => {
  const app = testApp();
  const res = await app.handle({
    method: 'GET',
    url: 'https://survey.example/api/submission/health',
    headers: { host: 'survey.example' },
    ip: '203.0.113.10',
  });
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true });
});
