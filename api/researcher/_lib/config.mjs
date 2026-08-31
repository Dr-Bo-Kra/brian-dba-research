import { DEFAULTS } from './constants.mjs';

function envFlag(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function loadConfig(env = process.env) {
  const enabled = env.RESEARCHER_API_ENABLED === 'true';
  const databaseUrl = String(env.DATABASE_URL || '').trim();
  const sessionSecret = String(env.SESSION_SECRET || '').trim();
  const oidcIssuer = String(env.OIDC_ISSUER || '').trim();
  const oidcClientId = String(env.OIDC_CLIENT_ID || '').trim();
  const oidcClientSecret = String(env.OIDC_CLIENT_SECRET || '').trim();
  const oidcRedirectUri = String(env.OIDC_REDIRECT_URI || '').trim();
  const oidcAudience = String(env.OIDC_AUDIENCE || oidcClientId).trim();
  const oidcRequiredAcr = String(env.OIDC_REQUIRED_ACR || '').trim();
  const oidcRequiredAmr = String(env.OIDC_REQUIRED_AMR || '').trim();
  const oidcLogoutUrl = String(env.OIDC_LOGOUT_URL || '').trim();
  const oidcReady = Boolean(oidcIssuer && oidcClientId && oidcClientSecret && oidcRedirectUri);
  const mfaAssuranceReady = Boolean(oidcRequiredAcr || oidcRequiredAmr);
  const sessionStore = env.SESSION_STORE === 'database' ? 'database' : '';
  const rateLimitStore = env.RATE_LIMIT_STORE === 'database' ? 'database' : '';
  const durableSessionReady = sessionStore === 'database' && Boolean(databaseUrl);
  const durableRateLimitReady = rateLimitStore === 'database' && Boolean(databaseUrl);
  const authReady = Boolean(
    enabled &&
      sessionSecret &&
      oidcReady &&
      mfaAssuranceReady &&
      durableSessionReady &&
      durableRateLimitReady
  );
  const trustedProxyRaw = String(env.TRUSTED_PROXY || '').trim().toLowerCase();
  const trustedProxyVercel = trustedProxyRaw === 'vercel';
  const trustedProxy = trustedProxyRaw === 'true' || trustedProxyVercel;
  const configuredIpHeader = String(env.TRUSTED_CLIENT_IP_HEADER || '').trim().toLowerCase();
  const trustedClientIpHeader = trustedProxyVercel
    ? 'x-vercel-forwarded-for'
    : configuredIpHeader === 'x-forwarded-for' ||
        configuredIpHeader === 'x-real-ip' ||
        configuredIpHeader === 'x-vercel-forwarded-for'
      ? configuredIpHeader
      : '';

  return {
    enabled,
    exportsEnabled: env.EXPORTS_ENABLED === 'true',
    deletionsEnabled: env.DELETIONS_ENABLED === 'true',
    dbDiagnosticEnabled: env.RESEARCHER_DB_DIAGNOSTIC_ENABLED === 'true',
    vercelEnv: String(env.VERCEL_ENV || '').trim().toLowerCase(),
    databaseUrl,
    databaseCaCert: String(env.DATABASE_CA_CERT || '').trim(),
    sessionSecret,
    oidcIssuer,
    oidcClientId,
    oidcClientSecret,
    oidcRedirectUri,
    oidcAudience,
    oidcRequiredAcr,
    oidcRequiredAmr,
    oidcLogoutUrl,
    oidcReady,
    mfaAssuranceReady,
    sessionStore,
    rateLimitStore,
    durableSessionReady,
    durableRateLimitReady,
    authReady,
    allowMemoryStores: false,
    dataReady: Boolean(authReady && databaseUrl),
    archivePath: String(env.ARCHIVE_PATH || '/researcher/').trim() || '/researcher/',
    sessionMinutes: envInt('SESSION_MINUTES', DEFAULTS.sessionMinutes),
    maxPageSize: envInt('MAX_PAGE_SIZE', DEFAULTS.maxPageSize),
    maxExportRows: envInt('MAX_EXPORT_ROWS', DEFAULTS.maxExportRows),
    rateLimitWindowMs: envInt('RATE_LIMIT_WINDOW_MS', DEFAULTS.rateLimitWindowMs),
    rateLimitMax: envInt('RATE_LIMIT_MAX', DEFAULTS.rateLimitMax),
    loginRateLimitMax: envInt('LOGIN_RATE_LIMIT_MAX', DEFAULTS.loginRateLimitMax),
    recordRateLimitMax: envInt('RECORD_RATE_LIMIT_MAX', DEFAULTS.recordRateLimitMax),
    qualitativeRateLimitMax: envInt('QUALITATIVE_RATE_LIMIT_MAX', DEFAULTS.qualitativeRateLimitMax),
    auditStoreResearcherIp: envFlag('AUDIT_STORE_RESEARCHER_IP', false),
    trustedProxy,
    trustedProxyPlatform: trustedProxyVercel ? 'vercel' : '',
    trustedClientIpHeader,
    allowedOrigin: String(env.ALLOWED_ORIGIN || '').trim(),
  };
}

export const SECRET_CONFIG_KEYS = Object.freeze([
  'sessionSecret',
  'oidcClientSecret',
  'databaseUrl',
  'databaseCaCert',
]);

export function publicConfigSnapshot(config) {
  const out = {};
  for (const [key, value] of Object.entries(config || {})) {
    if (SECRET_CONFIG_KEYS.includes(key)) continue;
    out[key] = value;
  }
  return out;
}

export { createRateLimiter } from './rate-limit.mjs';
