/**
 * Supabase client config for the Lending Desk assessment archive.
 *
 * Copy this file to `config.js` and fill in values from:
 *   Supabase Dashboard → Project Settings → API
 *
 * IMPORTANT:
 *   • SUPABASE_ANON_KEY is designed to be public (browser-safe) when Row Level
 *     Security is enabled. It is NOT a secret like the service_role key.
 *   • Never put the service_role key in this file or any front-end code.
 *   • `config.js` is gitignored so local / Pages secrets stay out of git if you
 *     prefer; for GitHub Pages you can either:
 *       – commit a filled `config.js` (anon key only), or
 *       – set placeholders here and paste keys only on the deploy machine.
 *
 * Until URL + anon key are set, the site keeps working: responses save to
 * localStorage + JSON download only.
 */
window.BRIAN_DBA_CONFIG = {
  SUPABASE_URL: '', // e.g. 'https://xxxxxxxx.supabase.co'
  SUPABASE_ANON_KEY: '', // e.g. 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
};
