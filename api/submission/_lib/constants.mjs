/**
 * Allowlists and fail-closed limits for the protected submission API.
 * Profile / Likert / domain codes stay aligned with the public instrument
 * and researcher analytics consumers. Do not weaken TLS or enable collection here.
 */
import {
  EXPERIENCE_CODES,
  GENERIC_ERRORS,
  PARTICIPANT_REF,
  REGION_CODES,
  ROLE_CODES,
} from '../../researcher/_lib/constants.mjs';

export {
  EXPERIENCE_CODES,
  GENERIC_ERRORS,
  PARTICIPANT_REF,
  REGION_CODES,
  ROLE_CODES,
};

export const INSTRUMENT_ID = 'brian-dba-inclusive-lending-desk-v3';
export const INSTRUMENT_TYPE = 'mixed-methods-desk-assessment';

/** Synthetic operator seed prefix — rejected on the public submission path. */
export const SYNTHETIC_REF_PREFIX = 'resp_00000000-0000-4000-8000-';

export const TOP_LEVEL_KEYS = Object.freeze([
  'instrument_id',
  'client_record_id',
  'profile',
  'responses',
  'assessment',
  'privacy_notice_version',
  'consented_at',
]);

export const DOMAIN_ORDER = Object.freeze([
  'psychometric',
  'social',
  'behavioral',
  'readiness',
  'inclusiveDecision',
]);

export const DOMAIN_LABELS = Object.freeze({
  psychometric: 'Psychometric indicators',
  social: 'Social capital',
  behavioral: 'Behavioral economics',
  readiness: 'Organizational readiness',
  inclusiveDecision: 'Inclusive decision-making',
});

export const DOMAIN_ITEMS = Object.freeze({
  psychometric: Object.freeze(['B1', 'B2', 'B3', 'B4', 'B5']),
  social: Object.freeze(['C6', 'C7', 'C8', 'C9', 'C10']),
  behavioral: Object.freeze(['D11', 'D12', 'D13', 'D14', 'D15']),
  readiness: Object.freeze(['E16', 'E17', 'E18', 'E19', 'E20']),
  inclusiveDecision: Object.freeze(['F21', 'F22', 'F23', 'F24', 'F25']),
});

export const ITEM_ORDER = Object.freeze([
  'B1',
  'B2',
  'B3',
  'B4',
  'B5',
  'C6',
  'C7',
  'C8',
  'C9',
  'C10',
  'D11',
  'D12',
  'D13',
  'D14',
  'D15',
  'E16',
  'E17',
  'E18',
  'E19',
  'E20',
  'F21',
  'F22',
  'F23',
  'F24',
  'F25',
]);

export const QUAL_IDS = Object.freeze([
  'Q1',
  'Q2',
  'Q3',
  'Q4',
  'Q5',
  'Q6',
  'Q7',
  'Q8',
  'Q9',
]);

export const PROFILE_OPTION_CODES = Object.freeze({
  gender: Object.freeze(['male', 'female', 'prefer-not']),
  age: Object.freeze(['20-29', '30-39', '40-49', '50-59', '60plus']),
  education: Object.freeze([
    'diploma',
    'bachelors',
    'masters',
    'doctorate',
    'professional',
    'other',
  ]),
  institutionType: Object.freeze([
    'commercial-bank',
    'mfi',
    'cooperative',
    'fintech',
    'digital-bank',
    'dfi',
    'other',
  ]),
  position: ROLE_CODES,
  yearsLending: EXPERIENCE_CODES,
  yearsFinancialServices: EXPERIENCE_CODES,
  areaOperation: Object.freeze(['urban', 'rural', 'both']),
  involvement: Object.freeze([
    'assess',
    'recommend',
    'approve-reject',
    'supervise',
    'policies',
    'support',
    'other',
  ]),
  usesAltIndicators: Object.freeze(['yes', 'no', 'implementing', 'not-sure']),
  countryRegion: REGION_CODES,
});

export const PROFILE_KEYS = Object.freeze([
  'gender',
  'age',
  'education',
  'institutionType',
  'position',
  'yearsLending',
  'yearsFinancialServices',
  'areaOperation',
  'involvement',
  'usesAltIndicators',
  'countryRegion',
  'roleDescription',
  'altIndicatorsExplain',
]);

export const RESPONSES_KEYS = Object.freeze([
  'quantitative',
  'qualitative',
  'instrumentType',
  'sessionStartedAt',
  'savedAt',
  'disclaimer',
]);

export const QUANTITATIVE_KEYS = Object.freeze([
  'demographics',
  'vignetteAcknowledged',
  'vignetteAcknowledgedAt',
  'likert',
]);

/** Matches script.js quantitative.demographics (yearsFinancialServices lives in qualitative/profile). */
export const DEMOGRAPHIC_KEYS = Object.freeze([
  'gender',
  'age',
  'education',
  'institutionType',
  'position',
  'yearsLending',
  'areaOperation',
  'involvement',
  'usesAltIndicators',
  'countryRegion',
]);

export const QUALITATIVE_KEYS = Object.freeze([
  'yearsFinancialServices',
  'roleDescription',
  'altIndicatorsExplain',
  'openResponses',
]);

export const ASSESSMENT_KEYS = Object.freeze(['domains', 'overall', 'playStyle']);

export const DOMAIN_RESULT_KEYS = Object.freeze([
  'id',
  'label',
  'score',
  'max',
  'percent',
  'level',
  'levelLabel',
  'interpretation',
  'itemIds',
]);

export const OVERALL_KEYS = Object.freeze([
  'score',
  'max',
  'percent',
  'level',
  'levelLabel',
  'summary',
  'strongestDomain',
  'weakestDomain',
]);

export const PLAY_STYLE_KEYS = Object.freeze(['id', 'mark', 'title', 'blurb']);

export const DEFAULTS = Object.freeze({
  maxBodyBytes: 96_000,
  rateLimitWindowMs: 60_000,
  rateLimitMax: 12,
  minOpenLen: 10,
  maxOpenLen: 2000,
  maxRoleDescriptionLen: 1200,
  maxAltExplainLen: 2000,
  maxDisclaimerLen: 500,
  maxPrivacyNoticeLen: 40,
  maxInterpretationLen: 600,
  maxSummaryLen: 1200,
  maxPlayStyleBlurbLen: 800,
  likertMin: 1,
  likertMax: 7,
  scoreTolerance: 0.011,
  consentSkewMs: 365 * 24 * 60 * 60 * 1000,
});

export const RATE_CATEGORIES = Object.freeze({
  submit: 'submit',
});
