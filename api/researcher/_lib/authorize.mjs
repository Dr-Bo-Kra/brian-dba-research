import {
  ACTION_PERMISSIONS,
  PERMISSIONS,
  ROLE_DISPLAY,
  ROLES,
  SENSITIVE_AUDIT_KEYS,
  STUDY_OWNER_ROLE,
} from './constants.mjs';

export function permissionsForRole(role) {
  if (!ROLES.includes(role)) return Object.freeze([]);
  return PERMISSIONS[role] || Object.freeze([]);
}

export function hasPermission(identity, permission) {
  if (!identity || typeof identity !== 'object') return false;
  return permissionsForRole(identity.role).includes(permission);
}

export function isActiveResearcher(identity) {
  if (!identity || typeof identity !== 'object') return false;
  if (identity.revokedAt) return false;
  if (identity.disabledAt) return false;
  if (identity.mfaOk !== true) return false;
  if (!ROLES.includes(identity.role)) return false;
  return true;
}

export function isStudyOwner(identity) {
  return Boolean(identity && identity.role === STUDY_OWNER_ROLE);
}

export function displayRoleLabel(role) {
  return ROLE_DISPLAY[role] || null;
}

/**
 * Directory health: exactly one active Study Owner (researcher_admin).
 * Zero or more researcher_support rows are allowed.
 * Zero or multiple Study Owners fail closed for owner/admin operations
 * and for login completion.
 */
export function studyOwnerInvariantOk(activeStudyOwnerCount) {
  return Number(activeStudyOwnerCount) === 1;
}

export function authorize(identity, action, { studyOwnerCount = 1 } = {}) {
  if (!isActiveResearcher(identity)) {
    return { ok: false, error: identity ? 'forbidden' : 'unauthorized' };
  }
  const permission = ACTION_PERMISSIONS[action];
  if (!permission) return { ok: false, error: 'forbidden' };
  if (!hasPermission(identity, permission)) {
    return { ok: false, error: 'forbidden' };
  }
  // Owner/admin operations fail closed unless exactly one Study Owner exists.
  if (
    (permission === 'research:withdraw' || permission === 'research:admin') &&
    !studyOwnerInvariantOk(studyOwnerCount)
  ) {
    return { ok: false, error: 'forbidden' };
  }
  return { ok: true, role: identity.role, permission };
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
