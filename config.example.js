/**
 * Public browser configuration.
 *
 * Never place a Supabase anon key, service-role key, API token, or other
 * credential in this file. SUBMISSION_ENDPOINT must be a protected HTTPS API
 * that performs origin checks, schema validation, payload-size limits, abuse
 * controls, and server-side insertion into the research database.
 *
 * Keep COLLECTION_ENABLED false until institutional ethics approval, the
 * privacy notice, processor agreements, retention schedule, and endpoint have
 * all been approved and tested.
 */
window.BRIAN_DBA_CONFIG = {
  COLLECTION_ENABLED: false,
  SUBMISSION_ENDPOINT: '', // e.g. 'https://project.functions.supabase.co/submit-assessment'
  PRIVACY_NOTICE_VERSION: '2026-08-28',
  LINKEDIN_URL: 'https://www.linkedin.com/in/brianpereira/',
};
