/**
 * Thin Vercel Node adapter. Maps platform request/response onto the shared
 * researcher app. Auth, sessions, rate limits, and SQL stay in `_lib`.
 *
 * Runtime: Node.js (not Edge). Process memory is not a production store.
 */
import { createResearcherApp } from './_lib/app.mjs';
import { loadConfig } from './_lib/config.mjs';
import { createProductionQueryAdapter } from './_lib/query.mjs';

let cachedApp;

export function getResearcherApp(overrides = {}) {
  if (overrides.app) return overrides.app;
  if (!cachedApp) {
    const config = overrides.config || loadConfig();
    const query =
      Object.prototype.hasOwnProperty.call(overrides, 'query')
        ? overrides.query
        : createProductionQueryAdapter(config);
    cachedApp = createResearcherApp({ config, query });
  }
  return cachedApp;
}

export function resetResearcherAppForTests() {
  cachedApp = undefined;
}

function normalizeHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    out[String(key).toLowerCase()] = Array.isArray(value) ? value.join(',') : value;
  }
  return out;
}

export function stripWildcardCors(headers = {}) {
  const next = { ...headers };
  if (next['Access-Control-Allow-Origin'] === '*' || next['access-control-allow-origin'] === '*') {
    delete next['Access-Control-Allow-Origin'];
    delete next['access-control-allow-origin'];
  }
  return next;
}

async function readNodeBody(req) {
  if (req.body != null && req.body !== '') {
    if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) return String(req.body);
    return JSON.stringify(req.body);
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function nestedResearcherPath(pathname) {
  const path = String(pathname || '').split('?')[0];
  if (!path.startsWith('/api/researcher/')) return '';
  if (path === '/api/researcher/' || path === '/api/researcher/index') return '';
  return path.replace(/\/$/, '') || '';
}

export function resolveResearcherRequestUrl(req, headers = {}) {
  const host = headers.host || 'vercel.invalid';
  const rawUrl = req.url || '/';
  const url = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${host}${rawUrl}`);
  const nested =
    nestedResearcherPath(url.pathname) ||
    nestedResearcherPath(headers['x-forwarded-uri']) ||
    nestedResearcherPath(headers['x-invoke-path']);
  if (nested) url.pathname = nested;
  stripVercelRewritePathParam(url);
  return url.toString();
}

function normalizeRewritePathCapture(value) {
  let next = String(value || '');
  try {
    next = decodeURIComponent(next);
  } catch {
    // keep the raw capture when percent-decoding fails
  }
  return next.replace(/^\/+/, '').replace(/\/+$/, '');
}

function stripVercelRewritePathParam(url) {
  if (!url.searchParams.has('path')) return;
  const nested = nestedResearcherPath(url.pathname);
  if (!nested) return;
  const expected = nested.slice('/api/researcher/'.length);
  const capture = url.searchParams.get('path');
  if (normalizeRewritePathCapture(capture) !== normalizeRewritePathCapture(expected)) {
    return;
  }
  url.searchParams.delete('path');
}

export async function handleVercelResearcherRequest(req, res, overrides = {}) {
  const headers = normalizeHeaders(req.headers);
  const url = resolveResearcherRequestUrl(req, headers);
  const app = getResearcherApp(overrides);
  const result = await app.handle({
    method: req.method,
    url,
    headers,
    body: await readNodeBody(req),
    ip: req.socket?.remoteAddress || '',
  });
  const cookies = result.headers['Set-Cookie'];
  const responseHeaders = stripWildcardCors({ ...result.headers });
  delete responseHeaders['Set-Cookie'];
  if (cookies) responseHeaders['Set-Cookie'] = cookies;
  if (typeof res.writeHead === 'function') {
    res.writeHead(result.status, responseHeaders);
    res.end(result.body);
  }
  return result;
}
