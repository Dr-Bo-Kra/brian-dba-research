import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(root, relative), 'utf8');

const indexHtml = read('index.html');
const privacyHtml = read('privacy.html');
const scriptJs = read('script.js');
const configJs = read('config.js');
const configExample = read('config.example.js');
const schemaSql = read('supabase/schema.sql');
const researcherHtml = read('researcher/index.html');
const researcherJs = read('researcher/dashboard.js');
const researcherConfig = read('researcher/config.js');
const researcherConfigExample = read('researcher/config.example.js');
const researcherCss = read('researcher/dashboard.css');

const publicBrowser = [indexHtml, scriptJs, configJs, configExample];
const allBrowser = [
  ...publicBrowser,
  researcherHtml,
  researcherJs,
  researcherConfig,
  researcherConfigExample,
];

test('consent and privacy notice exist', () => {
  assert.match(indexHtml, /id="eligibility-confirm"/);
  assert.match(indexHtml, /id="consent-confirm"/);
  assert.match(indexHtml, /id="survey-consent-continue"/);
  assert.match(indexHtml, /survey-consent-continue" disabled/);
  assert.match(indexHtml, /href="privacy\.html"/);
  assert.match(privacyHtml, /Privacy and participant information/);
  assert.match(privacyHtml, /Protected research collection is currently disabled/);
  assert.match(scriptJs, /hasValidConsent/);
  assert.match(scriptJs, /returnToConsentGate/);
});

test('collection defaults to disabled', () => {
  assert.match(configJs, /COLLECTION_ENABLED:\s*false/);
  assert.match(configExample, /COLLECTION_ENABLED:\s*false/);
  assert.match(configJs, /SUBMISSION_ENDPOINT:\s*''/);
  assert.match(scriptJs, /COLLECTION_ENABLED === true/);
  assert.match(scriptJs, /isProtectedSubmissionEndpoint/);
});

test('no Supabase anonymous key or direct REST table endpoint in browser code', () => {
  for (const source of allBrowser) {
    assert.doesNotMatch(source, /SUPABASE_ANON_KEY/);
    assert.doesNotMatch(source, /service_role/);
    assert.doesNotMatch(source, /eyJ[A-Za-z0-9_-]{20,}/);
    assert.doesNotMatch(source, /\/rest\/v1\/assessment_responses/);
  }
  assert.match(scriptJs, /rest\\\/v1/);
  assert.match(researcherJs, /rest\\\/v1/);
});

test('no user-agent or page URL is collected', () => {
  assert.doesNotMatch(scriptJs, /userAgent/);
  assert.doesNotMatch(scriptJs, /user_agent/);
  assert.doesNotMatch(scriptJs, /page_url/);
  assert.doesNotMatch(scriptJs, /location\.href/);
  assert.doesNotMatch(scriptJs, /navigator\./);
  assert.doesNotMatch(schemaSql, /user_agent text/);
  assert.doesNotMatch(schemaSql, /page_url text/);
  assert.match(schemaSql, /drop column if exists user_agent/);
  assert.match(schemaSql, /drop column if exists page_url/);
});

test('sessionStorage is used and localStorage is only purged', () => {
  assert.match(scriptJs, /sessionStorage\.setItem/);
  assert.match(scriptJs, /purgeLegacyLocalData/);
  assert.match(scriptJs, /purgeAllLocalSurveyData/);
  assert.doesNotMatch(scriptJs, /localStorage\.setItem/);
});

test('CSP and privacy links exist without HTTP-only frame-ancestors in meta', () => {
  assert.match(indexHtml, /http-equiv="Content-Security-Policy"/);
  assert.match(privacyHtml, /http-equiv="Content-Security-Policy"/);
  assert.match(indexHtml, /connect-src 'self'/);
  assert.doesNotMatch(indexHtml, /supabase\.co/);
  assert.doesNotMatch(indexHtml, /frame-ancestors/);
  assert.doesNotMatch(privacyHtml, /frame-ancestors/);
  assert.match(indexHtml, /script-src 'self'/);
  assert.match(privacyHtml, /script-src 'none'/);
  assert.doesNotMatch(indexHtml, /fonts\.googleapis/);
  assert.doesNotMatch(indexHtml, /onclick=/);
  assert.doesNotMatch(researcherHtml, /onclick=/);
  assert.match(indexHtml, /href="privacy\.html"/);
  assert.match(privacyHtml, /href="index\.html#survey"/);
});

test('database RLS and privilege revocation are present with no public SELECT', () => {
  assert.match(schemaSql, /enable row level security/);
  assert.match(schemaSql, /force row level security/);
  assert.match(schemaSql, /revoke all privileges on table public\.assessment_responses from anon/i);
  assert.match(schemaSql, /revoke all privileges on table public\.assessment_responses from authenticated/i);
  assert.match(schemaSql, /drop policy if exists "anon_select_assessment_responses"/i);
  assert.doesNotMatch(schemaSql, /create policy[\s\S]{0,400}\sto\s+(anon|authenticated|public)\b/i);
  assert.match(schemaSql, /create policy researcher_api_select_assessment_responses/i);
  assert.doesNotMatch(schemaSql, /grant (select|insert|all).*anon/i);
  assert.match(schemaSql, /researcher_audit_events/);
});

test('researcher API RLS policies are drop-then-create so the schema is re-runnable', () => {
  const created = [...schemaSql.matchAll(/create policy (researcher_api_\w+)/gi)].map((match) => match[1]);
  assert.ok(created.includes('researcher_api_insert_rate_limits'));
  assert.ok(created.includes('researcher_api_update_rate_limits'));
  for (const name of created) {
    const drop = new RegExp(`drop policy if exists ${name}\\b`, 'i');
    const create = new RegExp(`create policy ${name}\\b`, 'i');
    assert.match(schemaSql, drop, `${name} must be dropped before recreate`);
    assert.ok(schemaSql.search(drop) < schemaSql.search(create), `${name} drop must precede create`);
  }
});

test('inquiry archive is a disconnected future workspace without secrets', () => {
  assert.match(researcherHtml, /Inquiry archive/);
  assert.match(researcherHtml, /future interface/i);
  assert.match(researcherHtml, /noindex/);
  assert.match(researcherHtml, /href="\.\.\/styles\.css/);
  assert.match(researcherHtml, /href="dashboard\.css/);
  assert.match(researcherCss, /workspace-panel/);
  assert.match(researcherJs, /RESEARCHER_ENDPOINT/);
  assert.match(researcherJs, /sessionStorage\.removeItem/);
  assert.doesNotMatch(researcherJs, /sessionStorage\.setItem/);
  assert.match(researcherConfig, /RESEARCHER_ENDPOINT:\s*''/);
  assert.doesNotMatch(researcherConfig, /service_role/);
  assert.doesNotMatch(researcherJs, /service_role/);
  assert.doesNotMatch(researcherJs, /Brian-only/i);
  assert.doesNotMatch(researcherHtml, /Brian-only/i);
  assert.doesNotMatch(researcherJs, /brianpereira/i);
  assert.doesNotMatch(indexHtml, /href="researcher\//);
  assert.match(researcherHtml, /id="auth-gate"/);
  assert.match(researcherHtml, /id="auth-start"/);
  assert.match(researcherHtml, /id="workspace-status"/);
  assert.match(researcherJs, /showDisconnectedWorkspace/);
  assert.match(researcherJs, /\/v1\/session/);
  assert.match(schemaSql, /authorised_researchers/);
  assert.match(schemaSql, /delete_assessment_by_reference/);
});

test('documentation names launch blockers and does not claim legal compliance', () => {
  const readme = read('README.md');
  const security = read('SECURITY.md');
  const dpiA = read('docs/data-protection-impact-assessment.md');
  const retention = read('docs/data-retention-and-incident-response.md');
  const launch = read('docs/launch-readiness.md');
  for (const source of [readme, security, dpiA, retention, launch]) {
    assert.match(source, /privacy-hardened/i);
    assert.doesNotMatch(source, /is legally compliant/i);
    assert.doesNotMatch(source, /Brian-only/i);
  }
  assert.match(launch, /Sponsoring university/);
  assert.match(launch, /Privacy \/ DPO/);
  assert.match(launch, /Ethics approval/);
  assert.match(launch, /Countries where participants will be recruited/);
  assert.match(launch, /Lawful basis/);
  assert.match(launch, /Retention and anonymisation/);
  assert.match(launch, /Hosting \/ database region/);
  assert.match(launch, /Processor agreements/);
  assert.match(launch, /Protected submission endpoint/);
  assert.match(readme, /authenticated Supabase dashboard/);
  assert.match(readme, /role-based/);
  assert.match(readme, /crawl hints only/);
  assert.match(security, /They are not access controls/);
  assert.match(security, /GitHub Pages does not provide complete configurable HTTP security headers/);
  assert.match(security, /is not enforced via a meta tag/);
  assert.match(launch, /not an initial-collection blocker/i);
  const architecture = read('docs/researcher-dashboard-architecture.md');
  assert.match(architecture, /Protected researcher API/);
  assert.match(architecture, /Authenticated Inquiry Archive/);
  assert.match(architecture, /administrative \/ fallback/);
  assert.match(architecture, /They are \*\*not\*\* access controls/);
  assert.match(architecture, /What must never be deployed on GitHub Pages/);
  assert.match(security, /protected researcher API/);
});

test('repository has CI workflow and deployable security headers', () => {
  const files = readdirSync(join(root, '.github', 'workflows'));
  assert.ok(files.some((name) => name.endsWith('.yml') || name.endsWith('.yaml')));
  const workflow = read(join('.github', 'workflows', files[0]));
  assert.match(workflow, /node --check script\.js/);
  assert.match(workflow, /node --test tests\/\*\.test\.mjs/);
  const headers = read('_headers');
  assert.match(headers, /Content-Security-Policy/);
  assert.match(headers, /frame-ancestors 'none'/);
  const vercel = read('vercel.json');
  assert.match(vercel, /X-Frame-Options/);
});
