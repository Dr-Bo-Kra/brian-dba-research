/**
 * Researcher workspace configuration. Never place a service-role key,
 * anon key, publishable key, password, session secret, UUID, or other
 * credential in this file.
 *
 * RESEARCHER_ENDPOINT is the same-origin API path only. It is not a secret.
 * Do not point this at Supabase, `/rest/v1/`, or any database URL.
 */
window.BRIAN_DBA_RESEARCHER_CONFIG = {
  RESEARCHER_ENDPOINT: '/api/researcher',
};
