import { randomBytes } from 'node:crypto';
import { loadConfig } from './config.mjs';
import { DEFAULTS } from './constants.mjs';
import {
  corsHeaders,
  expectedOrigin,
  fail,
  json,
  originAllowed,
  resolveRequestOrigin,
} from './http.mjs';
import { resolveQueryAdapter } from './query.mjs';
import { RATE_CATEGORIES, clientRateKey, resolveRateLimiter } from './rate-limit.mjs';
import { resolveSubmissionStore } from './store.mjs';
import { validateSubmissionPayload } from './validate.mjs';

const INVALID_JSON = Symbol.for('invalid_json');
const OVERSIZED = Symbol.for('oversized_body');

function requestIdOf() {
  return `sub_${randomBytes(12).toString('hex')}`;
}

function withRequestId(response, requestId) {
  response.headers = { ...response.headers, 'X-Request-Id': requestId };
  return response;
}

function contentTypeIsJson(headers = {}) {
  const raw = String(headers['content-type'] || headers['Content-Type'] || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  return raw === 'application/json';
}

function readBody(request, maxBytes) {
  if (request.body == null || request.body === '') return {};
  if (typeof request.body === 'object' && !Buffer.isBuffer(request.body)) {
    const encoded = JSON.stringify(request.body);
    if (Buffer.byteLength(encoded, 'utf8') > maxBytes) return OVERSIZED;
    return request.body;
  }
  const raw = Buffer.isBuffer(request.body) ? request.body : Buffer.from(String(request.body), 'utf8');
  if (raw.length > maxBytes) return OVERSIZED;
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    return INVALID_JSON;
  }
}

function pathOf(request) {
  const url = new URL(request.url, 'http://submission.invalid');
  let path = url.pathname.replace(/\/$/, '') || '/';
  if (path.startsWith('/api/submission')) {
    path = path.slice('/api/submission'.length) || '/';
  }
  return path;
}

/**
 * Minimal ops log — never answers, qualitative text, payloads, credentials,
 * tokens, or cookies.
 */
export function logSubmissionEvent(event) {
  const safe = {
    scope: 'submission_api',
    request_id: event.request_id || null,
    status: event.status ?? null,
    outcome: event.outcome || null,
    method: event.method || null,
    reason: event.reason || null,
  };
  // eslint-disable-next-line no-console
  console.info(JSON.stringify(safe));
}

export function createSubmissionApp(overrides = {}) {
  const config = { ...loadConfig(), ...overrides.config };
  const isolated = overrides.allowMemoryStores === true;
  const query = resolveQueryAdapter(config, { ...overrides, allowMemoryStores: isolated });
  const limiter = resolveRateLimiter(config, { ...overrides, query, allowMemoryStores: isolated });
  const store = resolveSubmissionStore(config, {
    ...overrides,
    query,
    allowMemoryStores: isolated,
  });
  const runtimeReady =
    isolated ||
    (Boolean(query) &&
      config.enabled === true &&
      config.dataReady === true &&
      limiter.backend === 'database' &&
      store.backend === 'database');

  async function handle(request) {
    const method = String(request.method || 'GET').toUpperCase();
    const path = pathOf(request);
    const requestId = requestIdOf();
    const respond = (response, meta = {}) => {
      const origin = resolveRequestOrigin(request.headers || {});
      const expected = expectedOrigin(request, config);
      const cors = corsHeaders(origin, expected);
      const next = {
        ...response,
        headers: { ...response.headers, ...cors },
      };
      if (meta.log !== false) {
        logSubmissionEvent({
          request_id: requestId,
          status: next.status,
          outcome: meta.outcome || (next.status < 400 ? 'ok' : 'error'),
          method,
          reason: meta.reason || null,
        });
      }
      return withRequestId(next, requestId);
    };

    if (path === '/health' && method === 'GET') {
      return respond(json(200, { ok: true }), { outcome: 'health', log: false });
    }

    if (method === 'OPTIONS' && (path === '/' || path === '')) {
      if (!originAllowed(request, config)) {
        return respond(fail('forbidden'), { reason: 'origin' });
      }
      return respond(json(204, {}), { outcome: 'preflight' });
    }

    if (path !== '/' && path !== '') {
      return respond(fail('not_found'), { reason: 'path' });
    }

    if (method !== 'POST') {
      return respond(fail('invalid_request'), { reason: 'method' });
    }

    if (!contentTypeIsJson(request.headers || {})) {
      return respond(fail('invalid_request'), { reason: 'content_type' });
    }

    if (!originAllowed(request, config)) {
      return respond(fail('forbidden'), { reason: 'origin' });
    }

    if (!runtimeReady || !config.enabled) {
      return respond(fail('unavailable'), { reason: 'disabled_or_unconfigured' });
    }

    if (limiter.backend === 'unavailable') {
      return respond(fail('unavailable'), { reason: 'rate_limiter' });
    }

    const ipKey = clientRateKey(request, config);
    if (!(await limiter.allow(RATE_CATEGORIES.submit, ipKey))) {
      return respond(fail('rate_limited'), { reason: 'rate_limited' });
    }

    const maxBytes = config.maxBodyBytes || DEFAULTS.maxBodyBytes;
    const body = readBody(request, maxBytes);
    if (body === OVERSIZED) {
      return respond(fail('invalid_request'), { reason: 'oversized' });
    }
    if (body === INVALID_JSON) {
      return respond(fail('invalid_request'), { reason: 'malformed_json' });
    }

    const parsed = validateSubmissionPayload(body);
    if (!parsed.ok) {
      return respond(fail(parsed.error), { reason: 'validation' });
    }

    try {
      await store.insert(parsed.row);
    } catch {
      return respond(fail('unavailable'), { reason: 'store' });
    }

    // Idempotent success — duplicates also return generic ok:true.
    return respond(json(200, { ok: true }), { outcome: 'accepted' });
  }

  return {
    handle,
    config,
    store,
    limiter,
    query,
  };
}
