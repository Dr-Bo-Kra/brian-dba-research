/**
 * Researcher workspace configuration.
 *
 * Never place a service-role key, anon key, publishable key, JWT secret,
 * password, UUID, or other credential here. The browser must not store
 * access tokens in localStorage or sessionStorage. Sessions are HttpOnly
 * cookies set by the API.
 *
 * The same-origin value is '/api/researcher'. That is client-safe path
 * config only. Do not hard-code a named person as an access check.
 */
window.BRIAN_DBA_RESEARCHER_CONFIG = {
  RESEARCHER_ENDPOINT: '/api/researcher',
};
