/**
 * Deterministic synthetic assessment batch for dashboard validation.
 * Shared by operator seed/cleanup scripts and isolated tests — never imported by browser code.
 */
import {
  EXPERIENCE_CODES,
  REGION_CODES,
  ROLE_CODES,
} from '../../api/researcher/_lib/constants.mjs';

const ITEM_ORDER = [
  'B1', 'B2', 'B3', 'B4', 'B5',
  'C6', 'C7', 'C8', 'C9', 'C10',
  'D11', 'D12', 'D13', 'D14', 'D15',
  'E16', 'E17', 'E18', 'E19', 'E20',
  'F21', 'F22', 'F23', 'F24', 'F25',
];

export const SYNTHETIC_BATCH_ID = 'dashboard-validation-v1';
export const SYNTHETIC_GENERATOR_VERSION = '1';
export const SYNTHETIC_RESPONSE_COUNT = 48;
export const INSTRUMENT_ID = 'brian-dba-inclusive-lending-desk-v3';
export const PRIVACY_NOTICE_VERSION = '2026-08-28';
export const SYNTHETIC_REF_PREFIX = 'resp_00000000-0000-4000-8000-';
export const SYNTHETIC_REF_PATTERN = /^resp_00000000-0000-4000-8000-[0-9a-f]{12}$/i;
export const SYNTHETIC_REF_SQL_PATTERN = '^resp_00000000-0000-4000-8000-[0-9a-f]{12}$';

/** Fixed clock for deterministic created_at spread (operator preview / tests). */
export const SYNTHETIC_REFERENCE_NOW = '2026-09-01T09:00:00.000Z';

const LIKERT_SECTIONS = [
  { id: 'psychometric', label: 'Psychometric indicators', items: ['B1', 'B2', 'B3', 'B4', 'B5'] },
  { id: 'social', label: 'Social capital', items: ['C6', 'C7', 'C8', 'C9', 'C10'] },
  { id: 'behavioral', label: 'Behavioral economics', items: ['D11', 'D12', 'D13', 'D14', 'D15'] },
  { id: 'readiness', label: 'Organizational readiness', items: ['E16', 'E17', 'E18', 'E19', 'E20'] },
  {
    id: 'inclusiveDecision',
    label: 'Inclusive decision-making',
    items: ['F21', 'F22', 'F23', 'F24', 'F25'],
  },
];

const QUAL_IDS = ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q7', 'Q8', 'Q9'];

const PROFILE_OPTIONS = {
  gender: ['male', 'female', 'prefer-not'],
  age: ['20-29', '30-39', '40-49', '50-59', '60plus'],
  education: ['diploma', 'bachelors', 'masters', 'doctorate', 'professional', 'other'],
  institutionType: ['commercial-bank', 'mfi', 'cooperative', 'fintech', 'digital-bank', 'dfi', 'other'],
  areaOperation: ['urban', 'rural', 'both'],
  involvement: ['assess', 'recommend', 'approve-reject', 'supervise', 'policies', 'support', 'other'],
  usesAltIndicators: ['yes', 'no', 'implementing', 'not-sure'],
  yearsFinancialServices: EXPERIENCE_CODES,
};

const SYNTHETIC_ROLE_DESCRIPTIONS = [
  'Synthetic desk officer reviewing fictional micro-loan files for dashboard validation only.',
  'Fictional credit analyst role used to populate the inquiry archive KPI panels during QA.',
  'Placeholder lending-desk profile for synthetic batch dashboard-validation-v1 — not a real person.',
  'Mock underwriting reviewer evaluating standardized vignette cases in a test environment.',
];

const SYNTHETIC_OPEN_RESPONSES = [
  'Synthetic reflection: alternative signals should stay governance-bound and never replace audited records.',
  'Fictional QA note — community reputation could complement thin files when policies allow it.',
  'Dashboard seed text only: behavioral patterns matter, but institutions need training before adoption.',
  'Placeholder governance answer for synthetic batch validation; no real institution is referenced.',
  'Mock participant view: inclusion and risk must stay balanced when experimenting with new indicators.',
  'Synthetic adoption note for researcher UI testing — policies and audit trails come first.',
  'Fictional ethics reflection used to verify qualitative panels; clearly not live research data.',
  'Test-only open response about operational readiness and responsible inclusive lending desks.',
];

const REQUIRED_TABLE_COLUMNS = Object.freeze([
  'id',
  'created_at',
  'instrument_id',
  'client_record_id',
  'profile',
  'responses',
  'assessment',
  'privacy_notice_version',
  'consented_at',
]);

