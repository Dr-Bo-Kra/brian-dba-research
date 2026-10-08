/**
 * Short-lived login tickets (MFA bootstrap). Reuses researcher_auth_states.
 * Not a researcher session. Plaintext access tokens are never stored.
 */
import { SQL } from './db.mjs';

function asRecord(hit) {
  if (!hit) return null;
  return {
    state: hit.state,
    nonce: hit.nonce,
    codeVerifier: hit.code_verifier ?? hit.codeVerifier,
    transactionId: hit.transaction_id ?? hit.transactionId,
    expiresAt: hit.expires_at ?? hit.expiresAt,
  };
}

function live(row) {
  if (!row) return null;
  if (Date.parse(row.expiresAt) <= Date.now()) return null;
  return row;
}

export function createMemoryAuthStateStore() {
  const rows = new Map();
  return {
    backend: 'memory',
    async put(record) {
      rows.set(record.state, { ...record });
    },
    async peek(state) {
      return live(rows.get(state) || null);
    },
    async consume(state, transactionId) {
      const row = rows.get(state);
      if (row) rows.delete(state);
      if (!live(row)) return null;
      if (!transactionId || row.transactionId !== transactionId) return null;
      return row;
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
    async peek(state) {
      const result = await query(SQL.peekAuthState, [state]);
      return live(asRecord(result?.rows?.[0]));
    },
    async consume(state, transactionId) {
      const result = await query(SQL.consumeAuthState, [state]);
      const row = asRecord(result?.rows?.[0]);
      if (!live(row)) return null;
      if (!transactionId || row.transactionId !== transactionId) return null;
      return row;
    },
  };
}

export function createUnavailableAuthStateStore() {
  return {
    backend: 'unavailable',
    async put() {
      throw Object.assign(new Error('unavailable'), { code: 'unavailable' });
    },
    async peek() {
      return null;
    },
    async consume() {
      return null;
    },
  };
}
