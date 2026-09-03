import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createResearcherApp } from '../api/researcher/_lib/app.mjs';
import { createFixtureResearchStore } from '../api/researcher/_lib/data.mjs';
import { LEDGER_FIELDS } from '../api/researcher/_lib/constants.mjs';
import { parseFilters } from '../api/researcher/_lib/validate.mjs';
import {
  SYNTHETIC_BATCH_ID,
  SYNTHETIC_REFERENCE_NOW,
  SYNTHETIC_RESPONSE_COUNT,
  buildSyntheticBatch,
  buildSyntheticRecord,
  batchDistributionSummary,
  isSyntheticReference,
} from '../scripts/lib/synthetic-batch.mjs';
import {
  OPERATOR_KEYS,
  parseOperatorEnvContent,
} from '../scripts/lib/load-operator-env.mjs';
import {
  resolveInspectDatabaseUrl,
  resolveWriteDatabaseUrl,
  safeDatabaseIdentity,
} from '../scripts/lib/synthetic-db.mjs';

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

test('synthetic generator is deterministic and produces 48 identifiable rows', () => {
  const first = buildSyntheticBatch();
  const second = buildSyntheticBatch();
  assert.equal(first.length, SYNTHETIC_RESPONSE_COUNT);
  assert.equal(second.length, SYNTHETIC_RESPONSE_COUNT);
  assert.deepEqual(
    first.map((row) => row.client_record_id),
    second.map((row) => row.client_record_id)
  );
  for (const row of first) {
    assert.match(row.client_record_id, /^resp_00000000-0000-4000-8000-[0-9a-f]{12}$/i);
    assert.equal(row.responses._synthetic.batchId, SYNTHETIC_BATCH_ID);
    assert.equal(row.instrument_id, 'brian-dba-inclusive-lending-desk-v3');
    assert.ok(row.responses.quantitative.likert.B1 >= 1 && row.responses.quantitative.likert.B1 <= 7);
    assert.equal(row.assessment.overall.score, row.orientation);
    assert.ok(Array.isArray(row.assessment.domains) && row.assessment.domains.length === 5);
  }
});

test('synthetic distribution covers filters, recent intake, and qualitative subset', () => {
  const records = buildSyntheticBatch();
  const distribution = batchDistributionSummary(records);
  assert.equal(distribution.total, 48);
  assert.equal(distribution.qualitativeCount, 16);
  assert.equal(distribution.last24h, 10);
  assert.ok(Object.values(distribution.byRegion).some((count) => count > 0));
  assert.ok(Object.values(distribution.byRole).some((count) => count > 0));
  assert.ok(Object.values(distribution.byExperience).some((count) => count > 0));
});

test('synthetic records are compatible with researcher summary, list, and qualitative fetch', async () => {
  // Align last-24h cluster with wall clock so fixture summary (Date.now()) matches.
  const referenceNow = new Date().toISOString();
  const records = buildSyntheticBatch({ referenceNow });
  const store = createFixtureResearchStore(records);
  const filters = {
    from: null,
    to: null,
    region: null,
    role: null,
    experience: null,
    q: '',
    limit: 50,
  };
  const summary = await store.summary(filters);
  assert.equal(summary.total, 48);
  assert.equal(summary.last_24h, 10);
  assert.ok(summary.mean_orientation != null);
  assert.equal(summary.domains.length, 5);
  assert.ok(summary.items.length > 0);
  assert.ok(summary.trend.length > 0);

  const list = await store.list(filters);
  assert.equal(list.records.length, 48);
  for (const row of list.records) {
    assert.ok(isSyntheticReference(row.participant_reference));
    for (const field of LEDGER_FIELDS) assert.ok(field in row);
    assert.equal(row.qualitative, undefined);
    assert.equal(row.responses, undefined);
    assert.equal(row._synthetic, undefined);
  }

  const withQual = records.find((row) => Object.keys(row.qualitative.openResponses || {}).length > 0);
  const qual = await store.getQualitative(withQual.client_record_id);
  assert.equal(qual.participant_reference, withQual.client_record_id);
  assert.ok(Object.keys(qual.qualitative.openResponses).length > 0);
  assert.match(String(qual.qualitative.roleDescription), /Synthetic|Fictional|Mock|Placeholder/i);

  const india = await store.summary({ ...filters, region: 'india' });
  assert.ok(india.total > 0 && india.total < 48);
});

test('synthetic filters match parseFilters allowlists and date windows', async () => {
  const records = buildSyntheticBatch();
  const store = createFixtureResearchStore(records);
  const parsed = parseFilters({ from: '2026-08-04', to: '2026-08-31', limit: 50 });
  assert.equal(parsed.ok, true);
  const filtered = await store.summary(parsed.filters);
  assert.ok(filtered.total >= 40 && filtered.total <= 48);

  const india = parseFilters({ region: 'india', limit: 50 });
  assert.equal(india.ok, true);
  const indiaSummary = await store.summary(india.filters);
  assert.equal(indiaSummary.total, records.filter((row) => row.region === 'india').length);
});

