# Launch readiness

This checklist is for a **privacy-hardened** research platform. Completing engineering items here does **not** make the project legally compliant. Live collection must stay **off** until the institutional blockers below are closed and a documented go-live decision is made.

**Engineering snapshot (Preview / `privacy-security-baseline`):** protected submission API and researcher API are implemented and fail-closed. Committed `config.js` keeps `COLLECTION_ENABLED: false` and an empty `SUBMISSION_ENDPOINT`. Preview env includes researcher + submission wiring names; Production env must stay empty until an approved Production promote. Vercel Deployment Protection (SSO) currently gates Preview URLs.

## Governance blockers (block live collection)

| Blocker | Current state |
| --- | --- |
| Sponsoring university and legal data controller | Not named in the privacy notice |
| Privacy / DPO contact | Not named |
| Ethics approval and reference | Not recorded |
| Countries where participants will be recruited | Not confirmed |
| Lawful basis and consent wording approved by the institution | On-page checkboxes are a research-consent record only |
| Retention and anonymisation periods | TBD |
| Hosting / database region | TBD (Preview DB currently ap-southeast-1; not an institutional approval) |
| Processor agreements and international-transfer safeguards | TBD |
| Incident contacts | TBD |
| Controlled CSV export, deletion-by-reference, retention, and audit practice | Policy flags stay off; operational procedure not yet approved |
| Institutional approval to use the Inquiry Archive as the live results interface | Preview-proven; Production use not approved |

## Technical readiness (engineering)

| Capability | State |
| --- | --- |
| Public survey + consent gate | Ready (collection kill-switch off) |
| Protected submission endpoint (`api/submission`), abuse protection, rate limiting | Ready / fail-closed — Preview E2E proven; server flag must remain `SUBMISSION_API_ENABLED=false` until go-live |
| Validation, server-side scoring, abuse protection, durable rate limits | Ready in code; requires durable DB + flags at go-live |
| Database RLS / privilege revocation | Ready — FORCE RLS; `anon`/`authenticated` have no table privileges; `submission_inserter` + `researcher_api` roles provisioned |
| Researcher Auth + TOTP MFA + sessions/logout | Ready on Preview when `RESEARCHER_API_ENABLED` and durable stores are set |
| Researcher authorization (`authorised_researchers`) | Ready in code (deny-by-default; sole-active-row model). Brian cutover not performed |
| Inquiry Archive dashboard + qualitative acknowledgement path | Ready on Preview (exports/deletions remain off) |
| Application audit trail | Ready for researcher API metadata events; institutional retention of logs TBD |
| Participant withdrawal / deletion | Mechanism exists; `DELETIONS_ENABLED` stays false until policy approval |
| Exports | Mechanism exists; `EXPORTS_ENABLED` stays false until policy approval |
| Backup / recovery | Processor-dependent; institutional schedule TBD |
| Monitoring / error handling | Generic API errors + ops logs (no answers); Production alerting TBD |
| Secrets / configuration | Preview secrets in Vercel; Production unset (fail-closed). Never in browser files |
| Custom / final URL | Decision outstanding — do not change Production/DNS without approval |
| Production deployment | Not promoted; Production env empty by design until go-live |

## Not an initial-collection blocker

| Item | Current state |
| --- | --- |
| Protected researcher API for `researcher/` | Same-origin `/api/researcher` on Vercel Node. Host must set `RESEARCHER_API_ENABLED` with Auth/MFA; collection/export/delete stay off |
| MFA identity provider and durable session store | Supabase Auth + TOTP; opaque application session after MFA |
| Host that can protect the researcher **data** path | Application session + MFA. GitHub Pages cannot host this control plane. `noindex` / `robots.txt` are crawl hints, not access controls. |

## Engineering already in this repository

- Consent required before the survey opens; reset returns to the gate
- `sessionStorage` only; legacy `localStorage` survey data removed
- No user-agent, page URL, or precise free-text geography in the payload
- No anon key, service-role key, or public table insert from browser code
- Dual kill switch: browser `COLLECTION_ENABLED` + server `SUBMISSION_API_ENABLED`
- Forced RLS and revoked `anon` / `authenticated` table privileges
- Inquiry archive UI at `researcher/` talks only to `/api/researcher` (no mock login, no token storage)
- Fail-closed researcher API (`RESEARCHER_API_ENABLED` exact `true` required; export/delete off)
- Protected submission API with origin allowlist, validation, size cap, durable rate limit, server scoring
- CSP meta tags; `_headers` and `vercel.json` for hosts that honour them
- Automated checks in GitHub Actions (`npm test`)

## Go-live sequence (after governance blockers close)

1. Record controller, DPO, ethics reference, recruitment countries, lawful basis, and approved notice text in `privacy.html`.
2. Complete the institutional DPIA; replace the screening record.
3. Set retention, anonymisation, backup, and incident contacts.
4. Execute processor agreements; fix region and transfer safeguards.
5. Confirm Production Vercel env (researcher + submission) with secrets in the host secret store — never in git.
6. Confirm schema grants still apply; **no** public SELECT/INSERT policies.
7. Cut over to Brian as the sole active `authorised_researchers` row; enroll **his** TOTP; revoke test researchers.
8. Agree procedure for aggregate review, controlled CSV export (if ever enabled), deletion by participant reference, and audit notes. Keep `EXPORTS_ENABLED` / `DELETIONS_ENABLED` false until that approval.
9. Disable Vercel Deployment Protection on the **public** Production hostname (survey must be reachable). Researcher data remains behind app MFA.
10. Keep `COLLECTION_ENABLED` false until a documented go-live decision. Then: server `SUBMISSION_API_ENABLED=true` → browser `COLLECTION_ENABLED=true` with HTTPS `SUBMISSION_ENDPOINT` → smoke → researcher verify → monitor.
11. Inquiry Archive uses `RESEARCHER_ENDPOINT: '/api/researcher'`. Do not host it on GitHub Pages.

## Explicit non-goals for this launch

- Do not describe the site as GDPR-, DPDP-, or otherwise legally compliant
- Do not add public analytics, Google Fonts, or inline event handlers
- Do not put secrets in browser files
- Do not open a public results page on `index.html`
- Do not describe `noindex` or `robots.txt` as access controls
- Do not hard-code Brian’s name or email as an application access check
- Do not enable public collection, merge to `main`, change Production/DNS, or activate Brian without an explicit owner decision
