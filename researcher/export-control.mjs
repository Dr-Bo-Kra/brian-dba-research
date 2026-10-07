/**
 * Ledger CSV control for a signed-in Study Owner or Research Support session.
 * Both roles include research:export. The control does not depend on
 * EXPORTS_ENABLED. Logged-out callers are rejected by the API.
 */

export const EXPORT_ALL_NOTE =
  'The download includes every accepted response in this study, not only this page.';

export function roleCanExport(payload, role = payload?.role) {
  if (payload?.canExport === true) return true;
  if (role === 'researcher_admin' || role === 'researcher_support') return true;
  if (payload?.roleLabel === 'Study Owner' || payload?.roleLabel === 'Research Support') return true;
  return Array.isArray(payload?.permissions) && payload.permissions.includes('research:export');
}

export function exportAllowedForSession(payload) {
  if (!payload || payload.authenticated !== true) return false;
  const role = payload.role || 'researcher_support';
  return roleCanExport(payload, role);
}

export function exportControlForPayload(payload) {
  const enabled = exportAllowedForSession(payload);
  return {
    enabled,
    disabled: !enabled,
    note: EXPORT_ALL_NOTE,
  };
}
