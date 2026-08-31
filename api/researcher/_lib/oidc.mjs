/**
 * Server-side OIDC Authorization Code + PKCE.
 * Tokens never go to the browser. Production stays fail-closed until an
 * institutional IdP and MFA assurance values are configured.
 */
import { createHash, createPublicKey, createSign, createVerify, generateKeyPairSync, randomBytes } from 'node:crypto';
import { SQL } from './db.mjs';

const CODE_TTL_MS = 5 * 60 * 1000;

export function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function parseBase64urlJson(value) {
  try {
    const text = Buffer.from(String(value), 'base64url').toString('utf8');
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function pkcePair() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function requiredMfaSatisfied(claims, config) {
  if (!claims || typeof claims !== 'object') return false;
  const acrNeeded = String(config.oidcRequiredAcr || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  const amrNeeded = String(config.oidcRequiredAmr || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!acrNeeded.length && !amrNeeded.length) return false;
  if (acrNeeded.length && acrNeeded.includes(String(claims.acr || ''))) return true;
  const amr = Array.isArray(claims.amr) ? claims.amr.map(String) : [];
  return amrNeeded.length > 0 && amrNeeded.some((value) => amr.includes(value));
}

export async function verifyIdToken(token, { issuer, audience, nonce, now = Date.now(), getKey }) {
  if (!token || typeof token !== 'string' || token.split('.').length !== 3) {
    return { ok: false, error: 'malformed' };
  }
  const [rawHeader, rawPayload, rawSig] = token.split('.');
  const header = parseBase64urlJson(rawHeader);
  const payload = parseBase64urlJson(rawPayload);
  if (!header || !payload) return { ok: false, error: 'malformed' };
  if (header.alg !== 'RS256' || (header.typ && header.typ !== 'JWT')) {
    return { ok: false, error: 'tampered' };
  }
  const key = await getKey(header.kid);
  if (!key) return { ok: false, error: 'tampered' };
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${rawHeader}.${rawPayload}`);
  verifier.end();
  let signatureOk = false;
  try {
    signatureOk = verifier.verify(key, Buffer.from(rawSig, 'base64url'));
  } catch {
    signatureOk = false;
  }
  if (!signatureOk) return { ok: false, error: 'tampered' };
  if (payload.iss !== issuer) return { ok: false, error: 'tampered' };
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(audience)) return { ok: false, error: 'tampered' };
  if (!payload.exp || payload.exp * 1000 <= now) return { ok: false, error: 'expired' };
  if (payload.nbf && payload.nbf * 1000 > now) return { ok: false, error: 'malformed' };
  if (nonce && payload.nonce !== nonce) return { ok: false, error: 'tampered' };
  if (!payload.sub || typeof payload.sub !== 'string') return { ok: false, error: 'malformed' };
  return { ok: true, claims: payload };
}

export function createMemoryAuthStateStore() {
  const rows = new Map();
  return {
    backend: 'memory',
    async put(record) {
      rows.set(record.state, { ...record });
    },
    async consume(state, transactionId) {
      const row = rows.get(state);
      if (row) rows.delete(state);
      if (!row) return null;
      if (Date.parse(row.expiresAt) <= Date.now()) return null;
      if (!transactionId || row.transactionId !== transactionId) return null;
      return row;
    },
    async peek(state) {
      return rows.get(state) || null;
    },
  };
}

export function createDatabaseAuthStateStore(query) {
  return {
    backend: 'database',
    async put(record) {
      await query(SQL.putAuthState, [
        record.state,
        record.nonce,
        record.codeVerifier,
        record.transactionId,
        record.expiresAt,
      ]);
    },
    async consume(state, transactionId) {
      const result = await query(SQL.consumeAuthState, [state]);
      const hit = result?.rows?.[0];
      if (!hit) return null;
      if (!transactionId || hit.transaction_id !== transactionId) return null;
      return {
        state: hit.state,
        nonce: hit.nonce,
        codeVerifier: hit.code_verifier,
        transactionId: hit.transaction_id,
        expiresAt: hit.expires_at,
      };
    },
  };
}

export function createUnavailableAuthStateStore() {
  return {
    backend: 'unavailable',
    async put() {
      throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
    },
    async consume() {
      return null;
    },
  };
}

function signRs256(privateKey, header, payload) {
  const encodedHeader = base64urlJson(header);
  const encodedPayload = base64urlJson(payload);
  const signer = createSign('RSA-SHA256');
  signer.update(`${encodedHeader}.${encodedPayload}`);
  signer.end();
  return `${encodedHeader}.${encodedPayload}.${signer.sign(privateKey, 'base64url')}`;
}

export function createOidcTestHarness({
  issuer = 'https://idp.test',
  clientId = 'researcher-client',
  clientSecret = 'researcher-secret',
  redirectUri = 'https://research.test/api/researcher/v1/session/callback',
  audience,
} = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', use: 'sig', alg: 'RS256' };
  const codes = new Map();
  const authorizationEndpoint = `${issuer}/authorize`;
  const tokenEndpoint = `${issuer}/token`;

  function issueIdToken(claims) {
    return signRs256(
      privateKey,
      { alg: 'RS256', kid: 'test-key', typ: 'JWT' },
      {
        iss: issuer,
        aud: audience || clientId,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        ...claims,
      }
    );
  }

  return {
    issuer,
    clientId,
    clientSecret,
    redirectUri,
    audience: audience || clientId,
    authorizationEndpoint,
    publicKey,
    issueIdToken,
    discovery: {
      issuer,
      authorization_endpoint: authorizationEndpoint,
      token_endpoint: tokenEndpoint,
      jwks_uri: `${issuer}/jwks`,
    },
    jwks: { keys: [jwk] },
    issueCode({
      sub,
      nonce,
      codeVerifier,
      acr = 'phr',
      amr = ['pwd', 'otp'],
      redirectUri: ru = redirectUri,
    }) {
      const code = randomBytes(24).toString('hex');
      codes.set(code, {
        sub,
        nonce,
        codeVerifier,
        acr,
        amr,
        redirectUri: ru,
        expiresAt: Date.now() + CODE_TTL_MS,
      });
      return code;
    },
    redeem({ code, codeVerifier, redirectUri: ru, clientId: cid, clientSecret: secret }) {
      const row = codes.get(code);
      codes.delete(code);
      if (!row || row.expiresAt <= Date.now()) return { ok: false, error: 'malformed' };
      if (row.codeVerifier !== codeVerifier || row.redirectUri !== ru) {
        return { ok: false, error: 'tampered' };
      }
      if (cid !== clientId || secret !== clientSecret) return { ok: false, error: 'tampered' };
      return {
        ok: true,
        idToken: issueIdToken({
          sub: row.sub,
          nonce: row.nonce,
          acr: row.acr,
          amr: row.amr,
        }),
      };
    },
    getKey(kid) {
      return !kid || kid === 'test-key' ? publicKey : null;
    },
  };
}

export function createOidcClient(config, { harness = null, authStates, fetchImpl = fetch } = {}) {
  const audience = config.oidcAudience || config.oidcClientId;

  async function discovery() {
    if (harness) return harness.discovery;
    const res = await fetchImpl(
      `${String(config.oidcIssuer).replace(/\/$/, '')}/.well-known/openid-configuration`,
      { method: 'GET', cache: 'no-store' }
    );
    if (!res.ok) throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
    return res.json();
  }

  async function getKey(kid, jwksUri) {
    if (harness) return harness.getKey(kid);
    const res = await fetchImpl(jwksUri, { method: 'GET', cache: 'no-store' });
    if (!res.ok) return null;
    const body = await res.json();
    const jwk = (body.keys || []).find((key) => key.kid === kid && key.kty === 'RSA');
    if (!jwk) return null;
    return createPublicKey({ key: jwk, format: 'jwk' });
  }

  return {
    harness,
    async authorizationRedirect() {
      const meta = await discovery();
      const state = randomBytes(24).toString('hex');
      const nonce = randomBytes(24).toString('hex');
      const transactionId = randomBytes(24).toString('hex');
      const { verifier, challenge } = pkcePair();
      await authStates.put({
        state,
        nonce,
        transactionId,
        codeVerifier: verifier,
        expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString(),
      });
      const url = new URL(meta.authorization_endpoint);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', config.oidcClientId);
      url.searchParams.set('redirect_uri', config.oidcRedirectUri);
      url.searchParams.set('scope', 'openid');
      url.searchParams.set('state', state);
      url.searchParams.set('nonce', nonce);
      url.searchParams.set('code_challenge', challenge);
      url.searchParams.set('code_challenge_method', 'S256');
      if (config.oidcRequiredAcr) url.searchParams.set('acr_values', config.oidcRequiredAcr);
      return { location: url.toString(), transactionId };
    },
    async completeCallback(query, { transactionId } = {}) {
      if (query.id_token || query.access_token || query.refresh_token) {
        return { ok: false, error: 'tampered' };
      }
      if (query.error) return { ok: false, error: 'malformed' };
      const state = String(query.state || '');
      const code = String(query.code || '');
      if (!/^[A-Za-z0-9_-]{8,256}$/.test(state) || !/^[A-Za-z0-9._-]{8,512}$/.test(code)) {
        return { ok: false, error: 'malformed' };
      }
      const pending = await authStates.consume(state, transactionId);
      if (!pending) return { ok: false, error: 'tampered' };

      let idToken;
      if (harness) {
        const redeemed = harness.redeem({
          code,
          codeVerifier: pending.codeVerifier,
          redirectUri: config.oidcRedirectUri,
          clientId: config.oidcClientId,
          clientSecret: config.oidcClientSecret,
        });
        if (!redeemed.ok) return redeemed;
        idToken = redeemed.idToken;
      } else {
        const meta = await discovery();
        const body = new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: config.oidcRedirectUri,
          client_id: config.oidcClientId,
          client_secret: config.oidcClientSecret,
          code_verifier: pending.codeVerifier,
        });
        const tokenRes = await fetchImpl(meta.token_endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        });
        if (!tokenRes.ok) return { ok: false, error: 'unavailable' };
        const tokens = await tokenRes.json();
        idToken = tokens.id_token;
      }

      const meta = harness ? harness.discovery : await discovery();
      const verified = await verifyIdToken(idToken, {
        issuer: config.oidcIssuer,
        audience,
        nonce: pending.nonce,
        getKey: (kid) => getKey(kid, meta.jwks_uri),
      });
      if (!verified.ok) return verified;
      if (!requiredMfaSatisfied(verified.claims, config)) {
        return { ok: false, error: 'forbidden', reason: 'mfa_required' };
      }
      return {
        ok: true,
        subject: verified.claims.sub,
        mfaOk: true,
      };
    },
    issueTestCallback(state, { sub, acr = 'phr', amr = ['pwd', 'otp'] }) {
      if (!harness || typeof authStates.peek !== 'function') throw new Error('test_only');
      return authStates.peek(state).then((pending) => {
        if (!pending || Date.parse(pending.expiresAt) <= Date.now()) return null;
        const code = harness.issueCode({
          sub,
          nonce: pending.nonce,
          codeVerifier: pending.codeVerifier,
          acr,
          amr,
          redirectUri: config.oidcRedirectUri,
        });
        return `${config.oidcRedirectUri}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;
      });
    },
  };
}
