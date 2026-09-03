/**
 * Temporary Preview-safe login readiness classification.
 * Allowlisted stage/category names only. Never log or return secrets.
 */
export const AUTH_DIAGNOSTIC_STAGES = Object.freeze([
  'runtime_stores',
  'auth_ready',
  'auth_client',
  'auth_usable',
  'ready',
  'password_exchange',
  'token_verify',
  'factor_list',
  'totp_enroll',
]);

export const AUTH_DIAGNOSTIC_CATEGORIES = Object.freeze([
  'runtime_stores_unready',
  'rate_limit_unavailable',
  'session_store_unavailable',
  'auth_state_unavailable',
  'api_disabled',
  'session_secret_missing',
  'supabase_url_missing',
  'supabase_key_missing',
  'session_store_not_database',
  'rate_limit_store_not_database',
  'auth_not_ready',
  'auth_not_constructed',
  'idp_not_configured',
  'ok',
  'exchange_threw',
  'jwks',
  'get_user',
  'get_claims_missing',
  'get_claims_threw',
  'get_claims_rejected',
  'list_unavailable',
  'list_threw',
  'enroll_unavailable',
  'enroll_threw',
  'ticket_threw',
]);

const BACKENDS = new Set(['database', 'memory', 'unavailable', '']);

function safeStage(stage) {
  return AUTH_DIAGNOSTIC_STAGES.includes(stage) ? stage : 'auth_usable';
}

function safeCategory(category) {
  return AUTH_DIAGNOSTIC_CATEGORIES.includes(category) ? category : 'idp_not_configured';
}

function safeBackend(value) {
  const backend = String(value || '');
  return BACKENDS.has(backend) ? backend : 'unavailable';
}

export function classifyLoginUnavailable({
  config = {},
  auth = null,
  runtimeStoresReady = false,
  limiter = {},
  sessions = {},
  authStates = {},
  isolated = false,
} = {}) {
  if (!isolated && (!runtimeStoresReady || limiter.backend === 'unavailable')) {
    if (limiter.backend === 'unavailable') {
      return { stage: 'runtime_stores', category: 'rate_limit_unavailable' };
    }
    if (sessions.backend !== 'database') {
      return { stage: 'runtime_stores', category: 'session_store_unavailable' };
    }
    if (authStates.backend !== 'database') {
      return { stage: 'runtime_stores', category: 'auth_state_unavailable' };
    }
    return { stage: 'runtime_stores', category: 'runtime_stores_unready' };
  }
  if (config.enabled !== true) {
    return { stage: 'auth_ready', category: 'api_disabled' };
  }
  if (!config.sessionSecret) {
    return { stage: 'auth_ready', category: 'session_secret_missing' };
  }
  if (!config.supabaseUrl) {
    return { stage: 'auth_ready', category: 'supabase_url_missing' };
  }
  if (!config.supabasePublishableKey) {
    return { stage: 'auth_ready', category: 'supabase_key_missing' };
  }
  if (config.sessionStore !== 'database') {
    return { stage: 'auth_ready', category: 'session_store_not_database' };
  }
  if (config.rateLimitStore !== 'database') {
    return { stage: 'auth_ready', category: 'rate_limit_store_not_database' };
  }
  if (config.authReady !== true && !isolated) {
    return { stage: 'auth_ready', category: 'auth_not_ready' };
  }
  if (!auth) {
    return { stage: 'auth_client', category: 'auth_not_constructed' };
  }
  if (!runtimeStoresReady || (!config.authReady && !isolated) || !config.sessionSecret) {
    return { stage: 'auth_usable', category: 'idp_not_configured' };
  }
  return { stage: 'ready', category: 'ok' };
}

export function compactAuthDiagnostic(input = {}) {
  const classified = classifyLoginUnavailable(input);
  const config = input.config || {};
  return {
    ok: classified.category === 'ok',
    enabled: config.enabled === true,
    authReady: config.authReady === true,
    supabaseAuthReady: config.supabaseAuthReady === true,
    hasSessionSecret: Boolean(config.sessionSecret),
    hasSupabaseUrl: Boolean(config.supabaseUrl),
    hasPublishableKey: Boolean(config.supabasePublishableKey),
    hasDatabaseUrl: Boolean(config.databaseUrl),
    sessionStore: safeBackend(config.sessionStore),
    rateLimitStore: safeBackend(config.rateLimitStore),
    durableSessionReady: config.durableSessionReady === true,
    durableRateLimitReady: config.durableRateLimitReady === true,
    runtimeStoresReady: input.runtimeStoresReady === true,
    authClientPresent: Boolean(input.auth),
    authStatesBackend: safeBackend(input.authStates?.backend),
    limiterBackend: safeBackend(input.limiter?.backend),
    sessionsBackend: safeBackend(input.sessions?.backend),
    isolated: input.isolated === true,
    stage: safeStage(classified.stage),
    category: safeCategory(classified.category),
  };
}

export function classifyAuthFetchKind(url, method) {
  const target = String(url || '');
  const verb = String(method || 'GET').toUpperCase();
  if (/jwks\.json/i.test(target) || /\/\.well-known\/jwks/i.test(target)) return 'jwks';
  if (/\/token\b/i.test(target) && (/grant_type=password/i.test(target) || verb === 'POST')) {
    return 'password_exchange';
  }
  if (/\/auth\/v1\/user(?:\?|$)/i.test(target)) return 'get_user';
  if (/\/factors/i.test(target)) {
    if (/\/challenge/i.test(target) || /\/verify/i.test(target)) return 'other';
    return verb === 'POST' ? 'totp_enroll' : 'factor_list';
  }
  return 'other';
}

export function classifyAuthFlowFailure({ stage, category, fetchKind } = {}) {
  if (stage === 'token_verify' && (fetchKind === 'jwks' || fetchKind === 'get_user')) {
    category = fetchKind;
  }
  return {
    stage: AUTH_DIAGNOSTIC_STAGES.includes(stage) ? stage : 'token_verify',
    category: AUTH_DIAGNOSTIC_CATEGORIES.includes(category) ? category : 'get_claims_rejected',
  };
}

export function logLoginUnavailable({ stage, category } = {}) {
  console.error(
    JSON.stringify({
      diagnostic: 'login',
      ok: false,
      stage: safeStage(stage),
      category: safeCategory(category),
    })
  );
}
