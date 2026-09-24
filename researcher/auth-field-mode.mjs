/**
 * Constraint-validation helpers for the Inquiry Archive sign-in form.
 * Disabled controls are skipped by native HTML constraint validation.
 */
export function applyAuthFieldMode(fields = {}, mode) {
  const passwordMode = mode === 'password';
  const mfaMode = mode === 'mfa';
  if (fields.email) {
    fields.email.disabled = !passwordMode;
    fields.email.required = passwordMode;
  }
  if (fields.password) {
    fields.password.disabled = !passwordMode;
    fields.password.required = passwordMode;
  }
  if (fields.mfaCode) {
    fields.mfaCode.disabled = !mfaMode;
    fields.mfaCode.required = mfaMode;
  }
}

export function constraintValidationBlocked(fields = {}) {
  return [fields.email, fields.password, fields.mfaCode].some((el) => {
    if (!el || el.disabled) return false;
    return Boolean(el.required) && !String(el.value || '');
  });
}

export function researcherAuthSubmitPath(mfaStepHidden) {
  return mfaStepHidden === false ? '/v1/session/mfa' : '/v1/session/login';
}
