import { randomBytes } from 'node:crypto';
import { authorize, sanitizeAuditDetail } from './authorize.mjs';
import { loadConfig } from './config.mjs';
import { resolveResearchStore } from './data.mjs';
import { buildCsv, mapExportRow } from './csv.mjs';
import { resolveAuditSink } from './audit.mjs';
import {
  CSRF_COOKIE,
  OIDC_TX_COOKIE,
  SESSION_COOKIE,
  cookieHeader,
  csrfFromSession,
  csrfMatches,
  fail,
  json,
  parseCookies,
  redirect,
  securityHeaders,
  signSessionId,
  verifySignedSession,
} from './http.mjs';
import {
  createDatabaseAuthStateStore,
  createMemoryAuthStateStore,
  createOidcClient,
  createUnavailableAuthStateStore,
} from './oidc.mjs';
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
  const oidc =
    overrides.oidc ||
    (overrides.oidcHarness && isolated
      ? createOidcClient(config, { harness: overrides.oidcHarness, authStates })
      : config.authReady && authStates.backend !== 'unavailable'
        ? createOidcClient(config, { authStates })
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

  function oidcUsable() {
    return (
      Boolean(oidc) &&
      Boolean(config.sessionSecret) &&
      runtimeStoresReady &&
      (config.authReady || isolated)
    );
  }

  function setOidcTxCookie(headers, transactionId) {
    const signed = signSessionId(transactionId, config.sessionSecret);
    const cookie = cookieHeader(OIDC_TX_COOKIE, signed, {
      maxAgeSeconds: 300,
      httpOnly: true,
      sameSite: 'Lax',
    });
    headers['Set-Cookie'] = [].concat(headers['Set-Cookie'] || [], cookie);
  }

  function clearOidcTxCookie(headers) {
    const cookie = cookieHeader(OIDC_TX_COOKIE, '', {
      maxAgeSeconds: 0,
      httpOnly: true,
      sameSite: 'Lax',
    });
    headers['Set-Cookie'] = [].concat(headers['Set-Cookie'] || [], cookie);
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
        logDiagnosticFailure('missing_database');
        return respond(fail('unavailable'));
      }
      try {
        const check = await runDbDiagnostic(query);
        if (!check.ok) {
          logDiagnosticFailure(check.reason);
          return respond(json(503, { ok: false }));
        }
        return respond(json(200, check.result));
      } catch {
        logDiagnosticFailure('query_failed');
        return respond(json(503, { ok: false }));
      }
    }

    if ((!runtimeStoresReady || limiter.backend === 'unavailable') && !isolated) {
      return respond(fail('unavailable'));
    }

    if (path === '/v1/session/start' && method === 'GET') {
      if (!(await limiter.allow(RATE_CATEGORIES.login, ipKey))) return respond(fail('rate_limited'));
      if (!oidcUsable()) {
        await writeAudit(null, 'login_failure', { reason: 'idp_not_configured' }, requestId);
        return respond(fail('unavailable'));
      }
      try {
        const started = await oidc.authorizationRedirect();
        const res = redirect(started.location || started);
        if (started.transactionId) setOidcTxCookie(res.headers, started.transactionId);
        return respond(res);
      } catch {
        await writeAudit(null, 'login_failure', { reason: 'idp_unavailable' }, requestId, request);
        return respond(fail('unavailable'));
      }
    }

    if (path === '/v1/session/callback' && method === 'GET') {
      if (!(await limiter.allow(RATE_CATEGORIES.login, ipKey))) return respond(fail('rate_limited'));
      if (!oidcUsable()) return respond(fail('unavailable'));
      const query = queryOf(request);
      const cookies = parseCookies(request.headers?.cookie || request.headers?.Cookie);
      const transactionId = verifySignedSession(cookies[OIDC_TX_COOKIE], config.sessionSecret);
      const previous = await currentIdentity(request);
      let completed;
      try {
        completed = await oidc.completeCallback(query, { transactionId });
      } catch {
        await writeAudit(null, 'login_failure', { reason: 'idp_unavailable' }, requestId, request);
        const failed = redirect(config.archivePath);
        clearOidcTxCookie(failed.headers);
        return respond(failed);
      }
      if (!completed.ok) {
        await writeAudit(null, 'login_failure', { reason: completed.error }, requestId, request);
        const failed = redirect(config.archivePath);
        clearOidcTxCookie(failed.headers);
        return respond(failed);
      }
      const researcher = await lookupResearcher(completed.subject);
      if (!researcher || researcher.revokedAt || researcher.disabledAt || !researcher.role) {
        await writeAudit(
          { authSubject: completed.subject, role: researcher?.role || null },
          'login_failure',
          { reason: researcher?.disabledAt ? 'disabled' : researcher?.revokedAt ? 'revoked' : 'unknown' },
          requestId
        );
        const denied = redirect(config.archivePath);
        clearOidcTxCookie(denied.headers);
        return respond(denied);
      }
      if (!authorize({ ...researcher, mfaOk: completed.mfaOk, authSubject: completed.subject }, 'summary').ok) {
        await writeAudit(
          { authSubject: completed.subject, role: researcher.role },
          'login_failure',
          { reason: 'role' },
          requestId
        );
        const denied = redirect(config.archivePath);
        clearOidcTxCookie(denied.headers);
        return respond(denied);
      }
      let established;
      try {
        established = await establishSession(completed.subject, {
          mfaOk: true,
          previousSessionId: previous?.sessionId,
        });
      } catch {
        await writeAudit(null, 'login_failure', { reason: 'session_store' }, requestId);
        return respond(fail('unavailable'));
      }
      await writeAudit(
        { authSubject: completed.subject, role: researcher.role },
        'login',
        { outcome: 'ok' },
        requestId,
        request
      );
      clearOidcTxCookie(established.headers);
      return respond(redirect(config.archivePath, established.headers));
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
    oidc,
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
