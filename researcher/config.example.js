/**
 * Researcher workspace configuration.
 *
 * Never place a service-role key, anon key, JWT secret, password, or other
 * credential here. The browser must not store access tokens in localStorage
 * or sessionStorage. Sessions are HttpOnly cookies set by the API.
 *
 * Keep RESEARCHER_ENDPOINT empty until the Vercel API is intentionally
 * connected. The same-origin value is '/api/researcher'. That is client-safe
 * path config only. Do not hard-code a named person as an access check.
 */
window.BRIAN_DBA_RESEARCHER_CONFIG = {
  RESEARCHER_ENDPOINT: '',
};
