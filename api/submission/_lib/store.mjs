/**
 * Submission store. Fixture/memory backends are DI/test only.
 * Production inserts through parameterised SQL; unique_violation is treated
 * as idempotent success (no existence leak to the client).
 */
import { SQL } from './db.mjs';

export function createMemorySubmissionStore(seed = []) {
  const rows = new Map();
  for (const row of seed) {
    if (row?.client_record_id) rows.set(row.client_record_id, structuredClone(row));
  }
  return {
    backend: 'memory',
    rows,
    async insert(row) {
      if (rows.has(row.client_record_id)) {
        return { ok: true, inserted: false };
      }
      rows.set(row.client_record_id, {
        ...structuredClone(row),
        created_at: new Date().toISOString(),
        legal_hold: false,
        anonymised_at: null,
      });
      return { ok: true, inserted: true };
    },
  };
}

export function createDatabaseSubmissionStore(query) {
  return {
    backend: 'database',
    async insert(row) {
      try {
        await query(SQL.insertSubmission, [
          row.instrument_id,
          row.client_record_id,
          JSON.stringify(row.profile),
          JSON.stringify(row.responses),
          JSON.stringify(row.assessment),
          row.privacy_notice_version,
          row.consented_at,
        ]);
        return { ok: true, inserted: true };
      } catch (err) {
        if (err?.code === 'duplicate' || err?.category === 'unique_violation') {
          return { ok: true, inserted: false };
        }
        throw err;
      }
    },
  };
}

export function createUnavailableSubmissionStore() {
  return {
    backend: 'unavailable',
    async insert() {
      throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
    },
  };
}

export function resolveSubmissionStore(config, overrides = {}) {
  if (overrides.store) return overrides.store;
  if (overrides.allowMemoryStores === true) {
    return createMemorySubmissionStore(overrides.records || []);
  }
  if (overrides.query && config.dataReady) {
    return createDatabaseSubmissionStore(overrides.query);
  }
  return createUnavailableSubmissionStore();
}