export function createSeededRng(seed = 0xdba2026) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mean(values) {
  const nums = values.filter((value) => Number.isFinite(value));
  if (!nums.length) return 0;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

function syntheticReference(index) {
  const suffix = (index + 1).toString(16).padStart(12, '0');
  return `${SYNTHETIC_REF_PREFIX}${suffix}`;
}

function scoreLikert(likert) {
  const domains = LIKERT_SECTIONS.map((section) => {
    const values = section.items.map((id) => Number(likert[id]));
    const score = Number(mean(values).toFixed(2));
    return {
      id: section.id,
      label: section.label,
      score,
      max: 7,
      percent: Math.round((score / 7) * 100),
      itemIds: section.items,
    };
  });
  const overallScore = Number(mean(domains.map((domain) => domain.score)).toFixed(2));
  return {
    domains,
    overall: {
      score: overallScore,
      max: 7,
      percent: Math.round((overallScore / 7) * 100),
    },
  };
}

function buildLikert(rng, index) {
  const likert = {};
  for (const id of ITEM_ORDER) {
    const sectionIndex = LIKERT_SECTIONS.findIndex((section) => section.items.includes(id));
    const base = 2 + ((index + sectionIndex) % 5);
    const jitter = rng() < 0.35 ? 1 : 0;
    likert[id] = Math.min(7, Math.max(1, base + jitter));
  }
  return likert;
}

function buildProfile(rng, index) {
  const countryRegion = REGION_CODES[index % REGION_CODES.length];
  const position = ROLE_CODES[(index * 3) % ROLE_CODES.length];
  const yearsLending = EXPERIENCE_CODES[(index * 2) % EXPERIENCE_CODES.length];
  const demographics = {
    gender: pick(rng, PROFILE_OPTIONS.gender),
    age: pick(rng, PROFILE_OPTIONS.age),
    education: pick(rng, PROFILE_OPTIONS.education),
    institutionType: pick(rng, PROFILE_OPTIONS.institutionType),
    position,
    yearsLending,
    yearsFinancialServices: pick(rng, PROFILE_OPTIONS.yearsFinancialServices),
    areaOperation: pick(rng, PROFILE_OPTIONS.areaOperation),
    involvement: pick(rng, PROFILE_OPTIONS.involvement),
    usesAltIndicators: pick(rng, PROFILE_OPTIONS.usesAltIndicators),
    countryRegion,
  };
  return {
    profile: {
      ...demographics,
      roleDescription: SYNTHETIC_ROLE_DESCRIPTIONS[index % SYNTHETIC_ROLE_DESCRIPTIONS.length],
    },
    demographics,
    region: countryRegion,
    role: position,
    experience: yearsLending,
  };
}

function buildCreatedAt(rng, index, referenceNow = SYNTHETIC_REFERENCE_NOW) {
  const nowMs = Date.parse(referenceNow);
  if (index >= SYNTHETIC_RESPONSE_COUNT - 10) {
    const hoursAgo = Math.floor(rng() * 20) + 1;
    return new Date(nowMs - hoursAgo * 60 * 60 * 1000).toISOString();
  }
  const start = Date.parse('2026-08-04T10:00:00.000Z');
  const end = Date.parse('2026-08-31T18:00:00.000Z');
  const slot = start + Math.floor(rng() * (end - start));
  const dayOffset = (index % 21) * 60 * 60 * 1000;
  return new Date(Math.min(end, slot + dayOffset)).toISOString();
}

function includesQualitative(index) {
  return index % 3 === 0;
}

function buildQualitative(index) {
  if (!includesQualitative(index)) {
    return {
      yearsFinancialServices: EXPERIENCE_CODES[index % EXPERIENCE_CODES.length],
      roleDescription: SYNTHETIC_ROLE_DESCRIPTIONS[index % SYNTHETIC_ROLE_DESCRIPTIONS.length],
      openResponses: {},
    };
  }
  const openResponses = {};
  const count = 2 + (index % 3);
  for (let q = 0; q < count; q += 1) {
    const id = QUAL_IDS[(index + q) % QUAL_IDS.length];
    openResponses[id] = SYNTHETIC_OPEN_RESPONSES[(index + q) % SYNTHETIC_OPEN_RESPONSES.length];
  }
  return {
    yearsFinancialServices: EXPERIENCE_CODES[index % EXPERIENCE_CODES.length],
    roleDescription: SYNTHETIC_ROLE_DESCRIPTIONS[index % SYNTHETIC_ROLE_DESCRIPTIONS.length],
    altIndicatorsExplain: 'Synthetic optional note for dashboard qualitative validation only.',
    openResponses,
  };
}

export function buildSyntheticRecord(index, options = {}) {
  if (!Number.isInteger(index) || index < 0 || index >= SYNTHETIC_RESPONSE_COUNT) {
    throw new Error('invalid_synthetic_index');
  }
  const rng = createSeededRng(0xdba2026 + index * 997);
  const clientRecordId = syntheticReference(index);
  const createdAt = buildCreatedAt(rng, index, options.referenceNow);
  const consentedAt = new Date(Date.parse(createdAt) - 5 * 60 * 1000).toISOString();
  const { profile, demographics, region, role, experience } = buildProfile(rng, index);
  const likert = buildLikert(rng, index);
  const qualitative = buildQualitative(index);
  const assessment = scoreLikert(likert);
  const responses = {
    quantitative: {
      demographics,
      vignetteAcknowledged: true,
      vignetteAcknowledgedAt: consentedAt,
      likert,
    },
    qualitative,
    instrumentType: 'mixed-methods-desk-assessment',
    sessionStartedAt: consentedAt,
    savedAt: createdAt,
    disclaimer:
      'Synthetic dashboard-validation record — fictional participant data for researcher UI testing only.',
    _synthetic: {
      batchId: SYNTHETIC_BATCH_ID,
      generatorVersion: SYNTHETIC_GENERATOR_VERSION,
      index,
    },
  };

  return {
    client_record_id: clientRecordId,
    created_at: createdAt,
    instrument_id: INSTRUMENT_ID,
    profile,
    responses,
    assessment,
    privacy_notice_version: PRIVACY_NOTICE_VERSION,
    consented_at: consentedAt,
    legal_hold: false,
    region,
    role,
    experience,
    orientation: assessment.overall.score,
    qualitative,
  };
}

export function buildSyntheticBatch(options = {}) {
  return Array.from({ length: SYNTHETIC_RESPONSE_COUNT }, (_value, index) =>
    buildSyntheticRecord(index, options)
  );
}

export function isSyntheticReference(value) {
  return SYNTHETIC_REF_PATTERN.test(String(value || '').trim());
}

export function batchDistributionSummary(records = buildSyntheticBatch()) {
  const referenceNow = Date.parse(SYNTHETIC_REFERENCE_NOW);
  const dayAgo = referenceNow - 24 * 60 * 60 * 1000;
  const byRegion = Object.fromEntries(REGION_CODES.map((code) => [code, 0]));
  const byRole = Object.fromEntries(ROLE_CODES.map((code) => [code, 0]));
  const byExperience = Object.fromEntries(EXPERIENCE_CODES.map((code) => [code, 0]));
  let qualitativeCount = 0;
  let last24h = 0;
  records.forEach((record, index) => {
    byRegion[record.region] = (byRegion[record.region] || 0) + 1;
    byRole[record.role] = (byRole[record.role] || 0) + 1;
    byExperience[record.experience] = (byExperience[record.experience] || 0) + 1;
    if (includesQualitative(index)) qualitativeCount += 1;
    if (Date.parse(record.created_at) >= dayAgo) last24h += 1;
  });
  return {
    total: records.length,
    qualitativeCount,
    last24h,
    byRegion,
    byRole,
    byExperience,
  };
}

export function toInsertRow(record) {
  return {
    created_at: record.created_at,
    instrument_id: record.instrument_id,
    client_record_id: record.client_record_id,
    profile: record.profile,
    responses: record.responses,
    assessment: record.assessment,
    privacy_notice_version: record.privacy_notice_version,
    consented_at: record.consented_at,
  };
}

export function assertSchemaShape(columnNames) {
  const present = new Set(columnNames);
  const missing = REQUIRED_TABLE_COLUMNS.filter((name) => !present.has(name));
  if (missing.length) {
    throw new Error(`schema_mismatch:missing_columns:${missing.join(',')}`);
  }
}

export const INSERT_SQL = `insert into public.assessment_responses (
  created_at,
  instrument_id,
  client_record_id,
  profile,
  responses,
  assessment,
  privacy_notice_version,
  consented_at
) values (
  $1::timestamptz,
  $2,
  $3,
  $4::jsonb,
  $5::jsonb,
  $6::jsonb,
  $7,
  $8::timestamptz
)`;

export const COUNT_SYNTHETIC_SQL = `select count(*)::int as n
  from public.assessment_responses
 where client_record_id ~ $1`;

export const LIST_SYNTHETIC_SQL = `select client_record_id, created_at
  from public.assessment_responses
 where client_record_id ~ $1
 order by created_at asc`;

export const DELETE_SYNTHETIC_SQL = `delete from public.assessment_responses
 where client_record_id ~ $1
   and legal_hold is not true
   and anonymised_at is null`;
