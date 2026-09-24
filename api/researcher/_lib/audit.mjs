import { SQL } from './db.mjs';
import { sanitizeAuditDetail } from './authorize.mjs';

export function createMemoryAuditSink(auditLog) {
  return {
    backend: 'memory',
    async write(event) {
      auditLog.push(event);
    },
  };
}

export function createDatabaseAuditSink(query, config = {}) {
  return {
    backend: 'database',
    async write(event) {
      const detail = sanitizeAuditDetail({
        ...(event.detail || {}),
        request_id: event.request_id || null,
        outcome: event.detail?.outcome,
        reason: event.detail?.reason,
        ...(config.auditStoreResearcherIp && event.researcher_ip
          ? { researcher_ip: event.researcher_ip }
          : {}),
      });
      await query(SQL.insertAudit, [
        event.actor_id || 'anonymous',
        event.action,
        event.participant_reference || null,
        JSON.stringify(detail),
        event.actor_role || null,
      ]);
    },
  };
}

export function createUnavailableAuditSink() {
  return {
    backend: 'unavailable',
    async write() {},
  };
}

export function resolveAuditSink(config, overrides = {}) {
  const log = overrides.auditLog || [];
  if (overrides.allowMemoryStores === true) {
    return { sink: createMemoryAuditSink(log), log };
  }
  if (overrides.query && config.sessionStore === 'database') {
    return { sink: createDatabaseAuditSink(overrides.query, config), log };
  }
  return { sink: createUnavailableAuditSink(), log };
}
