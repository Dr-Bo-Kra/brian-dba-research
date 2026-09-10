/**
 * Submission rate limiting. Production requires the durable
 * submission_rate_limits table. Memory is fixtures / DI tests only.
 *
 * Bucket identity: SHA-256 of the server-observed connection key so the
 * durable store holds a hashed ephemeral bucket id rather than a raw IP.
 * Raw IP is not written to assessment_responses.
 */
import { createHash } from 'node:crypto';
import { SQL } from './db.mjs';
import { RATE_CATEGORIES } from './constants.mjs';

export { RATE_CATEGORIES };

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

export function hashedRateBucket(category, connectionKey) {
  return createHash('sha256')
    .update(`submission-rate:${category}:${connectionKey}`)
    .digest('hex')
    .slice(0, 40);
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
      const limiter = limiters[category] || limiters.submit;
      const bucket = hashedRateBucket(category, key);
      return limiter.allow(`${category}:${bucket}`);
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
      const max = limits[category] || limits.submit;
      const bucketKey = hashedRateBucket(category, key);
      const result = await query(SQL.hitRateLimit, [bucketKey, windowMs, max]);
      return result?.rows?.[0]?.allowed === true;
    },
  };
}

export function resolveRateLimiter(config, overrides = {}) {
  if (overrides.limiter) return overrides.limiter;
  if (overrides.allowMemoryStores === true) {
    return createCategoryRateLimiter({
      windowMs: config.rateLimitWindowMs,
      limits: { submit: config.rateLimitMax },
    });
  }
  if (config.rateLimitStore === 'database' && overrides.query) {
    return createDatabaseRateLimiter({
      query: overrides.query,
      windowMs: config.rateLimitWindowMs,
      limits: { submit: config.rateLimitMax },
    });
  }
  return createUnavailableRateLimiter();
}