test('isolated fixture store via researcher API exposes no synthetic marker in DTOs', async () => {
  const records = buildSyntheticBatch().slice(0, 6);
  const app = createResearcherApp({
    allowMemoryStores: true,
    records,
    config: readyConfig(),
  });
  const signed = await app.signInForTests('subject-synthetic');
  const headers = {
    cookie: signed.cookie,
    'x-csrf-token': signed.csrf,
  };
  const summaryRes = await app.handle({ method: 'GET', url: '/v1/summary', headers, ip: 's1' });
  const listRes = await app.handle({ method: 'GET', url: '/v1/responses?limit=50', headers, ip: 's1' });
  assert.equal(summaryRes.status, 200);
  assert.equal(listRes.status, 200);
  const summaryBody = JSON.parse(summaryRes.body);
  const listBody = JSON.parse(listRes.body);
  assert.doesNotMatch(JSON.stringify(summaryBody), /dashboard-validation-v1|_synthetic/);
  assert.doesNotMatch(JSON.stringify(listBody), /dashboard-validation-v1|_synthetic/);

  const qualRef = records.find((row) => Object.keys(row.qualitative.openResponses || {}).length > 0)
    .client_record_id;
  const qualRes = await app.handle({
    method: 'GET',
    url: `/v1/responses/${encodeURIComponent(qualRef)}/qualitative`,
    headers,
    ip: 's1',
  });
  assert.equal(qualRes.status, 200);
  const qualBody = JSON.parse(qualRes.body);
  assert.equal(qualBody.participant_reference, qualRef);
  assert.doesNotMatch(JSON.stringify(qualBody), /_synthetic/);
});

test('synthetic batch item distributions use quantitative likert contract', async () => {
  const records = buildSyntheticBatch();
  const store = createFixtureResearchStore(records);
  const summary = await store.summary({
    from: null,
    to: null,
    region: null,
    role: null,
    experience: null,
    q: '',
    limit: 50,
  });
  assert.ok(summary.items.length > 0);
  for (const row of records) {
    assert.equal(row.responses.likert, undefined);
    assert.ok(row.responses.quantitative.likert);
  }
  const b1 = summary.items.find((row) => row.id === 'B1');
  assert.ok(b1);
  assert.equal(b1.counts.reduce((sum, count) => sum + count, 0), records.length);
});

test('operator scripts are gated and not wired into deploy or browser code', () => {
  const seed = read('scripts/seed-synthetic-responses.mjs');
  const cleanup = read('scripts/cleanup-synthetic-responses.mjs');
  const vercel = read('vercel.json');
  const dashboard = read('researcher/dashboard.js');
  const publicConfig = read('config.js');
  assert.match(seed, /--confirm-synthetic-seed/);
  assert.match(seed, /--dry-run/);
  assert.match(seed, /SYNTHETIC_OPERATOR_DATABASE_URL/);
  assert.match(seed, /resolveWriteDatabaseUrl/);
  assert.match(cleanup, /--confirm-synthetic-cleanup/);
  assert.match(cleanup, /SYNTHETIC_RESPONSE_COUNT/);
  assert.match(cleanup, /SYNTHETIC_OPERATOR_DATABASE_URL/);
  assert.match(cleanup, /resolveWriteDatabaseUrl/);
  assert.match(cleanup, /resolveInspectDatabaseUrl/);
  assert.doesNotMatch(vercel, /seed-synthetic|cleanup-synthetic/);
  assert.doesNotMatch(dashboard, /seed-synthetic|cleanup-synthetic/);
  assert.match(publicConfig, /COLLECTION_ENABLED:\s*false/);
  assert.match(publicConfig, /SUBMISSION_ENDPOINT:\s*''/);
});

test('operator env loader recognizes SYNTHETIC_OPERATOR_DATABASE_URL', () => {
  const parsed = parseOperatorEnvContent(
    [
      'DATABASE_URL=postgresql://researcher_api:x@127.0.0.1/postgres',
      'SYNTHETIC_OPERATOR_DATABASE_URL=postgresql://postgres.example:x@127.0.0.1/postgres',
      'DATABASE_CA_CERT=-----BEGIN CERTIFICATE-----\\nABC\\n-----END CERTIFICATE-----',
      'IGNORED_SECRET=should-not-load',
    ].join('\n')
  );
  assert.equal(
    parsed.SYNTHETIC_OPERATOR_DATABASE_URL,
    'postgresql://postgres.example:x@127.0.0.1/postgres'
  );
  assert.equal(parsed.DATABASE_URL, 'postgresql://researcher_api:x@127.0.0.1/postgres');
  assert.ok(parsed.DATABASE_CA_CERT);
  assert.equal(parsed.IGNORED_SECRET, undefined);
  assert.ok(OPERATOR_KEYS.has('SYNTHETIC_OPERATOR_DATABASE_URL'));
});

