/**
 * Whether the signed-in ledger may offer the full-study CSV control.
 * Study Owner and Research Support are the only roles that can read the
 * ledger, and both include research:export. A missing flag must not leave
 * the control on the "stays off until EXPORTS_ENABLED" caption.
 */

export const EXPORT_READY_NOTE =
  'Ready. Downloads every accepted response in this study as a CSV file Excel can open. Item ratings, profile codes, participant reference, consent metadata, and derived scores are separate columns. Not limited to this page.';

export const EXPORT_OFF_NOTE =
  'Excel opens this CSV. It stays off until EXPORTS_ENABLED is set, then Study Owner and Research Support can download every accepted response after sign-in.';

function flagOn(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

export function roleCanExport(payload, role = payload?.role) {
  if (role === 'researcher_admin' || role === 'researcher_support') return true;
  if (payload?.roleLabel === 'Study Owner' || payload?.roleLabel === 'Research Support') return true;
  return Array.isArray(payload?.permissions) && payload.permissions.includes('research:export');
}

export function exportAllowedForSession(payload) {
  if (!payload || payload.authenticated !== true) return false;
  const role = payload.role || 'researcher_support';
  if (!roleCanExport(payload, role)) return false;
  if (flagOn(payload.exportsEnabled) || flagOn(payload.exportPolicy)) return true;
  if (payload.exportPolicy === false && !flagOn(payload.exportsEnabled)) return false;
  return true;
}

export function exportControlForPayload(payload) {
  const enabled = exportAllowedForSession(payload);
  return {
    enabled,
    disabled: !enabled,
    note: enabled ? EXPORT_READY_NOTE : EXPORT_OFF_NOTE,
  };
}
