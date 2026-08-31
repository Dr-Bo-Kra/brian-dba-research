/**
 * Researcher workspace configuration. Never place a service-role key,
 * anon key, password, session secret, or other credential in this file.
 *
 * RESEARCHER_ENDPOINT stays empty here so the archive remains disconnected.
 * The intended same-origin path is `/api/researcher` (not a secret).
 * Do not point this at Supabase, `/rest/v1/`, or any database URL.
 */
window.BRIAN_DBA_RESEARCHER_CONFIG = {
  RESEARCHER_ENDPOINT: '',
};
