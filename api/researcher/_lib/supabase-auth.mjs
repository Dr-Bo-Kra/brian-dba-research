/**
 * Server-side Supabase Auth (password + mandatory TOTP).
 *
 * Access tokens are verified with supabase.auth.getClaims() on a server-only
 * client (SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY). Asymmetric tokens are
 * checked against the project JWKS; HS256 falls back to Auth getUser().
 * Issuer, audience, expiry, subject, and role are re-checked after getClaims.
 * This client is never used for PostgREST / research tables. The browser never
 * receives the publishable key.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { classifyAuthFetchKind, classifyAuthFlowFailure } from './auth-diagnostic.mjs';

const TICKET_TTL_MS = 5 * 60 * 1000;
const AUTH_AUD = 'authenticated';

const NO_SESSION_STORAGE = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

export function supabaseIssuer(url) {
  return `${String(url || '').replace(/\/$/, '')}/auth/v1`;
}

export function supabaseJwksUrl(url) {
  return `${supabaseIssuer(url)}/.well-known/jwks.json`;
}

function amrMethods(claims) {
  const amr = Array.isArray(claims?.amr) ? claims.amr : [];
  return amr
    .map((item) => (typeof item === 'string' ? item : item && item.method))
    .map((item) => String(item || '').toLowerCase())
    .filter(Boolean);
}

export function requiredMfaSatisfied(claims) {
  if (!claims || typeof claims !== 'object') return false;
  if (String(claims.aal || '') !== 'aal2') return false;
  return amrMethods(claims).includes('totp');
}

function assertRegisteredClaims(payload, { issuer, audience = AUTH_AUD, now = Date.now() }) {
  if (!payload || typeof payload !== 'object') return { ok: false, error: 'malformed' };
  if (payload.iss !== issuer) return { ok: false, error: 'tampered' };
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(audience)) return { ok: false, error: 'tampered' };
  if (payload.role === 'service_role' || payload.role === 'supabase_admin') {
    return { ok: false, error: 'tampered' };
  }
  if (payload.role && payload.role !== AUTH_AUD) return { ok: false, error: 'tampered' };
  if (!payload.exp || payload.exp * 1000 <= now) return { ok: false, error: 'expired' };
  if (payload.nbf && payload.nbf * 1000 > now) return { ok: false, error: 'malformed' };
  if (!payload.sub || typeof payload.sub !== 'string') return { ok: false, error: 'malformed' };
  return { ok: true, claims: payload };
}

function claimsError(error) {
  const message = String(error?.message || error || '').toLowerCase();
  if (message.includes('expir')) return 'expired';
  if (error?.status === 401 || message.includes('invalid') || message.includes('jwt')) {
    return 'tampered';
  }
  if (error?.status >= 500 || message.includes('fetch') || message.includes('network')) {
    return 'unavailable';
  }
  return 'tampered';
}

/**
 * Cryptographically verify a Supabase user access token via getClaims(),
 * then enforce issuer/audience/role/sub. Do not pass a JWT secret.
 */
function resolveFetchKind(options = {}) {
  if (typeof options.getFetchKind === 'function') return options.getFetchKind();
  return options.fetchKind;
}

function tokenVerifyDiagnostic(category, options) {
  return classifyAuthFlowFailure({
    stage: 'token_verify',
    category,
    fetchKind: resolveFetchKind(options),
  });
}

export async function verifyAccessToken(token, options = {}) {
  if (!token || typeof token !== 'string') return { ok: false, error: 'malformed' };
  if (typeof options.getClaims !== 'function') {
    return {
      ok: false,
      error: 'unavailable',
      diagnostic: tokenVerifyDiagnostic('get_claims_missing', options),
    };
  }

  let result;
  try {
    result = await options.getClaims(token);
  } catch (error) {
    const code = claimsError(error);
    return {
      ok: false,
      error: code,
      diagnostic: code === 'unavailable' ? tokenVerifyDiagnostic('get_claims_threw', options) : undefined,
    };
  }

  if (result?.error || !result?.data?.claims) {
    const code = claimsError(result?.error);
    return {
      ok: false,
      error: code,
      diagnostic:
        code === 'unavailable' ? tokenVerifyDiagnostic('get_claims_rejected', options) : undefined,
    };
  }

  return assertRegisteredClaims(result.data.claims, options);
}

