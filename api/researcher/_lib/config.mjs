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
  const supabaseUrl = String(env.SUPABASE_URL || '').trim().replace(/\/$/, '');
  const supabasePublishableKey = String(
    env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || ''
  ).trim();
  const supabaseJwtAudience = String(env.SUPABASE_JWT_AUD || 'authenticated').trim() || 'authenticated';
  const supabaseAuthReady = Boolean(supabaseUrl && supabasePublishableKey);
  const mfaAssuranceReady = supabaseAuthReady;
  const sessionStore = env.SESSION_STORE === 'database' ? 'database' : '';
  const rateLimitStore = env.RATE_LIMIT_STORE === 'database' ? 'database' : '';
  const durableSessionReady = sessionStore === 'database' && Boolean(databaseUrl);
  const durableRateLimitReady = rateLimitStore === 'database' && Boolean(databaseUrl);
  const authReady = Boolean(
    enabled &&
      sessionSecret &&
      supabaseAuthReady &&
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
    supabaseUrl,
    supabasePublishableKey,
    supabaseJwtAudience,
    supabaseAuthReady,
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
  'supabasePublishableKey',
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
