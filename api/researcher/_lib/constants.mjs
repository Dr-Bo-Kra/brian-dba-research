/** Allowlists and fail-closed limits for the researcher API scaffold. */

export const PARTICIPANT_REF = /^resp_[0-9a-f-]{32,36}$/i;

export const ROLES = Object.freeze(['authorised_researcher', 'researcher_admin']);

export const REGION_CODES = Object.freeze([
  'india',
  'south-asia-other',
  'southeast-asia',
  'east-asia',
  'middle-east',
  'africa',
  'europe-uk',
  'north-america',
  'latin-america-caribbean',
  'oceania',
  'multi-region',
  'prefer-not',
]);

export const ROLE_CODES = Object.freeze([
  'credit-loan-officer',
  'credit-manager',
  'risk-manager',
  'underwriting',
  'branch-manager',
  'product-development',
  'senior-management',
  'other',
]);

export const EXPERIENCE_CODES = Object.freeze(['lt2', '2-5', '6-10', '11-15', 'gt15']);

export const SORT_FIELDS = Object.freeze(['created_at']);

export const DOMAIN_ORDER = Object.freeze([
  'psychometric',
  'social',
  'behavioral',
  'readiness',
  'inclusiveDecision',
]);

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

/** Legacy short export schema — prefer QUANTITATIVE_EXPORT_COLUMNS for study exports. */
export const EXPORT_COLUMNS = Object.freeze([
  'participant_reference',
  'accepted_at',
  'region',
  'role',
  'experience',
  'orientation',
]);

export const DOMAIN_EXPORT_KEYS = Object.freeze(
  DOMAIN_ORDER.map((id) => `domain_${id}`)
);

/** Quantitative study CSV columns (coded profile + domain scores + Likert). No free-text. */
export const QUANTITATIVE_EXPORT_COLUMNS = Object.freeze([
  'participant_reference',
  'accepted_at',
  'region',
  'role',
  'experience',
  'gender',
  'age',
  'education',
  'institutionType',
  'yearsFinancialServices',
  'areaOperation',
  'involvement',
  'usesAltIndicators',
  'orientation',
  ...DOMAIN_EXPORT_KEYS,
  ...ITEM_ORDER,
]);

export const LEDGER_FIELDS = Object.freeze([
  'participant_reference',
  'accepted_at',
  'region',
  'role',
  'experience',
  'orientation',
  'legal_hold',
  'anonymised',
]);

export const AUDIT_ACTIONS = Object.freeze([
  'login',
  'login_failure',
  'logout',
  'view_record',
  'view_qualitative',
  'export',
  'delete',
  'retention_review',
  'anonymise',
  'role_change',
  'config_change',
  'authz_failure',
]);

export const SENSITIVE_AUDIT_KEYS = Object.freeze([
  'responses',
  'assessment',
  'qualitative',
  'openResponses',
  'profile',
  'answer',
  'answers',
  'token',
  'tokens',
  'cookie',
  'cookies',
  'password',
  'secret',
  'code',
  'code_verifier',
  'access_token',
  'refresh_token',
  'id_token',
  'totp',
  'mfa',
  'aal',
  'qr',
  'qr_code',
  'factor',
  'factor_id',
  'challenge_id',
]);

export const DEFAULTS = Object.freeze({
  sessionMinutes: 20,
  maxPageSize: 50,
  defaultPageSize: 20,
  maxExportRows: 2000,
  rateLimitWindowMs: 60_000,
  rateLimitMax: 60,
  loginRateLimitMax: 10,
  recordRateLimitMax: 20,
  qualitativeRateLimitMax: 10,
});

export const GENERIC_ERRORS = Object.freeze({
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  not_found: 'not_found',
  invalid_request: 'invalid_request',
  unavailable: 'unavailable',
  rate_limited: 'rate_limited',
});
