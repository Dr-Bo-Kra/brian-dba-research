import { DEFAULTS } from './constants.mjs';

function envInt(name, fallback, env) {
  const raw = env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function loadConfig(env = process.env) {
  const enabled = env.SUBMISSION_API_ENABLED === 'true';
  const databaseUrl = String(env.SUBMISSION_DATABASE_URL || '').trim();
  const databaseCaCert = String(env.SUBMISSION_DATABASE_CA_CERT || env.DATABASE_CA_CERT || '').trim();
  const rateLimitStore = env.SUBMISSION_RATE_LIMIT_STORE === 'database' ? 'database' : '';
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
  const allowedOrigin = String(env.SUBMISSION_ALLOWED_ORIGIN || env.ALLOWED_ORIGIN || '').trim();
  const durableRateLimitReady = rateLimitStore === 'database' && Boolean(databaseUrl);
  const dataReady = Boolean(enabled && databaseUrl && durableRateLimitReady);

  return {
    enabled,
    databaseUrl,
    databaseCaCert,
    rateLimitStore,
    durableRateLimitReady,
    dataReady,
    allowMemoryStores: false,
    maxBodyBytes: envInt('SUBMISSION_MAX_BODY_BYTES', DEFAULTS.maxBodyBytes, env),
    rateLimitWindowMs: envInt('SUBMISSION_RATE_LIMIT_WINDOW_MS', DEFAULTS.rateLimitWindowMs, env),
    rateLimitMax: envInt('SUBMISSION_RATE_LIMIT_MAX', DEFAULTS.rateLimitMax, env),
    trustedProxy,
    trustedProxyPlatform: trustedProxyVercel ? 'vercel' : '',
    trustedClientIpHeader,
    allowedOrigin,
    vercelEnv: String(env.VERCEL_ENV || '').trim().toLowerCase(),
  };
}

export const SECRET_CONFIG_KEYS = Object.freeze([
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
