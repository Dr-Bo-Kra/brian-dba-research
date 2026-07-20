/**
 * Local / deploy config. Copy from config.example.js.
 * Leave empty until Supabase is configured — the site still works offline.
 *
 * The anon key is public by design (RLS: insert-only for visitors).
 * Never add the service_role key here.
 */
window.BRIAN_DBA_CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',
  LINKEDIN_URL: 'https://www.linkedin.com/in/brianpereira/',
};