test('real seed/cleanup refuse without SYNTHETIC_OPERATOR_DATABASE_URL', () => {
  const previous = process.env.SYNTHETIC_OPERATOR_DATABASE_URL;
  const previousDb = process.env.DATABASE_URL;
  delete process.env.SYNTHETIC_OPERATOR_DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://researcher_api:x@127.0.0.1/postgres';
  try {
    assert.throws(
      () => resolveWriteDatabaseUrl(),
      /synthetic_operator_database_url_required/
    );
    const inspect = resolveInspectDatabaseUrl();
    assert.equal(inspect.source, 'researcher');
    assert.match(inspect.url, /researcher_api/);
  } finally {
    if (previous === undefined) delete process.env.SYNTHETIC_OPERATOR_DATABASE_URL;
    else process.env.SYNTHETIC_OPERATOR_DATABASE_URL = previous;
    if (previousDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDb;
  }
});

test('inspect prefers operator URL when present; writes always use operator', () => {
  const previousOp = process.env.SYNTHETIC_OPERATOR_DATABASE_URL;
  const previousDb = process.env.DATABASE_URL;
  process.env.SYNTHETIC_OPERATOR_DATABASE_URL =
    'postgresql://postgres.example:x@operator.example:6543/postgres';
  process.env.DATABASE_URL = 'postgresql://researcher_api:x@researcher.example:6543/postgres';
  try {
    const writeUrl = resolveWriteDatabaseUrl();
    assert.match(writeUrl, /operator\.example/);
    assert.doesNotMatch(writeUrl, /researcher_api/);
    const inspect = resolveInspectDatabaseUrl();
    assert.equal(inspect.source, 'operator');
    assert.match(inspect.url, /operator\.example/);
    const identity = safeDatabaseIdentity(writeUrl);
    assert.equal(identity.host, 'operator.example');
    assert.equal(identity.user, 'postgres.example');
    assert.equal(identity.port, '6543');
  } finally {
    if (previousOp === undefined) delete process.env.SYNTHETIC_OPERATOR_DATABASE_URL;
    else process.env.SYNTHETIC_OPERATOR_DATABASE_URL = previousOp;
    if (previousDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDb;
  }
});

test('researcher application code never references SYNTHETIC_OPERATOR_DATABASE_URL', () => {
  const walk = (dir, acc = []) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (['.git', 'node_modules', '.serena', '.vercel'].includes(name.name)) continue;
      const full = join(dir, name.name);
      if (name.isDirectory()) walk(full, acc);
      else if (/\.(js|mjs|ts|tsx|html|json)$/.test(name.name)) acc.push(full);
    }
    return acc;
  };
  for (const dir of ['api', 'researcher']) {
    for (const file of walk(join(root, dir))) {
      const source = readFileSync(file, 'utf8');
      assert.doesNotMatch(
        source,
        /SYNTHETIC_OPERATOR_DATABASE_URL/,
        `unexpected operator URL reference in ${file}`
      );
    }
  }
  assert.match(read('.gitignore'), /\.env/);
});

test('single synthetic record keeps participant quantitative likert path and consent fields', () => {
  const row = buildSyntheticRecord(0);
  assert.equal(row.responses.likert, undefined);
  assert.ok(row.responses.quantitative.likert);
  assert.ok(row.consented_at);
  assert.ok(row.privacy_notice_version);
  assert.ok(Date.parse(row.created_at) <= Date.parse(SYNTHETIC_REFERENCE_NOW));
});

test('synthetic referenceNow can be injected for operator-like wall-clock seeds', () => {
  const fixed = '2026-09-03T12:00:00.000Z';
  const withFixed = buildSyntheticBatch({ referenceNow: fixed });
  const distribution = batchDistributionSummary(withFixed, { referenceNow: fixed });
  assert.equal(distribution.last24h, 10);
  for (const row of withFixed.slice(-10)) {
    assert.ok(Date.parse(row.created_at) <= Date.parse(fixed));
    assert.ok(Date.parse(row.created_at) >= Date.parse(fixed) - 24 * 60 * 60 * 1000);
  }

  const previous = process.env.SYNTHETIC_REFERENCE_NOW;
  process.env.SYNTHETIC_REFERENCE_NOW = '2026-08-20T08:00:00.000Z';
  try {
    const fromEnv = buildSyntheticRecord(47);
    assert.ok(Date.parse(fromEnv.created_at) <= Date.parse(process.env.SYNTHETIC_REFERENCE_NOW));
    assert.ok(
      Date.parse(fromEnv.created_at) >=
        Date.parse(process.env.SYNTHETIC_REFERENCE_NOW) - 24 * 60 * 60 * 1000
    );
  } finally {
    if (previous === undefined) delete process.env.SYNTHETIC_REFERENCE_NOW;
    else process.env.SYNTHETIC_REFERENCE_NOW = previous;
  }

  const seed = read('scripts/seed-synthetic-responses.mjs');
  assert.match(seed, /new Date\(\)\.toISOString\(\)/);
  assert.match(seed, /resolveSyntheticReferenceNow/);
  assert.match(seed, /referenceNow/);
});
