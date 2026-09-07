/**
 * Thin Vercel Node adapter for the protected submission API.
 * Auth, validation, rate limits, and SQL stay in `_lib`.
 * Runtime: Node.js (not Edge). Process memory is not a production store.
 */
import { createSubmissionApp } from './_lib/app.mjs';
import { loadConfig } from './_lib/config.mjs';
import { createProductionQueryAdapter } from './_lib/query.mjs';
import { stripWildcardCors } from './_lib/http.mjs';

let cachedApp;

export function getSubmissionApp(overrides = {}) {
  if (overrides.app) return overrides.app;
  if (!cachedApp) {
    const config = overrides.config || loadConfig();
    const query = Object.prototype.hasOwnProperty.call(overrides, 'query')
      ? overrides.query
      : createProductionQueryAdapter(config);
    cachedApp = createSubmissionApp({ config, query });
  }
  return cachedApp;
}

export function resetSubmissionAppForTests() {
  cachedApp = undefined;
}

function normalizeHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    out[String(key).toLowerCase()] = Array.isArray(value) ? value.join(',') : value;
  }
  return out;
}

async function readNodeBody(req, maxBytes) {
  if (req.body != null && req.body !== '') {
    if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
      const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(String(req.body), 'utf8');
      if (raw.length > maxBytes) return { oversized: true };
      return { body: raw.toString('utf8') };
    }
    const encoded = JSON.stringify(req.body);
    if (Buffer.byteLength(encoded, 'utf8') > maxBytes) return { oversized: true };
    return { body: encoded };
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) return { oversized: true };
    chunks.push(chunk);
  }
  return { body: Buffer.concat(chunks).toString('utf8') };
}

function nestedSubmissionPath(pathname) {
  const path = String(pathname || '').split('?')[0];
  if (!path.startsWith('/api/submission')) return '';
  if (path === '/api/submission' || path === '/api/submission/' || path === '/api/submission/index') {
    return '/api/submission';
  }
  return path.replace(/\/$/, '') || '/api/submission';
}

export function resolveSubmissionRequestUrl(req, headers = {}) {
  const host = headers.host || 'vercel.invalid';
  const rawUrl = req.url || '/';
  const url = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${host}${rawUrl}`);
  const nested =
    nestedSubmissionPath(url.pathname) ||
    nestedSubmissionPath(headers['x-forwarded-uri']) ||
    nestedSubmissionPath(headers['x-invoke-path']);
  if (nested) url.pathname = nested;
  return url.toString();
}

export async function handleVercelSubmissionRequest(req, res, overrides = {}) {
  const headers = normalizeHeaders(req.headers);
  const config = overrides.config || loadConfig();
  const maxBytes = config.maxBodyBytes || 96_000;
  const parsedBody = await readNodeBody(req, maxBytes);
  const url = resolveSubmissionRequestUrl(req, headers);
  const app = getSubmissionApp(overrides);
  const result = await app.handle({
    method: req.method,
    url,
    headers,
    body: parsedBody.oversized ? Buffer.alloc(maxBytes + 1) : parsedBody.body,
    ip: req.socket?.remoteAddress || '',
  });
  const responseHeaders = stripWildcardCors({ ...result.headers });
  if (typeof res.writeHead === 'function') {
    res.writeHead(result.status, responseHeaders);
    res.end(result.body);
  }
  return result;
}