function aesKey(secret) {
  return createHash('sha256').update(String(secret || '')).digest();
}

export function encryptSecret(plaintext, secret) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', aesKey(secret), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64url');
}

export function decryptSecret(blob, secret) {
  try {
    const buf = Buffer.from(String(blob || ''), 'base64url');
    if (buf.length < 29) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', aesKey(secret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export function encodePendingNonce(subject, factorId = '') {
  return `${subject}|${factorId || ''}`;
}

export function decodePendingNonce(nonce) {
  const text = String(nonce || '');
  const idx = text.indexOf('|');
  if (idx < 1) return { subject: text, factorId: '' };
  return { subject: text.slice(0, idx), factorId: text.slice(idx + 1) };
}

function safeQr(value) {
  const qr = String(value || '');
  return qr.startsWith('data:image/') ? qr : '';
}

export function normalizeFactorList(json) {
  const bags = [
    json,
    json?.factors,
    json?.all,
    json?.totp,
    json?.data,
    json?.data?.factors,
    json?.data?.all,
    json?.data?.totp,
  ];
  const rows = [];
  for (const bag of bags) {
    if (Array.isArray(bag)) rows.push(...bag);
  }
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = row.id;
    const type = String(row.factor_type || row.factorType || row.type || '').toLowerCase();
    const status = String(row.status || '').toLowerCase();
    if (!id || seen.has(id)) continue;
    if (type !== 'totp' || status !== 'verified') continue;
    seen.add(id);
    out.push({ id: String(id) });
  }
  return out;
}

function tokensFromAuthBody(json) {
  return {
    accessToken: json?.access_token || json?.data?.access_token || json?.session?.access_token || '',
    refreshToken:
      json?.refresh_token || json?.data?.refresh_token || json?.session?.refresh_token || '',
  };
}

export function encodeTicketSecrets({ accessToken, refreshToken } = {}) {
  return JSON.stringify({
    a: String(accessToken || ''),
    r: String(refreshToken || ''),
  });
}

export function decodeTicketSecrets(plaintext) {
  const text = String(plaintext || '');
  if (!text) return { accessToken: '', refreshToken: '' };
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        return {
          accessToken: String(parsed.a || parsed.accessToken || ''),
          refreshToken: String(parsed.r || parsed.refreshToken || ''),
        };
      }
    } catch {
      return { accessToken: '', refreshToken: '' };
    }
  }
  return { accessToken: text, refreshToken: '' };
}

function verifiedTotpFromSdk(data) {
  const totp = Array.isArray(data?.totp) ? data.totp : [];
  return totp
    .filter((row) => row?.id)
    .map((row) => ({ id: String(row.id) }));
}

export async function createScopedMfaClient(config, { accessToken, refreshToken, fetchImpl = fetch } = {}) {
  if (!accessToken || !refreshToken) return { ok: false, error: 'unavailable' };
  const client = createServerAuthClient(config, fetchImpl);
  const { data, error } = await client.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error || !data?.session?.access_token) return { ok: false, error: 'unavailable' };
  return { ok: true, client };
}

function headerValue(headers, name) {
  if (!headers) return '';
  if (typeof headers.get === 'function') return headers.get(name) || '';
  const key = Object.keys(headers).find((item) => item.toLowerCase() === name.toLowerCase());
  return key ? String(headers[key]) : '';
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function createServerAuthClient(config, fetchImpl = fetch) {
  return createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: NO_SESSION_STORAGE,
    },
    global: { fetch: fetchImpl },
  });
}

