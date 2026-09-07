import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSubmissionApp, logSubmissionEvent } from '../api/submission/_lib/app.mjs';
import { assertSubmissionDatabaseUrl } from '../api/submission/_lib/query.mjs';
import { hashedRateBucket, clientRateKey } from '../api/submission/_lib/rate-limit.mjs';
import { handleVercelSubmissionRequest, resetSubmissionAppForTests } from '../api/submission/_vercel.mjs';
import { scoreAssessment } from '../api/submission/_lib/score-assessment.mjs';
import { DOMAIN_ORDER } from '../api/submission/_lib/constants.mjs';
import {
  buildAssessment,
  buildLikert,
  buildLikertByDomain,
  buildValidSubmissionPayload,
  readySubmissionConfig,
} from './helpers/submission-payload.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(root, relative), 'utf8');

function vercelPair({ method = 'POST', url = '/api/submission', headers = {}, body = '' } = {}) {
  const req = {
    method,
    url,
    headers: {
      host: 'survey.example',
      origin: 'https://survey.example',
      'content-type': 'application/json',
      ...headers,
    },
    body,
    socket: { remoteAddress: '198.51.100.20' },
    async *[Symbol.asyncIterator]() {
      if (body) yield Buffer.from(String(body));
    },
  };
  const res = {
    statusCode: 0,
    headers: null,
    body: '',
    writeHead(status, headersIn) {
      this.statusCode = status;
      this.headers = headersIn;
    },
    end(bodyIn) {
      this.body = bodyIn;
    },
  };
  return { req, res };
}

test('browser collection path stays fail-closed', () => {
  const scriptJs = read('script.js');
  const configJs = read('config.js');
  assert.match(configJs, /COLLECTION_ENABLED:\s*false/);
  assert.match(configJs, /SUBMISSION_ENDPOINT:\s*''/);
  assert.match(scriptJs, /COLLECTION_ENABLED === true/);
  assert.match(scriptJs, /isProtectedSubmissionEndpoint/);
  assert.match(scriptJs, /function buildArchivePayload/);
  assert.match(scriptJs, /async function submitToResearchArchive/);
});

test('no secrets in submission sources or tests', () => {
  const sources = [
    read('api/submission/_lib/app.mjs'),
    read('api/submission/_lib/config.mjs'),
    read('api/submission/env.example'),
    read('tests/submission-api.test.mjs'),
    read('tests/helpers/submission-payload.mjs'),
  ];
  for (const source of sources) {
    assert.doesNotMatch(source, /service_role/);
    assert.doesNotMatch(source, /eyJ[A-Za-z0-9_-]{20,}/);
    assert.doesNotMatch(source, /postgres(ql)?:\/\/[^:\s]+:[^@\s]+@/);
  }
});

test('submission database URL rejects researcher_api and service-role', () => {
  const forbiddenRoles = ['researcher_api', 'service' + '_role'];
  for (const role of forbiddenRoles) {
    assert.throws(() => assertSubmissionDatabaseUrl(`postgresql://${role}@127.0.0.1/db`));
  }
  assert.equal(
    assertSubmissionDatabaseUrl('postgresql://submission_inserter@127.0.0.1/db'),
    'postgresql://submission_inserter@127.0.0.1/db'
  );
});

test('rate-limit bucket hashes connection identity', () => {
  const key = clientRateKey({ ip: '203.0.113.55', headers: {} }, {});
  const bucket = hashedRateBucket('submit', key);
  assert.match(bucket, /^[a-f0-9]{40}$/);
  assert.notEqual(bucket, key);
  assert.doesNotMatch(bucket, /203\.0\.113/);
});

test('ops logging never includes answers or payloads', () => {
  const lines = [];
  const original = console.info;
  console.info = (line) => lines.push(String(line));
  try {
    logSubmissionEvent({
      request_id: 'sub_test',
      status: 200,
      outcome: 'accepted',
      method: 'POST',
      reason: null,
      responses: { qualitative: { openResponses: { Q1: 'secret answer' } } },
      password: 'nope',
    });
  } finally {
    console.info = original;
  }
  assert.equal(lines.length, 1);
  assert.doesNotMatch(lines[0], /secret answer|password|qualitative|openResponses/i);
  assert.match(lines[0], /"scope":"submission_api"/);
});

