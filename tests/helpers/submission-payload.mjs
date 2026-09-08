/**
 * Canonical archive payload builder for submission API tests.
 * Uses the same server scoring module that authorises stored assessments.
 * Live contract: quantitative-only (no qualitative answers).
 */
import {
  DOMAIN_ITEMS,
  DOMAIN_ORDER,
  INSTRUMENT_ID,
  INSTRUMENT_TYPE,
  ITEM_ORDER,
} from '../../api/submission/_lib/constants.mjs';
import { scoreAssessment } from '../../api/submission/_lib/score-assessment.mjs';

function mean(values) {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function buildLikert(fill = 5) {
  const likert = {};
  for (const id of ITEM_ORDER) likert[id] = fill;
  return likert;
}

/** Domain-constant fill helper for tie / playStyle scenarios. */
export function buildLikertByDomain(domainScores) {
  const likert = {};
  for (const id of DOMAIN_ORDER) {
    const score = domainScores[id];
    const items = DOMAIN_ITEMS[id];
    for (const itemId of items) likert[itemId] = score;
  }
  return likert;
}

export function buildAssessment(likert) {
  return scoreAssessment(likert);
}

export function buildValidSubmissionPayload(overrides = {}) {
  const now = new Date().toISOString();
  const consentedAt = overrides.consented_at || now;
  const likert = overrides.likert || buildLikert(5);
  const demographics = {
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
    ...(overrides.demographics || {}),
  };
  const profile = {
    ...demographics,
    ...(overrides.profile || {}),
  };

  const payload = {
    instrument_id: INSTRUMENT_ID,
    client_record_id: overrides.client_record_id || 'resp_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    profile,
    responses: {
      quantitative: {
        demographics: { ...profile },
        vignetteAcknowledged: true,
        vignetteAcknowledgedAt: consentedAt,
        likert,
      },
      instrumentType: INSTRUMENT_TYPE,
      sessionStartedAt: consentedAt,
      savedAt: now,
      disclaimer:
        'Research-oriented quantitative desk instrument / proposal demo. Not a clinical diagnosis, credit score, or institutional decision.',
    },
    assessment: overrides.assessment || buildAssessment(likert),
    privacy_notice_version: overrides.privacy_notice_version || '2026-09-09',
    consented_at: consentedAt,
  };

  if (overrides.patch) overrides.patch(payload);
  return payload;
}

export function readySubmissionConfig(extra = {}) {
  return {
    enabled: true,
    databaseUrl: 'postgresql://submission_inserter@127.0.0.1/unused',
    databaseCaCert: '',
    rateLimitStore: 'database',
    durableRateLimitReady: true,
    dataReady: true,
    allowMemoryStores: false,
    maxBodyBytes: 48_000,
    rateLimitWindowMs: 60_000,
    rateLimitMax: 10_000,
    trustedProxy: false,
    trustedProxyPlatform: '',
    trustedClientIpHeader: '',
    allowedOrigin: 'https://survey.example',
    vercelEnv: '',
    ...extra,
  };
}

export { DOMAIN_ORDER, DOMAIN_ITEMS, ITEM_ORDER, mean, scoreAssessment };
