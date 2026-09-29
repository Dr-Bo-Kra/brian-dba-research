import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSupabaseAuthClient,
  decodeTicketSecrets,
  encodeTicketSecrets,
  normalizeFactorList,
} from '../api/researcher/_lib/supabase-auth.mjs';
import { createSupabaseAuthTestHarness } from './helpers/supabase-auth-harness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const authSrc = readFileSync(join(root, 'api/researcher/_lib/supabase-auth.mjs'), 'utf8');

const REFRESH = 'refresh-token-must-not-log';
const SUBJECT = 'subject-sdk-1';
const harness = createSupabaseAuthTestHarness();

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sdkUser(factors) {
  return {
    id: SUBJECT,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'researcher@example.test',
    factors,
  };
}

async function sdkAuth(makeFetch) {
  const accessToken = await harness.issueAccessToken({
    sub: SUBJECT,
    aal: 'aal1',
    email: 'researcher@example.test',
  });
  const config = {
    supabaseUrl: harness.url,
    supabasePublishableKey: harness.publishableKey,
    supabaseJwtAudience: harness.audience,
  };
  const auth = createSupabaseAuthClient(config, {
    fetchImpl: (url, init) => makeFetch(url, init),
  });
  return { accessToken, auth, config };
}

test('listFactors uses getUser factors, not a manual GET /factors', () => {
  assert.match(authSrc, /mfa\.listFactors\(/);
  assert.match(authSrc, /mfa\.enroll\(/);
  assert.match(authSrc, /mfa\.challenge\(/);
  assert.match(authSrc, /mfa\.verify\(/);
  assert.match(authSrc, /setSession\(/);
  assert.doesNotMatch(authSrc, /gotrue\('\/factors'/);
});

test('normalizeFactorList accepts official SDK listFactors bags', () => {
  const listed = normalizeFactorList({
    all: [
      { id: 'totp-verified', factor_type: 'totp', status: 'verified' },
      { id: 'totp-unverified', factor_type: 'totp', status: 'unverified' },
      { id: 'phone-verified', factor_type: 'phone', status: 'verified' },
    ],
    totp: [{ id: 'totp-verified', factor_type: 'totp', status: 'verified' }],
    phone: [{ id: 'phone-verified', factor_type: 'phone', status: 'verified' }],
    webauthn: [],
  });
  assert.deepEqual(listed, [{ id: 'totp-verified' }]);
});

test('SDK listFactors returns only verified TOTP and never GETs /factors', async () => {
  const paths = [];
  const { auth, accessToken } = await sdkAuth(async (url) => {
    const target = String(url);
    paths.push(target);
    if (target.includes('jwks.json')) {
      return jsonResponse(harness.jwks);
    }
    if (target.includes('/auth/v1/user')) {
      return jsonResponse(
        sdkUser([
          { id: 'totp-verified', factor_type: 'totp', status: 'verified' },
          { id: 'totp-unverified', factor_type: 'totp', status: 'unverified' },
          { id: 'phone-verified', factor_type: 'phone', status: 'verified' },
        ])
      );
    }
    return jsonResponse({ message: 'unexpected' }, 404);
  });

  const listed = await auth.listVerifiedTotpFactors(accessToken, REFRESH);
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.factors, [{ id: 'totp-verified' }]);
  assert.equal(paths.some((url) => /\/factors(?:\?|$)/.test(url) && !url.includes('/challenge')), false);
  assert.ok(paths.some((url) => url.includes('/auth/v1/user')));
  assert.doesNotMatch(JSON.stringify(listed), /refresh-token-must-not-log/);
});

test('SDK enroll uses official totp shape and prefixes QR', async () => {
  const { accessToken, auth } = await sdkAuth(async (url, init) => {
    const target = String(url);
    const method = String(init?.method || 'GET').toUpperCase();
    if (target.includes('jwks.json')) return jsonResponse(harness.jwks);
    if (target.includes('/auth/v1/user')) return jsonResponse(sdkUser([]));
    if (target.includes('/auth/v1/factors') && method === 'POST' && !target.includes('/challenge')) {
      return jsonResponse({
        id: 'enrolled-factor',
        type: 'totp',
        totp: {
          qr_code: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
          secret: 'must-not-return-to-logs',
          uri: 'otpauth://totp/must-not-log',
        },
      });
    }
    return jsonResponse({}, 404);
  });

  const enrolled = await auth.enrollTotp(accessToken, REFRESH);
  assert.equal(enrolled.ok, true);
  assert.equal(enrolled.factorId, 'enrolled-factor');
  assert.match(enrolled.qr, /^data:image\/svg\+xml/);
  assert.doesNotMatch(JSON.stringify(enrolled), /otpauth:/);
  assert.doesNotMatch(JSON.stringify(enrolled), /must-not-return-to-logs/);
  assert.doesNotMatch(JSON.stringify(enrolled), /refresh-token-must-not-log/);
});

test('SDK challenge and verify use official session tokens then getClaims', async () => {
  const aal1 = await harness.issueAccessToken({
    sub: SUBJECT,
    aal: 'aal1',
    email: 'researcher@example.test',
  });
  const aal2 = await harness.issueAccessToken({
    sub: SUBJECT,
    aal: 'aal2',
    email: 'researcher@example.test',
  });
  const auth = createSupabaseAuthClient(
    {
      supabaseUrl: harness.url,
      supabasePublishableKey: harness.publishableKey,
      supabaseJwtAudience: harness.audience,
    },
    {
      fetchImpl: async (url, init) => {
        const target = String(url);
        const method = String(init?.method || 'GET').toUpperCase();
        if (target.includes('jwks.json')) return jsonResponse(harness.jwks);
        if (target.includes('/auth/v1/user')) return jsonResponse(sdkUser([]));
        if (target.includes('/challenge') && method === 'POST') {
          return jsonResponse({ id: 'challenge-1', type: 'totp', expires_at: Date.now() + 60_000 });
        }
        if (target.includes('/verify') && method === 'POST') {
          return jsonResponse({
            access_token: aal2,
            refresh_token: REFRESH,
            token_type: 'bearer',
            expires_in: 3600,
            user: sdkUser([]),
          });
        }
        return jsonResponse({}, 404);
      },
    }
  );

  const verified = await auth.verifyTotp(aal1, 'factor-1', '123456', REFRESH);
  assert.equal(verified.ok, true);
  assert.equal(verified.claims.sub, SUBJECT);
  assert.equal(verified.claims.aal, 'aal2');
  assert.doesNotMatch(JSON.stringify({ ok: verified.ok, aal: verified.claims.aal }), /refresh-token-must-not-log/);
});

test('ticket secrets stay server-side and accept legacy access-token blobs', () => {
  const packed = encodeTicketSecrets({ accessToken: 'access-aaa', refreshToken: REFRESH });
  const decoded = decodeTicketSecrets(packed);
  assert.equal(decoded.accessToken, 'access-aaa');
  assert.equal(decoded.refreshToken, REFRESH);
  assert.deepEqual(decodeTicketSecrets('legacy-access-only'), {
    accessToken: 'legacy-access-only',
    refreshToken: '',
  });
  assert.doesNotMatch(packed, /accessToken/);
  assert.doesNotMatch(packed, /refreshToken/);
});