test('Vercel adapter strips wildcard CORS and accepts DI app', async () => {
  resetSubmissionAppForTests();
  const app = createSubmissionApp({
    allowMemoryStores: true,
    config: readySubmissionConfig(),
  });
  const payload = buildValidSubmissionPayload({
    client_record_id: 'resp_33333333-3333-4333-8333-333333333333',
  });
  const { req, res } = vercelPair({ body: JSON.stringify(payload) });
  const result = await handleVercelSubmissionRequest(req, res, { app });
  assert.equal(result.status, 200);
  assert.equal(res.statusCode, 200);
  assert.notEqual(result.headers['Access-Control-Allow-Origin'], '*');
  resetSubmissionAppForTests();
});

test('errors stay sanitized under adversarial headers', async () => {
  const app = createSubmissionApp({
    allowMemoryStores: true,
    config: readySubmissionConfig(),
  });
  const res = await app.handle({
    method: 'POST',
    url: 'https://survey.example/api/submission',
    headers: {
      origin: 'https://survey.example',
      'content-type': 'application/json',
      cookie: 'session=steal-me',
      authorization: 'Bearer secret-token',
    },
    body: '{"not":"valid"}',
    ip: '203.0.113.10',
  });
  assert.equal(res.status, 400);
  assert.deepEqual(JSON.parse(res.body), { error: 'invalid_request' });
  assert.doesNotMatch(res.body, /steal-me|secret-token|stack|postgresql/i);
});

test('server scoring module stays byte-aligned with survey script rules', () => {
  const scriptJs = read('script.js');
  const scoring = read('api/submission/_lib/score-assessment.mjs');
  assert.match(scriptJs, /function levelFor\(score\)/);
  assert.match(scriptJs, /function derivePlayStyle\(domains, overall\)/);
  assert.match(scriptJs, /score >= 5\.5/);
  assert.match(scriptJs, /second\.id === 'psychometric'/);
  assert.match(scoring, /second\.id === 'psychometric'/);
  assert.match(scoring, /You’re closest to someone/);
  assert.match(scriptJs, /You’re closest to someone/);
  assert.match(scoring, /That’s a usable finding too/);
  assert.match(scriptJs, /That’s a usable finding too/);
  assert.match(scriptJs, /\[\.\.\.domainResults\]\.sort\(\(a, b\) => b\.score - a\.score\)\[0\]/);
  assert.match(scriptJs, /\[\.\.\.domainResults\]\.sort\(\(a, b\) => a\.score - b\.score\)\[0\]/);
});

test('client cannot manipulate stored derived assessment fields', async () => {
  const app = createSubmissionApp({
    allowMemoryStores: true,
    config: readySubmissionConfig(),
  });
  const likert = buildLikertByDomain({
    psychometric: 6,
    social: 5,
    behavioral: 4,
    readiness: 3,
    inclusiveDecision: 2,
  });
  const expected = scoreAssessment(likert);
  const payload = buildValidSubmissionPayload({
    client_record_id: 'resp_55555555-5555-4555-8555-555555555555',
    likert,
    assessment: buildAssessment(likert),
    patch: (body) => {
      body.assessment.overall.strongestDomain = 'inclusiveDecision';
      body.assessment.overall.weakestDomain = 'psychometric';
      body.assessment.overall.level = 'spoofed-level';
      body.assessment.overall.levelLabel = 'Spoofed Label';
      body.assessment.overall.summary = 'Manipulated summary that must not be stored.';
      body.assessment.domains.forEach((domain) => {
        domain.level = 'spoofed';
        domain.levelLabel = 'Spoofed';
        domain.interpretation = 'Manipulated domain interpretation.';
        domain.score = 1;
        domain.percent = 1;
      });
      body.assessment.playStyle = {
        id: 'spoofed-style',
        mark: 'XX',
        title: 'The Spoofed Title',
        blurb: 'Manipulated play style blurb that must not persist.',
      };
    },
  });
  const res = await app.handle({
    method: 'POST',
    url: 'https://survey.example/api/submission',
    headers: {
      origin: 'https://survey.example',
      'content-type': 'application/json',
      host: 'survey.example',
    },
    body: JSON.stringify(payload),
    ip: '203.0.113.44',
  });
  assert.equal(res.status, 200);
  const stored = app.store.rows.get(payload.client_record_id).assessment;
  assert.deepEqual(stored, expected);
  assert.equal(stored.overall.strongestDomain, 'psychometric');
  assert.equal(stored.overall.weakestDomain, 'inclusiveDecision');
  assert.equal(stored.overall.level, expected.overall.level);
  assert.equal(stored.overall.levelLabel, expected.overall.levelLabel);
  assert.equal(stored.overall.summary, expected.overall.summary);
  assert.deepEqual(stored.playStyle, expected.playStyle);
  for (let i = 0; i < DOMAIN_ORDER.length; i += 1) {
    assert.equal(stored.domains[i].interpretation, expected.domains[i].interpretation);
    assert.equal(stored.domains[i].level, expected.domains[i].level);
    assert.equal(stored.domains[i].levelLabel, expected.domains[i].levelLabel);
  }
});