export function wrapHarnessFetch(harness, fetchImpl) {
  if (!harness) return fetchImpl || fetch;
  return async (url, init = {}) => {
    const target = String(url);
    if (target.includes('/.well-known/jwks.json')) {
      return jsonResponse(harness.jwks, 200);
    }
    if (target.includes('/auth/v1/user')) {
      const token = headerValue(init.headers, 'Authorization').replace(/^Bearer\s+/i, '');
      const result = await harness.fetchUser(token);
      return jsonResponse(result.ok ? { id: result.id } : {}, result.ok ? 200 : 401);
    }
    if (typeof fetchImpl === 'function') return fetchImpl(url, init);
    return jsonResponse({}, 404);
  };
}

export function createClaimsVerifier(config, { fetchImpl = fetch, jwks, harness } = {}) {
  const sdk = createServerAuthClient(config, wrapHarnessFetch(harness, fetchImpl));
  return (jwt) => sdk.auth.getClaims(jwt, jwks ? { jwks } : {});
}

function authHeaders(config, accessToken) {
  const publishable = config.supabasePublishableKey;
  const headers = {
    apikey: publishable,
    'Content-Type': 'application/json',
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  return headers;
}

export function createSupabaseAuthClient(config, { harness = null, fetchImpl = fetch } = {}) {
  const issuer = supabaseIssuer(config.supabaseUrl);
  const audience = config.supabaseJwtAudience || AUTH_AUD;
  let lastFetchKind = 'other';
  const trackedFetch = async (url, init = {}) => {
    lastFetchKind = classifyAuthFetchKind(url, init.method);
    return fetchImpl(url, init);
  };
  const getClaims = createClaimsVerifier(config, {
    fetchImpl: trackedFetch,
    harness,
    jwks: harness?.jwks,
  });

  function verified(token) {
    return verifyAccessToken(token, {
      issuer,
      audience,
      getClaims,
      getFetchKind: () => lastFetchKind,
    });
  }

  async function gotrue(path, { method = 'GET', accessToken, body } = {}) {
    const res = await trackedFetch(`${String(config.supabaseUrl).replace(/\/$/, '')}/auth/v1${path}`, {
      method,
      headers: authHeaders(config, accessToken),
      body: body == null ? undefined : JSON.stringify(body),
    });
    let json = {};
    try {
      json = await res.json();
    } catch {
      json = {};
    }
    return { ok: res.ok, status: res.status, json };
  }

  return {
    harness,
    issuer,
    async passwordGrant(email, password) {
      if (harness) {
        const granted = await harness.passwordGrant(email, password);
        if (!granted.ok) return granted;
        const checked = await verified(granted.accessToken);
        if (!checked.ok) return checked;
        return {
          ok: true,
          accessToken: granted.accessToken,
          refreshToken: granted.refreshToken || '',
          claims: checked.claims,
        };
      }
      const res = await gotrue('/token?grant_type=password', {
        method: 'POST',
        body: { email, password },
      });
      const { accessToken, refreshToken } = tokensFromAuthBody(res.json);
      if (!res.ok || !accessToken) return { ok: false, error: 'unauthorized' };
      const checked = await verified(accessToken);
      if (!checked.ok) return checked;
      return { ok: true, accessToken, refreshToken, claims: checked.claims };
    },
    async listVerifiedTotpFactors(accessToken, refreshToken) {
      const checked = await verified(accessToken);
      if (!checked.ok) return checked;
      if (harness) {
        return { ok: true, factors: normalizeFactorList(harness.listFactors(checked.claims.email)) };
      }
      const scoped = await createScopedMfaClient(config, {
        accessToken,
        refreshToken,
        fetchImpl: trackedFetch,
      });
      if (!scoped.ok) {
        return {
          ok: false,
          error: 'unavailable',
          diagnostic: classifyAuthFlowFailure({
            stage: 'factor_list',
            category: 'list_unavailable',
            fetchKind: lastFetchKind,
          }),
        };
      }
      const { data, error } = await scoped.client.auth.mfa.listFactors();
      if (error || !data) {
        return {
          ok: false,
          error: 'unavailable',
          diagnostic: classifyAuthFlowFailure({
            stage: 'factor_list',
            category: 'list_unavailable',
            fetchKind: lastFetchKind,
          }),
        };
      }
      return { ok: true, factors: verifiedTotpFromSdk(data) };
    },
    async enrollTotp(accessToken, refreshToken) {
      const checked = await verified(accessToken);
      if (!checked.ok) return checked;
      if (harness) {
        const enrolled = harness.enroll(checked.claims.email);
        if (!enrolled.ok) return enrolled;
        return { ok: true, factorId: enrolled.factorId, qr: safeQr(enrolled.qr) };
      }
      const scoped = await createScopedMfaClient(config, {
        accessToken,
        refreshToken,
        fetchImpl: trackedFetch,
      });
      if (!scoped.ok) {
        return {
          ok: false,
          error: 'unavailable',
          diagnostic: classifyAuthFlowFailure({
            stage: 'totp_enroll',
            category: 'enroll_unavailable',
            fetchKind: lastFetchKind,
          }),
        };
      }
      const { data, error } = await scoped.client.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'authenticator',
      });
      const factorId = data?.id;
      const qr = safeQr(data?.totp?.qr_code);
      if (error || !factorId) {
        return {
          ok: false,
          error: 'unavailable',
          diagnostic: classifyAuthFlowFailure({
            stage: 'totp_enroll',
            category: 'enroll_unavailable',
            fetchKind: lastFetchKind,
          }),
        };
      }
      return { ok: true, factorId: String(factorId), qr };
    },
    async verifyTotp(accessToken, factorId, code, refreshToken) {
      if (!factorId || !/^[0-9]{6,8}$/.test(String(code || ''))) {
        return { ok: false, error: 'unauthorized' };
      }
      const checked = await verified(accessToken);
      if (!checked.ok) return checked;
      if (harness) {
        const verifiedFactor = await harness.verifyFactor(factorId, code);
        if (!verifiedFactor.ok) return verifiedFactor;
        const next = await verified(verifiedFactor.accessToken);
        if (!next.ok) return next;
        if (!requiredMfaSatisfied(next.claims)) return { ok: false, error: 'forbidden' };
        if (next.claims.sub !== checked.claims.sub) return { ok: false, error: 'tampered' };
        return { ok: true, accessToken: verifiedFactor.accessToken, claims: next.claims };
      }
      const scoped = await createScopedMfaClient(config, {
        accessToken,
        refreshToken,
        fetchImpl: trackedFetch,
      });
      if (!scoped.ok) return { ok: false, error: 'unavailable' };
      const challenge = await scoped.client.auth.mfa.challenge({ factorId });
      const challengeId = challenge.data?.id;
      if (challenge.error || !challengeId) return { ok: false, error: 'unauthorized' };
      const verifiedFactor = await scoped.client.auth.mfa.verify({
        factorId,
        challengeId,
        code: String(code),
      });
      const nextToken = tokensFromAuthBody(verifiedFactor.data).accessToken;
      if (verifiedFactor.error || !nextToken) return { ok: false, error: 'unauthorized' };
      const next = await verified(nextToken);
      if (!next.ok) return next;
      if (!requiredMfaSatisfied(next.claims)) return { ok: false, error: 'forbidden' };
      if (next.claims.sub !== checked.claims.sub) return { ok: false, error: 'tampered' };
      return { ok: true, accessToken: nextToken, claims: next.claims };
    },
    verifyAccessToken(token) {
      return verified(token);
    },
    ticketTtlMs: TICKET_TTL_MS,
  };
}
