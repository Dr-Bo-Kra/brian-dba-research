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

export const EXPORT_COLUMNS = Object.freeze([
  'participant_reference',
  'accepted_at',
  'region',
  'role',
  'experience',
  'orientation',
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
