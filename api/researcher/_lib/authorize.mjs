import { ROLES, SENSITIVE_AUDIT_KEYS } from './constants.mjs';

export function isActiveResearcher(identity) {
  if (!identity || typeof identity !== 'object') return false;
  if (identity.revokedAt) return false;
  if (identity.disabledAt) return false;
  if (identity.mfaOk !== true) return false;
  if (!ROLES.includes(identity.role)) return false;
  return true;
}

export function authorize(identity, action) {
  if (!isActiveResearcher(identity)) {
    return { ok: false, error: identity ? 'forbidden' : 'unauthorized' };
  }
  const allowed = {
    summary: true,
    list: true,
    view_record: true,
    view_qualitative: true,
    export: identity.role === 'authorised_researcher' || identity.role === 'researcher_admin',
    delete: identity.role === 'authorised_researcher' || identity.role === 'researcher_admin',
    role_change: identity.role === 'researcher_admin',
  };
  if (!allowed[action]) return { ok: false, error: 'forbidden' };
  return { ok: true, role: identity.role };
}

export function sanitizeAuditDetail(detail = {}) {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return {};
  const clean = {};
  for (const [key, value] of Object.entries(detail)) {
    if (SENSITIVE_AUDIT_KEYS.includes(key)) continue;
    if (value && typeof value === 'object') continue;
    if (typeof value === 'string' && value.length > 200) continue;
    clean[key] = value;
  }
  return clean;
}

export function pickLedger(record) {
  if (!record || typeof record !== 'object') return null;
  return {
    participant_reference: record.participant_reference || record.client_record_id || null,
    accepted_at: record.accepted_at || record.created_at || null,
    region: record.region || record.profile?.countryRegion || null,
    role: record.role || record.profile?.position || null,
    experience: record.experience || record.profile?.yearsLending || null,
    orientation: record.orientation ?? record.assessment?.overall?.score ?? null,
    legal_hold: Boolean(record.legal_hold),
    anonymised: Boolean(record.anonymised_at),
  };
}
