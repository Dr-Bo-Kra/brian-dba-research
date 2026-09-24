import { GENERIC_ERRORS } from './constants.mjs';

export function securityHeaders() {
  return {
    'Cache-Control': 'no-store, max-age=0',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Permissions-Policy':
      'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  };
}

export function json(status, body, extraHeaders = {}) {
  return {
    status,
    headers: {
      ...securityHeaders(),
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

export function fail(code, extraHeaders = {}) {
  return json(
    code === 'unauthorized'
      ? 401
      : code === 'forbidden'
        ? 403
        : code === 'not_found'
          ? 404
          : code === 'rate_limited'
            ? 429
            : code === 'invalid_request'
              ? 400
              : 503,
    { error: GENERIC_ERRORS[code] || GENERIC_ERRORS.unavailable },
    extraHeaders
  );
}

export function corsHeaders(origin, allowedOrigin) {
  if (!origin || !allowedOrigin || origin !== allowedOrigin) return {};
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

export function stripWildcardCors(headers = {}) {
  const next = { ...headers };
  if (next['Access-Control-Allow-Origin'] === '*' || next['access-control-allow-origin'] === '*') {
    delete next['Access-Control-Allow-Origin'];
    delete next['access-control-allow-origin'];
  }
  return next;
}

/**
 * Same-origin / allowlist check. Prefer Origin; fall back to Referer origin.
 * Empty allowedOrigin means derive expected origin from the Host header
 * (same-origin deployment). Never accepts "*".
 */
export function resolveRequestOrigin(headers = {}) {
  const origin = String(headers.origin || headers.Origin || '').trim();
  if (origin) return origin;
  const referer = String(headers.referer || headers.Referer || '').trim();
  if (!referer) return '';
  try {
    return new URL(referer).origin;
  } catch {
    return '';
  }
}

export function expectedOrigin(request, config = {}) {
  const configured = String(config.allowedOrigin || '').trim();
  if (configured) {
    if (configured === '*') return '';
    return configured;
  }
  const headers = request.headers || {};
  const host = String(headers.host || headers.Host || '').trim();
  if (!host || /[\s/]/.test(host)) return '';
  const protoRaw = String(headers['x-forwarded-proto'] || headers['X-Forwarded-Proto'] || 'https')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const proto = protoRaw === 'http' || protoRaw === 'https' ? protoRaw : 'https';
  return `${proto}://${host}`;
}

export function originAllowed(request, config = {}) {
  const expected = expectedOrigin(request, config);
  if (!expected) return false;
  const actual = resolveRequestOrigin(request.headers || {});
  return Boolean(actual) && actual === expected;
}
