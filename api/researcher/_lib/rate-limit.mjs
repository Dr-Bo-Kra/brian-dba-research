/**
 * Rate limiting. Production requires a durable backend; memory is fixtures only.
 * Identity is taken from the connection, never from client-controlled headers.
 */
import { SQL } from './db.mjs';

export const RATE_CATEGORIES = Object.freeze({
  login: 'login',
  api: 'api',
  record: 'record',
  qualitative: 'qualitative',
});

export function clientRateKey(request, config = {}) {
  const vercelOnly = config.trustedProxyPlatform === 'vercel';
  const allowProxyHeader = config.trustedProxy === true || vercelOnly;
  if (allowProxyHeader) {
    const headerName = String(config.trustedClientIpHeader || '').toLowerCase();
    const allowed = vercelOnly
      ? ['x-vercel-forwarded-for']
      : ['x-forwarded-for', 'x-real-ip', 'x-vercel-forwarded-for'];
    if (allowed.includes(headerName)) {
      const raw = request.headers?.[headerName] || request.headers?.[config.trustedClientIpHeader];
      const first = String(raw || '')
        .split(',')[0]
        .trim();
      if (/^[A-Za-z0-9.:]+$/.test(first)) return first;
    }
  }
  return String(request.ip || 'unknown');
}

export function createRateLimiter({ windowMs, max }) {
  const hits = new Map();
  return {
    backend: 'memory',
    async allow(key) {
      const now = Date.now();
      const bucket = hits.get(key);
      if (!bucket || now - bucket.start >= windowMs) {
        hits.set(key, { start: now, count: 1 });
        return true;
      }
      if (bucket.count >= max) return false;
      bucket.count += 1;
      return true;
    },
  };
}

export function createCategoryRateLimiter({ windowMs, limits }) {
  const limiters = Object.fromEntries(
    Object.entries(limits).map(([name, max]) => [name, createRateLimiter({ windowMs, max })])
  );
  return {
    backend: 'memory',
    async allow(category, key) {
      const limiter = limiters[category] || limiters.api;
      return limiter.allow(`${category}:${key}`);
    },
  };
}

export function createUnavailableRateLimiter() {
  return {
    backend: 'unavailable',
    async allow() {
      return false;
    },
  };
}

export function createDatabaseRateLimiter({ query, windowMs, limits }) {
  return {
    backend: 'database',
    async allow(category, key) {
      const max = limits[category] || limits.api;
      const bucketKey = `${category}:${key}`;
      const result = await query(SQL.hitRateLimit, [bucketKey, windowMs, max]);
      return result?.rows?.[0]?.allowed === true;
    },
  };
}

export function resolveRateLimiter(config, overrides = {}) {
  if (overrides.limiter && overrides.loginLimiter == null && overrides.recordLimiter == null) {
    if (typeof overrides.limiter.allow === 'function' && overrides.limiter.backend) {
      return overrides.limiter;
    }
  }
  if (overrides.allowMemoryStores === true) {
    return createCategoryRateLimiter({
      windowMs: config.rateLimitWindowMs,
      limits: {
        login: config.loginRateLimitMax,
        api: config.rateLimitMax,
        record: config.recordRateLimitMax,
        qualitative: config.qualitativeRateLimitMax,
      },
    });
  }
  if (config.rateLimitStore === 'database' && overrides.query) {
    return createDatabaseRateLimiter({
      query: overrides.query,
      windowMs: config.rateLimitWindowMs,
      limits: {
        login: config.loginRateLimitMax,
        api: config.rateLimitMax,
        record: config.recordRateLimitMax,
        qualitative: config.qualitativeRateLimitMax,
      },
    });
  }
  return createUnavailableRateLimiter();
}
