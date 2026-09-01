import { randomBytes } from 'node:crypto';
import { authorize, sanitizeAuditDetail } from './authorize.mjs';
import { loadConfig } from './config.mjs';
import { ROLES } from './constants.mjs';
import { resolveResearchStore } from './data.mjs';
import { buildCsv, mapExportRow } from './csv.mjs';
import { resolveAuditSink } from './audit.mjs';
import {
  AUTH_TX_COOKIE,
  CSRF_COOKIE,
  OIDC_TX_COOKIE,
  SESSION_COOKIE,
  cookieHeader,
  csrfFromSession,
  csrfMatches,
  fail,
  json,
  parseCookies,
  securityHeaders,
  signSessionId,
  verifySignedSession,
} from './http.mjs';
import {
  createDatabaseAuthStateStore,
  createMemoryAuthStateStore,
  createUnavailableAuthStateStore,
} from './auth-state.mjs';
import {
  createSupabaseAuthClient,
  decodePendingNonce,
  decryptSecret,
  encryptSecret,
  encodePendingNonce,
  requiredMfaSatisfied,
} from './supabase-auth.mjs';
import {
  compactAuthDiagnostic,
  logLoginUnavailable,
  classifyLoginUnavailable,
} from './auth-diagnostic.mjs';
import { isDbDiagnosticAllowed, logDiagnosticFailure, runDbDiagnostic } from './db-diagnostic.mjs';
import { resolveQueryAdapter } from './query.mjs';
import { RATE_CATEGORIES, clientRateKey, resolveRateLimiter } from './rate-limit.mjs';
import { resolveSessionStore } from './sessions.mjs';
import { parseDeletionBody, parseExportBody, parseFilters, parseParticipantRef } from './validate.mjs';

function readBody(request) {
  if (request.body == null || request.body === '') return {};
  if (typeof request.body === 'object') return request.body;
  try {
    return JSON.parse(request.body);
  } catch {
    return Symbol.for('invalid_json');
  }
}

function pathOf(request) {
  const url = new URL(request.url, 'http://researcher.invalid');
  let path = url.pathname.replace(/\/$/, '') || '/';
  if (path.startsWith('/api/researcher')) {
    path = path.slice('/api/researcher'.length) || '/';
  }
  return path;
}

function queryOf(request) {
  const url = new URL(request.url, 'http://researcher.invalid');
  return Object.fromEntries(url.searchParams.entries());
}

function setSessionCookies(headers, { signed, csrf, maxAgeSeconds }) {
  headers['Set-Cookie'] = [
    cookieHeader(SESSION_COOKIE, signed, { maxAgeSeconds, httpOnly: true }),
    cookieHeader(CSRF_COOKIE, csrf, { maxAgeSeconds, httpOnly: false }),
  ];
}

function clearSessionCookies(headers) {
  headers['Set-Cookie'] = [
    cookieHeader(SESSION_COOKIE, '', { maxAgeSeconds: 0, httpOnly: true }),
    cookieHeader(CSRF_COOKIE, '', { maxAgeSeconds: 0, httpOnly: false }),
    cookieHeader(AUTH_TX_COOKIE, '', { maxAgeSeconds: 0, httpOnly: true }),
    cookieHeader(OIDC_TX_COOKIE, '', { maxAgeSeconds: 0, httpOnly: true, sameSite: 'Lax' }),
  ];
}

function requestIdOf(request) {
  return `req_${randomBytes(12).toString('hex')}`;
}

function withRequestId(response, requestId) {
  response.headers = { ...response.headers, 'X-Request-Id': requestId };
  return response;
}

