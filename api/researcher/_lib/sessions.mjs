/**
 * Researcher session stores. Production never silently uses memory.
 * Memory is isolated tests/dev fixtures only (allowMemoryStores).
 */
import { SQL } from './db.mjs';
import { createMemorySessionStore, newOpaqueId } from './http.mjs';

export { createMemorySessionStore };

export function createUnavailableSessionStore() {
  return {
    backend: 'unavailable',
    async create() {
      throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
    },
    async get() {
      return null;
    },
    async revoke() {},
    async revokeSubject() {},
    async cleanupExpired() {},
    async rotate() {
      throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
    },
  };
}

export function createDatabaseSessionStore(query) {
  return {
    backend: 'database',
    async create(record) {
      const id = newOpaqueId();
      await query(SQL.insertSession, [
        id,
        record.authSubject,
        record.mfaOk === true,
        record.expiresAt,
      ]);
      return id;
    },
    async get(id) {
      const result = await query(SQL.getSession, [id]);
      const row = result?.rows?.[0];
      if (!row) return null;
      if (row.revoked_at || Date.parse(row.expires_at) <= Date.now()) return null;
      return {
        id: row.id,
        authSubject: row.auth_subject,
        mfaOk: row.mfa_ok === true,
        expiresAt: row.expires_at,
        role: row.role,
        mfaRequired: row.mfa_required !== false,
        researcherRevokedAt: row.researcher_revoked_at || null,
        researcherDisabledAt: row.researcher_disabled_at || null,
      };
    },
    async revoke(id) {
      await query(SQL.revokeSession, [id]);
    },
    async revokeSubject(subject) {
      await query(SQL.revokeSessionsForSubject, [subject]);
    },
    async cleanupExpired() {
      await query(SQL.cleanupExpiredSessions, []);
    },
    async rotate(previousId, record) {
      if (previousId) await query(SQL.revokeSession, [previousId]);
      return this.create(record);
    },
  };
}

export function resolveSessionStore(config, overrides = {}) {
  if (overrides.sessions) return overrides.sessions;
  if (overrides.allowMemoryStores === true) {
    return createMemorySessionStore();
  }
  if (config.sessionStore === 'database' && overrides.query) {
    return createDatabaseSessionStore(overrides.query);
  }
  return createUnavailableSessionStore();
}
