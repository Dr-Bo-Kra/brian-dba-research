import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { GENERIC_ERRORS } from './constants.mjs';

const SESSION_COOKIE = '__Host-dba-researcher';
const CSRF_COOKIE = '__Host-dba-csrf';
const AUTH_TX_COOKIE = '__Host-dba-auth-tx';
const OIDC_TX_COOKIE = '__Host-dba-oidc-tx';

export { SESSION_COOKIE, CSRF_COOKIE, AUTH_TX_COOKIE, OIDC_TX_COOKIE };

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

export function cookieHeader(name, value, { maxAgeSeconds, httpOnly = true, sameSite = 'Strict' } = {}) {
  const site = sameSite === 'Lax' ? 'Lax' : 'Strict';
  const parts = [
    `${name}=${value}`,
    'Path=/',
    'Secure',
    `SameSite=${site}`,
    `Max-Age=${Math.max(0, maxAgeSeconds ?? 0)}`,
  ];
  if (httpOnly) parts.push('HttpOnly');
  return parts.join('; ');
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

export function signSessionId(sessionId, secret) {
  const hmac = createHmac('sha256', secret).update(sessionId).digest('hex');
  return `${sessionId}.${hmac}`;
}

export function verifySignedSession(token, secret) {
  if (!token || !secret || !token.includes('.')) return null;
  const idx = token.lastIndexOf('.');
  const sessionId = token.slice(0, idx);
  const digest = token.slice(idx + 1);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(sessionId) || !/^[a-f0-9]{64}$/.test(digest)) return null;
  const expected = createHmac('sha256', secret).update(sessionId).digest('hex');
  const a = Buffer.from(digest);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return sessionId;
}

export function newOpaqueId() {
  return randomBytes(32).toString('hex');
}

export function createMemorySessionStore() {
  const sessions = new Map();
  return {
    async create(record) {
      const id = newOpaqueId();
      sessions.set(id, { ...record, id });
      return id;
    },
    async get(id) {
      const row = sessions.get(id);
      if (!row) return null;
      if (Date.parse(row.expiresAt) <= Date.now() || row.revokedAt) {
        sessions.delete(id);
        return null;
      }
      return row;
    },
    async revoke(id) {
      const row = sessions.get(id);
      if (row) {
        row.revokedAt = new Date().toISOString();
        sessions.set(id, row);
      }
    },
    async revokeSubject(subject) {
      for (const [id, row] of sessions) {
        if (row.authSubject === subject) {
          row.revokedAt = new Date().toISOString();
          sessions.set(id, row);
        }
      }
    },
    async cleanupExpired() {
      for (const [id, row] of sessions) {
        if (Date.parse(row.expiresAt) <= Date.now()) sessions.delete(id);
      }
    },
    async rotate(previousId, record) {
      if (previousId) {
        const row = sessions.get(previousId);
        if (row) {
          row.revokedAt = new Date().toISOString();
          sessions.set(previousId, row);
        }
      }
      const id = newOpaqueId();
      sessions.set(id, { ...record, id });
      return id;
    },
  };
}

export function csrfFromSession(sessionId, secret) {
  return createHmac('sha256', secret).update(`csrf:${sessionId}`).digest('hex');
}

export function csrfMatches(provided, expected) {
  if (!provided || !expected) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
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

export function redirect(location, extraHeaders = {}) {
  return {
    status: 302,
    headers: {
      ...securityHeaders(),
      Location: location,
      ...extraHeaders,
    },
    body: '',
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
