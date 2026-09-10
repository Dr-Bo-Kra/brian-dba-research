/**
 * Public browser configuration. This file must never contain credentials.
 * Collection uses the dual kill switch: this flag plus server SUBMISSION_API_ENABLED.
 */
window.BRIAN_DBA_CONFIG = {
  COLLECTION_ENABLED: true,
  SUBMISSION_ENDPOINT: 'https://brian-dba-research.vercel.app/api/submission',
  PRIVACY_NOTICE_VERSION: '2026-09-09',
  LINKEDIN_URL: 'https://www.linkedin.com/in/brianpereira/',
};
