import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  const records = buildSyntheticBatch();
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
  assert.match(cleanup, /--confirm-synthetic-cleanup/);
  assert.match(cleanup, /SYNTHETIC_RESPONSE_COUNT/);
  assert.doesNotMatch(vercel, /seed-synthetic|cleanup-synthetic/);
  assert.doesNotMatch(dashboard, /seed-synthetic|cleanup-synthetic/);
  assert.match(publicConfig, /COLLECTION_ENABLED:\s*false/);
  assert.match(publicConfig, /SUBMISSION_ENDPOINT:\s*''/);
});

test('single synthetic record keeps participant quantitative likert path and consent fields', () => {
  const row = buildSyntheticRecord(0);
  assert.equal(row.responses.likert, undefined);
  assert.ok(row.responses.quantitative.likert);
  assert.ok(row.consented_at);
  assert.ok(row.privacy_notice_version);
  assert.ok(Date.parse(row.created_at) <= Date.parse(SYNTHETIC_REFERENCE_NOW));
});
