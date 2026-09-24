/**
 * Test-only Auth harness. Issues ES256/HS256 tokens with jose.
 * Production verification uses supabase.auth.getClaims(), not this file.
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import { supabaseIssuer } from '../../api/researcher/_lib/supabase-auth.mjs';

const AUTH_AUD = 'authenticated';

function parsePayload(token) {
  try {
    const [, raw] = String(token).split('.');
    return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function createSupabaseAuthTestHarness({
  url = 'https://test-project.supabase.co',
  publishableKey = 'sb_publishable_test_not_a_jwt',
  audience = AUTH_AUD,
  hs256Secret = 'legacy-hs256-secret-not-used-in-production',
} = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const kid = 'test-es256';
  const jwk = {
    ...publicKey.export({ format: 'jwk' }),
    kid,
    use: 'sig',
    alg: 'ES256',
  };
  const users = new Map();
  const factors = new Map();
  const issued = new Set();

  function payloadOf({ sub, aal = 'aal1', exp, email, role = AUTH_AUD, amr: amrOverride }) {
    const now = Math.floor(Date.now() / 1000);
    const amr =
      amrOverride ||
      (aal === 'aal2'
        ? [
            { method: 'password', timestamp: now },
            { method: 'totp', timestamp: now },
          ]
        : [{ method: 'password', timestamp: now }]);
    return {
      iss: supabaseIssuer(url),
      aud: audience,
      sub,
      email,
      role,
      aal,
      amr,
      iat: now,
      exp: exp ?? now + 3600,
    };
  }

  async function issueAccessToken(claims, { alg = 'ES256', kid: tokenKid = kid } = {}) {
    const payload = payloadOf(claims);
    const token =
      alg === 'HS256'
        ? await new SignJWT(payload)
            .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
            .sign(new TextEncoder().encode(hs256Secret))
        : await new SignJWT(payload)
            .setProtectedHeader({ alg: 'ES256', kid: tokenKid, typ: 'JWT' })
            .sign(privateKey);
    issued.add(token);
    return token;
  }

  return {
    url,
    publishableKey,
    audience,
    kid,
    hs256Secret,
    jwks: { keys: [jwk] },
    issueAccessToken,
    async fetchUser(token) {
      if (!issued.has(token)) return { ok: false };
      const payload = parsePayload(token);
      if (!payload?.sub) return { ok: false };
      return { ok: true, id: payload.sub };
    },
    addUser({
      email,
      password,
      sub,
      aal = 'aal1',
      totpCode = '123456',
      enrolled = true,
      disabled = false,
    }) {
      const factorId = enrolled ? randomBytes(8).toString('hex') : '';
      users.set(email.toLowerCase(), {
        email: email.toLowerCase(),
        password,
        sub,
        aal,
        totpCode,
        enrolled,
        disabled,
        factorId,
      });
      if (enrolled && factorId) {
        factors.set(factorId, { email: email.toLowerCase(), totpCode, verified: true });
      }
      return { factorId };
    },
    async passwordGrant(email, password) {
      const row = users.get(String(email || '').toLowerCase());
      if (!row || row.disabled || row.password !== password) {
        return { ok: false, error: 'unauthorized' };
      }
      const accessToken = await issueAccessToken({ sub: row.sub, aal: row.aal, email: row.email });
      return { ok: true, accessToken };
    },
    listFactors(email) {
      const row = users.get(String(email || '').toLowerCase());
      if (!row?.enrolled || !row.factorId) {
        return { totp: [], all: [], factors: [] };
      }
      const factor = { id: row.factorId, factor_type: 'totp', status: 'verified' };
      return { totp: [factor], all: [factor], factors: [factor] };
    },
    enroll(email) {
      const row = users.get(String(email || '').toLowerCase());
      if (!row) return { ok: false, error: 'unauthorized' };
      const factorId = randomBytes(8).toString('hex');
      row.enrolled = true;
      row.factorId = factorId;
      factors.set(factorId, { email: row.email, totpCode: row.totpCode, verified: false });
      return {
        ok: true,
        factorId,
        qr: 'data:image/png;base64,AAAA',
      };
    },
    async verifyFactor(factorId, code) {
      const factor = factors.get(factorId);
      if (!factor || factor.totpCode !== String(code || '')) {
        return { ok: false, error: 'unauthorized' };
      }
      const row = users.get(factor.email);
      if (!row) return { ok: false, error: 'unauthorized' };
      factor.verified = true;
      row.aal = 'aal2';
      const accessToken = await issueAccessToken({ sub: row.sub, aal: 'aal2', email: row.email });
      return { ok: true, accessToken };
    },
  };
}