test('strongest/weakest ties follow survey DOMAIN_ORDER stability', async () => {
  const app = createSubmissionApp({
    allowMemoryStores: true,
    config: readySubmissionConfig(),
  });

  const allTied = buildLikert(5);
  const allExpected = scoreAssessment(allTied);
  assert.equal(allExpected.overall.strongestDomain, 'psychometric');
  assert.equal(allExpected.overall.weakestDomain, 'psychometric');

  const highTieLikert = buildLikertByDomain({
    psychometric: 6,
    social: 6,
    behavioral: 4,
    readiness: 4,
    inclusiveDecision: 4,
  });
  const highExpected = scoreAssessment(highTieLikert);
  assert.equal(highExpected.overall.strongestDomain, 'psychometric');
  assert.equal(highExpected.overall.weakestDomain, 'behavioral');

  const lowTieLikert = buildLikertByDomain({
    psychometric: 6,
    social: 5,
    behavioral: 3,
    readiness: 3,
    inclusiveDecision: 3,
  });
  const lowExpected = scoreAssessment(lowTieLikert);
  assert.equal(lowExpected.overall.strongestDomain, 'psychometric');
  assert.equal(lowExpected.overall.weakestDomain, 'behavioral');

  for (const [likert, expected, ref] of [
    [allTied, allExpected, 'resp_66666666-6666-4666-8666-666666666666'],
    [highTieLikert, highExpected, 'resp_77777777-7777-4777-8777-777777777777'],
    [lowTieLikert, lowExpected, 'resp_88888888-8888-4888-8888-888888888888'],
  ]) {
    const payload = buildValidSubmissionPayload({
      client_record_id: ref,
      likert,
      assessment: buildAssessment(likert),
      patch: (body) => {
        body.assessment.overall.strongestDomain = 'inclusiveDecision';
        body.assessment.overall.weakestDomain = 'psychometric';
      },
    });
    const res = await app.handle({
      method: 'POST',
      url: 'https://survey.example/api/submission',
      headers: {
        origin: 'https://survey.example',
        'content-type': 'application/json',
        host: 'survey.example',
      },
      body: JSON.stringify(payload),
      ip: '203.0.113.45',
    });
    assert.equal(res.status, 200);
    const stored = app.store.rows.get(ref).assessment;
    assert.equal(stored.overall.strongestDomain, expected.overall.strongestDomain);
    assert.equal(stored.overall.weakestDomain, expected.overall.weakestDomain);
    assert.equal(stored.overall.summary, expected.overall.summary);
  }
});

test('playStyle spoofing cannot override deterministic classification', async () => {
  const app = createSubmissionApp({
    allowMemoryStores: true,
    config: readySubmissionConfig(),
  });
  const likert = buildLikertByDomain({
    psychometric: 4,
    social: 4,
    behavioral: 4,
    readiness: 6,
    inclusiveDecision: 6,
  });
  const expected = scoreAssessment(likert);
  assert.equal(expected.playStyle.id, 'adoption-ready');

  const payload = buildValidSubmissionPayload({
    client_record_id: 'resp_99999999-9999-4999-8999-999999999999',
    likert,
    assessment: buildAssessment(likert),
    patch: (body) => {
      body.assessment.playStyle = {
        id: 'traditional-anchor',
        mark: 'TA',
        title: 'The File-First Guard',
        blurb: 'Spoofed traditional classification.',
      };
      body.assessment.overall.level = 'cautious';
      body.assessment.overall.levelLabel = 'Cautious';
    },
  });
  const res = await app.handle({
    method: 'POST',
    url: 'https://survey.example/api/submission',
    headers: {
      origin: 'https://survey.example',
      'content-type': 'application/json',
      host: 'survey.example',
    },
    body: JSON.stringify(payload),
    ip: '203.0.113.46',
  });
  assert.equal(res.status, 200);
  const stored = app.store.rows.get(payload.client_record_id).assessment;
  assert.deepEqual(stored.playStyle, expected.playStyle);
  assert.equal(stored.overall.level, expected.overall.level);
  assert.equal(stored.overall.levelLabel, expected.overall.levelLabel);
});
