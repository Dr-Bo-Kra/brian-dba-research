import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyAuthFieldMode,
  constraintValidationBlocked,
  researcherAuthSubmitPath,
} from '../researcher/auth-field-mode.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'researcher/index.html'), 'utf8');
const dashboard = readFileSync(join(root, 'researcher/dashboard.js'), 'utf8');

function fields(extra = {}) {
  return {
    email: { disabled: false, required: true, value: extra.email ?? 'researcher@example.test' },
    password: { disabled: false, required: true, value: extra.password ?? 'correct-horse-battery' },
    mfaCode: { disabled: true, required: false, value: extra.mfa ?? '' },
  };
}

test('hidden password fields cannot block MFA submit', () => {
  const form = fields();
  applyAuthFieldMode(form, 'mfa');
  form.email.value = '';
  form.password.value = '';
  form.mfaCode.value = '123456';
  assert.equal(form.email.disabled, true);
  assert.equal(form.password.disabled, true);
  assert.equal(form.email.required, false);
  assert.equal(form.password.required, false);
  assert.equal(constraintValidationBlocked(form), false);
});

test('MFA code is required and enabled during the MFA step', () => {
  const form = fields();
  applyAuthFieldMode(form, 'mfa');
  assert.equal(form.mfaCode.disabled, false);
  assert.equal(form.mfaCode.required, true);
  form.mfaCode.value = '';
  assert.equal(constraintValidationBlocked(form), true);
  form.mfaCode.value = '123456';
  assert.equal(constraintValidationBlocked(form), false);
});

test('password fields are restored when returning to the password step', () => {
  const form = fields({ email: '', password: '', mfa: '123456' });
  applyAuthFieldMode(form, 'mfa');
  applyAuthFieldMode(form, 'password');
  assert.equal(form.email.disabled, false);
  assert.equal(form.password.disabled, false);
  assert.equal(form.email.required, true);
  assert.equal(form.password.required, true);
  assert.equal(form.mfaCode.disabled, true);
  assert.equal(form.mfaCode.required, false);
  form.email.value = 'researcher@example.test';
  form.password.value = 'correct-horse-battery';
  form.mfaCode.value = '';
  assert.equal(constraintValidationBlocked(form), false);
});

test('MFA form submit sends /v1/session/mfa once validation can proceed', () => {
  const form = fields();
  applyAuthFieldMode(form, 'mfa');
  form.email.value = '';
  form.password.value = '';
  form.mfaCode.value = '123456';
  assert.equal(constraintValidationBlocked(form), false);
  assert.equal(researcherAuthSubmitPath(false), '/v1/session/mfa');
  assert.match(dashboard, /from '\.\/auth-field-mode\.mjs'/);
  assert.match(dashboard, /applyAuthFieldMode\(/);
  assert.match(dashboard, /researcherAuthSubmitPath\(authMfaStep\?\.hidden\)/);
  assert.match(
    dashboard,
    /researcherAuthSubmitPath\(authMfaStep\?\.hidden\) === '\/v1\/session\/mfa'[\s\S]*authPost\('\/v1\/session\/mfa'/
  );
  assert.match(dashboard, /showMfaStep\([\s\S]*applyAuthFieldMode\([\s\S]*'mfa'/);
  assert.match(dashboard, /showPasswordStep\([\s\S]*applyAuthFieldMode\([\s\S]*'password'/);
  assert.match(html, /type="module" src="dashboard\.js/);
  assert.match(html, /<form id="auth-form"[^>]*>/);
  assert.doesNotMatch(html, /<form id="auth-form"[^>]*novalidate/);
  assert.match(html, /id="auth-mfa-code"[^>]*\sdisabled/);
  assert.doesNotMatch(dashboard, /SUPABASE_/);
  assert.doesNotMatch(dashboard, /sb_publishable_/);
  assert.doesNotMatch(dashboard, /access_token|refresh_token/);
});