export function createResearcherApp(overrides = {}) {
  const config = { ...loadConfig(), ...overrides.config };
  const isolated = overrides.allowMemoryStores === true;
  const query = resolveQueryAdapter(config, { ...overrides, allowMemoryStores: isolated });
  const sessions = resolveSessionStore(config, { ...overrides, query, allowMemoryStores: isolated });
  const limiter = resolveRateLimiter(config, { ...overrides, query, allowMemoryStores: isolated });
  const store = resolveResearchStore(config, {
    ...overrides,
    query,
    allowMemoryStores: isolated,
  });
  const directory = overrides.directory || new Map();
  const records = overrides.records || [];
  const { sink: auditSink, log: auditLog } = resolveAuditSink(config, {
    ...overrides,
    query,
    allowMemoryStores: isolated,
  });
  const authStates =
    overrides.authStates ||
    (isolated
      ? createMemoryAuthStateStore()
      : query && config.sessionStore === 'database'
        ? createDatabaseAuthStateStore(query)
        : createUnavailableAuthStateStore());
  const auth =
    overrides.auth ||
    (overrides.authHarness && isolated
      ? createSupabaseAuthClient(config, { harness: overrides.authHarness })
      : !isolated && config.authReady && authStates.backend !== 'unavailable'
        ? createSupabaseAuthClient(config)
        : null);
  const runtimeStoresReady =
    isolated ||
    (Boolean(query) &&
      sessions.backend === 'database' &&
      limiter.backend === 'database' &&
      authStates.backend === 'database');

  async function lookupResearcher(subject) {
    if (directory.has(subject)) return directory.get(subject);
    return store.lookupResearcher(subject);
  }

  async function countActiveResearchers() {
    if (directory.size > 0) {
      let n = 0;
      for (const row of directory.values()) {
        if (!row?.revokedAt && !row?.disabledAt && ROLES.includes(row.role)) n += 1;
      }
      return n;
    }
    if (typeof store.countActiveResearchers === 'function') {
      return store.countActiveResearchers();
    }
    return 0;
  }

  async function currentIdentity(request) {
    if (!config.sessionSecret) return null;
    const cookies = parseCookies(request.headers?.cookie || request.headers?.Cookie);
    const sessionId = verifySignedSession(cookies[SESSION_COOKIE], config.sessionSecret);
    if (!sessionId) return null;
    if (typeof sessions.cleanupExpired === 'function') {
      await sessions.cleanupExpired();
    }
    const session = await sessions.get(sessionId);
    if (!session) return null;
    const researcher = await lookupResearcher(session.authSubject);
    if (!researcher) return null;
    if (researcher.revokedAt || researcher.disabledAt) return null;
    return {
      sessionId,
      authSubject: session.authSubject,
      role: researcher.role,
      mfaOk: session.mfaOk === true && researcher.mfaRequired !== false,
      revokedAt: researcher.revokedAt || null,
      disabledAt: researcher.disabledAt || null,
      expiresAt: session.expiresAt,
    };
  }

  function requireCsrf(request, identity) {
    const expected = csrfFromSession(identity.sessionId, config.sessionSecret);
    const provided =
      request.headers?.['x-csrf-token'] || request.headers?.['X-CSRF-Token'] || '';
    return csrfMatches(provided, expected);
  }

  async function writeAudit(identity, action, detail, requestId, request) {
    const event = {
      occurred_at: new Date().toISOString(),
      actor_id: identity?.authSubject || 'anonymous',
      actor_role: identity?.role || null,
      action,
      request_id: requestId || null,
      participant_reference: detail?.participant_reference || null,
      detail: sanitizeAuditDetail(detail),
      researcher_ip: config.auditStoreResearcherIp ? clientRateKey(request || {}, config) : undefined,
    };
    if (auditSink.backend === 'memory') {
      await auditSink.write(event);
      return;
    }
    auditLog.push(event);
    if (auditSink.backend === 'database') {
      try {
        await auditSink.write(event);
      } catch {
        if (['view_record', 'view_qualitative', 'login'].includes(action)) {
          throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
        }
      }
    }
  }

  async function establishSession(authSubject, { mfaOk, previousSessionId }) {
    const expiresAt = new Date(Date.now() + config.sessionMinutes * 60 * 1000).toISOString();
    const sessionId = await sessions.rotate(previousSessionId, {
      authSubject,
      mfaOk: mfaOk === true,
      expiresAt,
    });
    const signed = signSessionId(sessionId, config.sessionSecret);
    const csrf = csrfFromSession(sessionId, config.sessionSecret);
    const headers = { ...securityHeaders() };
    setSessionCookies(headers, {
      signed,
      csrf,
      maxAgeSeconds: config.sessionMinutes * 60,
    });
    return { sessionId, signed, csrf, headers, expiresAt };
  }

  function authUsable() {
    return (
      Boolean(auth) &&
      Boolean(config.sessionSecret) &&
      runtimeStoresReady &&
      (config.authReady || isolated)
    );
  }

  function loginUnavailableClass() {
    return classifyLoginUnavailable({
      config,
      auth,
      runtimeStoresReady,
      limiter,
      sessions,
      authStates,
      isolated,
    });
  }

  function setAuthTxCookie(headers, transactionId) {
    const signed = signSessionId(transactionId, config.sessionSecret);
    const cookie = cookieHeader(AUTH_TX_COOKIE, signed, {
      maxAgeSeconds: 300,
      httpOnly: true,
    });
    headers['Set-Cookie'] = [].concat(headers['Set-Cookie'] || [], cookie);
  }

  function clearAuthTxCookie(headers) {
    const cookie = cookieHeader(AUTH_TX_COOKIE, '', {
      maxAgeSeconds: 0,
      httpOnly: true,
    });
    headers['Set-Cookie'] = [].concat(headers['Set-Cookie'] || [], cookie);
  }

  async function denyLogin(reason, requestId, request, subject = null, role = null) {
    await writeAudit(
      subject ? { authSubject: subject, role } : null,
      'login_failure',
      { reason },
      requestId,
      request
    );
    const code =
      reason === 'unavailable' || reason === 'idp_not_configured' || reason === 'session_store'
        ? 'unavailable'
        : reason === 'disabled' ||
            reason === 'revoked' ||
            reason === 'unknown' ||
            reason === 'directory_invariant' ||
            reason === 'mfa_required' ||
            reason === 'role'
          ? 'forbidden'
          : reason === 'rate_limited'
            ? 'rate_limited'
            : 'unauthorized';
    return fail(code);
  }

  async function completeAuthorisedLogin(subject, { previousSessionId, requestId, request }) {
    const researcher = await lookupResearcher(subject);
    if (!researcher || !researcher.role) {
      return { ok: false, response: await denyLogin('unknown', requestId, request, subject) };
    }
    if (researcher.revokedAt) {
      return {
        ok: false,
        response: await denyLogin('revoked', requestId, request, subject, researcher.role),
      };
    }
    if (researcher.disabledAt) {
      return {
        ok: false,
        response: await denyLogin('disabled', requestId, request, subject, researcher.role),
      };
    }
    const activeCount = await countActiveResearchers();
    if (activeCount !== 1) {
      return {
        ok: false,
        response: await denyLogin('directory_invariant', requestId, request, subject, researcher.role),
      };
    }
    if (!authorize({ ...researcher, mfaOk: true, authSubject: subject }, 'summary').ok) {
      return {
        ok: false,
        response: await denyLogin('role', requestId, request, subject, researcher.role),
      };
    }
    let established;
    try {
      established = await establishSession(subject, {
        mfaOk: true,
        previousSessionId,
      });
    } catch {
      return {
        ok: false,
        response: await denyLogin('session_store', requestId, request, subject, researcher.role),
      };
    }
    await writeAudit(
      { authSubject: subject, role: researcher.role },
      'login',
      { outcome: 'ok' },
      requestId,
      request
    );
    clearAuthTxCookie(established.headers);
    return {
      ok: true,
      response: json(
        200,
        {
          authenticated: true,
          mfaRequired: false,
          role: researcher.role,
          expiresAt: established.expiresAt,
          csrfToken: established.csrf,
        },
        established.headers
      ),
    };
  }

  async function startMfaTicket({ subject, accessToken, factorId, enrollmentRequired, qr }) {
    const state = randomBytes(24).toString('hex');
    const transactionId = randomBytes(24).toString('hex');
    await authStates.put({
      state,
      nonce: encodePendingNonce(subject, factorId),
      codeVerifier: encryptSecret(accessToken, config.sessionSecret),
      transactionId,
      expiresAt: new Date(Date.now() + (auth.ticketTtlMs || 300000)).toISOString(),
    });
    const res = json(200, {
      authenticated: false,
      mfaRequired: true,
      enrollmentRequired: Boolean(enrollmentRequired),
      ticket: state,
      qr: qr || undefined,
    });
    setAuthTxCookie(res.headers, transactionId);
    return res;
  }

  async function readPendingTicket(request, ticket) {
    const cookies = parseCookies(request.headers?.cookie || request.headers?.Cookie);
    const transactionId = verifySignedSession(cookies[AUTH_TX_COOKIE], config.sessionSecret);
    if (!transactionId || !/^[a-f0-9]{16,128}$/i.test(String(ticket || ''))) return null;
    return { ticket: String(ticket), transactionId };
  }

  async function handle(request) {
    const method = String(request.method || 'GET').toUpperCase();
    const path = pathOf(request);
    const requestId = requestIdOf(request);
    const ipKey = clientRateKey(request, config);
    const respond = (response) => withRequestId(response, requestId);

    if (path === '/health' && method === 'GET') {
      return respond(json(200, { ok: true }));
    }

    if (path === '/diagnostics/db' && method === 'GET') {
      if (!isDbDiagnosticAllowed(config)) {
        return respond(fail('unavailable'));
      }
      if (!query || !config.databaseUrl) {
        logDiagnosticFailure({ stage: 'connect', category: 'connection_failed' });
        return respond(fail('unavailable'));
      }
      try {
        const check = await runDbDiagnostic(query);
        if (!check.ok) {
          logDiagnosticFailure({ stage: check.stage, category: check.category });
          return respond(json(503, { ok: false }));
        }
        return respond(json(200, check.result));
      } catch {
        logDiagnosticFailure({ stage: 'connect', category: 'query_failed' });
        return respond(json(503, { ok: false }));
      }
    }

    if (path === '/diagnostics/auth' && method === 'GET') {
      if (!isDbDiagnosticAllowed(config)) {
        return respond(fail('unavailable'));
      }
      return respond(
        json(
          200,
          compactAuthDiagnostic({
            config,
            auth,
            runtimeStoresReady,
            limiter,
            sessions,
            authStates,
            isolated,
          })
        )
      );
    }

    if ((!runtimeStoresReady || limiter.backend === 'unavailable') && !isolated) {
      if (path === '/v1/session/login' && method === 'POST') {
        logLoginUnavailable(loginUnavailableClass());
      }
      return respond(fail('unavailable'));
    }

    if (path === '/v1/session/login' && method === 'POST') {
      if (!(await limiter.allow(RATE_CATEGORIES.login, ipKey))) return respond(fail('rate_limited'));
      if (!authUsable()) {
        logLoginUnavailable(loginUnavailableClass());
        await writeAudit(null, 'login_failure', { reason: 'idp_not_configured' }, requestId);
        return respond(fail('unavailable'));
      }
      const body = readBody(request);
      if (body === Symbol.for('invalid_json')) return respond(fail('invalid_request'));
      const email = String(body?.email || '').trim();
      const password = String(body?.password || '');
      if (!email || !password || email.length > 320 || password.length > 256) {
        return respond(await denyLogin('unauthorized', requestId, request));
      }
      let granted;
      try {
        granted = await auth.passwordGrant(email, password);
      } catch {
        logLoginUnavailable({ stage: 'password_exchange', category: 'exchange_threw' });
        return respond(await denyLogin('unavailable', requestId, request));
      }
      if (!granted?.ok) {
        if (granted?.error === 'unavailable' || granted?.error === 'session_store') {
          logLoginUnavailable(
            granted.diagnostic || { stage: 'token_verify', category: 'get_claims_rejected' }
          );
        }
        return respond(await denyLogin(granted?.error || 'unauthorized', requestId, request));
      }
      if (requiredMfaSatisfied(granted.claims)) {
        const previous = await currentIdentity(request);
        const finished = await completeAuthorisedLogin(granted.claims.sub, {
          previousSessionId: previous?.sessionId,
          requestId,
          request,
        });
        return respond(finished.response);
      }
      let listed;
      try {
        listed = await auth.listVerifiedTotpFactors(granted.accessToken);
      } catch {
        logLoginUnavailable({ stage: 'factor_list', category: 'list_threw' });
        return respond(await denyLogin('unavailable', requestId, request));
      }
      if (!listed.ok) {
        if (listed.error === 'unavailable' || listed.error === 'session_store') {
          logLoginUnavailable(
            listed.diagnostic || { stage: 'factor_list', category: 'list_unavailable' }
          );
        }
        return respond(await denyLogin(listed.error || 'unavailable', requestId, request));
      }
      if (listed.factors.length) {
        try {
          return respond(
            await startMfaTicket({
              subject: granted.claims.sub,
              accessToken: granted.accessToken,
              factorId: listed.factors[0].id,
              enrollmentRequired: false,
            })
          );
        } catch {
          logLoginUnavailable({ stage: 'factor_list', category: 'ticket_threw' });
          return respond(await denyLogin('unavailable', requestId, request));
        }
      }
      let enrolled;
      try {
        enrolled = await auth.enrollTotp(granted.accessToken);
      } catch {
        logLoginUnavailable({ stage: 'totp_enroll', category: 'enroll_threw' });
        return respond(await denyLogin('unavailable', requestId, request));
      }
      if (!enrolled.ok) {
        if (enrolled.error === 'unavailable' || enrolled.error === 'session_store') {
          logLoginUnavailable(
            enrolled.diagnostic || { stage: 'totp_enroll', category: 'enroll_unavailable' }
          );
        }
        return respond(await denyLogin(enrolled.error || 'unavailable', requestId, request));
      }
      try {
        return respond(
          await startMfaTicket({
            subject: granted.claims.sub,
            accessToken: granted.accessToken,
            factorId: enrolled.factorId,
            enrollmentRequired: true,
            qr: enrolled.qr,
          })
        );
      } catch {
        logLoginUnavailable({ stage: 'totp_enroll', category: 'ticket_threw' });
        return respond(await denyLogin('unavailable', requestId, request));
      }
    }

    if (path === '/v1/session/mfa' && method === 'POST') {
      if (!(await limiter.allow(RATE_CATEGORIES.login, ipKey))) return respond(fail('rate_limited'));
      if (!authUsable()) {
        logLoginUnavailable(loginUnavailableClass());
        return respond(fail('unavailable'));
      }
      const body = readBody(request);
      if (body === Symbol.for('invalid_json')) return respond(fail('invalid_request'));
      const pendingIds = await readPendingTicket(request, body?.ticket);
      if (!pendingIds) {
        return respond(await denyLogin('tampered', requestId, request));
      }
      const pending = await authStates.peek(pendingIds.ticket);
      if (!pending || pending.transactionId !== pendingIds.transactionId) {
        return respond(await denyLogin('tampered', requestId, request));
      }
      const accessToken = decryptSecret(pending.codeVerifier, config.sessionSecret);
      const { subject, factorId } = decodePendingNonce(pending.nonce);
      if (!accessToken || !subject || !factorId) {
        return respond(await denyLogin('tampered', requestId, request));
      }
      let verified;
      try {
        verified = await auth.verifyTotp(accessToken, factorId, body?.code);
      } catch {
        return respond(await denyLogin('unavailable', requestId, request));
      }
      if (!verified?.ok || !requiredMfaSatisfied(verified.claims) || verified.claims.sub !== subject) {
        return respond(await denyLogin(verified?.error || 'unauthorized', requestId, request));
      }
      const consumed = await authStates.consume(pendingIds.ticket, pendingIds.transactionId);
      if (!consumed) return respond(await denyLogin('tampered', requestId, request));
      const previous = await currentIdentity(request);
      const finished = await completeAuthorisedLogin(verified.claims.sub, {
        previousSessionId: previous?.sessionId,
        requestId,
        request,
      });
      return respond(finished.response);
    }

    if (path === '/v1/session' && method === 'GET') {
      const identity = await currentIdentity(request);
      if (!identity || !authorize(identity, 'summary').ok) {
        return respond(json(200, { authenticated: false }));
      }
      return respond(
        json(200, {
          authenticated: true,
          role: identity.role,
          expiresAt: identity.expiresAt,
          csrfToken: csrfFromSession(identity.sessionId, config.sessionSecret),
        })
      );
    }

    if (path === '/v1/session/logout' && method === 'POST') {
      const identity = await currentIdentity(request);
      if (identity) {
        if (!requireCsrf(request, identity)) return respond(fail('forbidden'));
        await sessions.revoke(identity.sessionId);
        await writeAudit(identity, 'logout', { outcome: 'ok' }, requestId);
      }
      const res = json(200, { ok: true });
      clearSessionCookies(res.headers);
      return respond(res);
    }

    const identity = await currentIdentity(request);
    if (!config.dataReady) return respond(fail('unavailable'));
    if (!identity) return respond(fail('unauthorized'));
    const authz = authorize(identity, 'summary');
    if (!authz.ok) {
      await writeAudit(identity, 'authz_failure', { reason: authz.error }, requestId);
      return respond(fail(authz.error));
    }

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !requireCsrf(request, identity)) {
      return respond(fail('forbidden'));
    }

    if (!(await limiter.allow(RATE_CATEGORIES.api, ipKey))) return respond(fail('rate_limited'));

    if (path === '/v1/summary' && method === 'GET') {
      const parsed = parseFilters(queryOf(request));
      if (!parsed.ok) return respond(fail(parsed.error));
      try {
        return respond(json(200, await store.summary(parsed.filters)));
      } catch {
        return respond(fail('unavailable'));
      }
    }

    if (path === '/v1/responses' && method === 'GET') {
      const parsed = parseFilters(queryOf(request));
      if (!parsed.ok) return respond(fail(parsed.error));
      if (parsed.filters.includeQualitative) return respond(fail('invalid_request'));
      try {
        return respond(json(200, await store.list(parsed.filters)));
      } catch {
        return respond(fail('unavailable'));
      }
    }

    const recordMatch = path.match(/^\/v1\/responses\/([^/]+)(\/qualitative)?$/);
    if (recordMatch && method === 'GET') {
      const reference = parseParticipantRef(decodeURIComponent(recordMatch[1]));
      if (!reference) return respond(fail('invalid_request'));
      const qualitative = Boolean(recordMatch[2]);
      const category = qualitative ? RATE_CATEGORIES.qualitative : RATE_CATEGORIES.record;
      if (!(await limiter.allow(category, ipKey))) return respond(fail('rate_limited'));
      const needed = authorize(identity, qualitative ? 'view_qualitative' : 'view_record');
      if (!needed.ok) {
        await writeAudit(identity, 'authz_failure', { reason: needed.error, participant_reference: reference }, requestId);
        return respond(fail(needed.error));
      }
      await writeAudit(identity, qualitative ? 'view_qualitative' : 'view_record', {
        participant_reference: reference,
        outcome: 'ok',
      }, requestId);
      const row = qualitative
        ? await store.getQualitative(reference)
        : await store.getByReference(reference);
      if (!row) return respond(fail('not_found'));
      return respond(json(200, row));
    }

    if (path === '/v1/exports' && method === 'POST') {
      const needed = authorize(identity, 'export');
      if (!needed.ok) {
        await writeAudit(identity, 'authz_failure', { reason: needed.error }, requestId);
        return respond(fail(needed.error));
      }
      if (!config.exportsEnabled) return respond(fail('unavailable'));
      const body = readBody(request);
      if (body === Symbol.for('invalid_json')) return respond(fail('invalid_request'));
      const parsed = parseExportBody(body, config.maxExportRows);
      if (!parsed.ok) return respond(fail(parsed.error));
      const exported = await store.exportRows(parsed.filters, config.maxExportRows);
      if (!exported.ok) return respond(fail(exported.error));
      await writeAudit(identity, 'export', {
        count: exported.rows.length,
        scope: 'approved_export_schema',
      }, requestId);
      return respond({
        status: 200,
        headers: {
          ...securityHeaders(),
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="inquiry-archive-export.csv"',
        },
        body: buildCsv(exported.rows.map((row) => mapExportRow(row))),
      });
    }

    if (path === '/v1/deletions' && method === 'POST') {
      const needed = authorize(identity, 'delete');
      if (!needed.ok) {
        await writeAudit(identity, 'authz_failure', { reason: needed.error }, requestId);
        return respond(fail(needed.error));
      }
      if (!config.deletionsEnabled) return respond(fail('unavailable'));
      const body = readBody(request);
      if (body === Symbol.for('invalid_json')) return respond(fail('invalid_request'));
      const parsed = parseDeletionBody(body);
      if (!parsed.ok) return respond(fail(parsed.error));
      const result = await store.deleteByReference(parsed.reference);
      await writeAudit(identity, 'delete', {
        participant_reference: parsed.reference,
        legal_hold: Boolean(result.legal_hold),
        deleted: Boolean(result.deleted),
      }, requestId);
      return respond(json(200, { ok: true }));
    }

    return respond(fail('not_found'));
  }

  return {
    handle,
    config,
    sessions,
    directory,
    records,
    auditLog,
    store,
    auth,
    signInForTests: async (subject, { role = 'authorised_researcher', minutes, disabledAt = null, revokedAt = null } = {}) => {
      if (!isolated) {
        throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
      }
      const expiresAt = new Date(
        Date.now() + (minutes || config.sessionMinutes) * 60 * 1000
      ).toISOString();
      directory.set(subject, { role, mfaRequired: true, revokedAt, disabledAt });
      const sessionId = await sessions.create({
        authSubject: subject,
        mfaOk: true,
        expiresAt,
      });
      const signed = signSessionId(sessionId, config.sessionSecret);
      const csrf = csrfFromSession(sessionId, config.sessionSecret);
      return { sessionId, signed, csrf, cookie: `${SESSION_COOKIE}=${signed}` };
    },
  };
}

export { CSRF_COOKIE, SESSION_COOKIE };
