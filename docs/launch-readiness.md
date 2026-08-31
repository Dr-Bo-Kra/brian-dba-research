# Launch readiness

This checklist is for a **privacy-hardened** demonstration. Completing engineering items here does **not** make the project legally compliant. Live collection must stay **off** until the institutional and technical blockers below are closed.

## Unresolved launch blockers (initial collection)

| Blocker | Current state |
| --- | --- |
| Sponsoring university and legal data controller | Not named in the privacy notice |
| Privacy / DPO contact | Not named |
| Ethics approval and reference | Not recorded |
| Countries where participants will be recruited | Not confirmed |
| Lawful basis and consent wording approved by the institution | On-page checkboxes are a research-consent record only |
| Retention and anonymisation periods | TBD |
| Hosting / database region | TBD |
| Processor agreements and international-transfer safeguards | TBD |
| Protected submission endpoint, abuse protection, rate limiting | Not deployed; client keeps collection disabled |
| Incident contacts | TBD |
| Authorised-researcher identities and roles on the authenticated Supabase dashboard | Not provisioned. Role-based model; Brian may be the only provisioned researcher initially. MFA, least privilege, no public SELECT. |
| Controlled dashboard CSV export, deletion-by-reference, retention, and audit practice | Operational procedure not yet approved |

## Future interface (not an initial-collection blocker)

| Item | Current state |
| --- | --- |
| Protected researcher API for `researcher/` | Scaffolded under `api/researcher/`; **disabled**. Inquiry archive stays disconnected |
| MFA identity provider and durable session store | Not connected. No mock login |
| Institutional approval to use the Inquiry archive | Not granted |
| Host that can protect the `/researcher/` route | GitHub Pages cannot. `noindex` / `robots.txt` are crawl hints, not access controls. |

Do not treat `researcher/` as the production results interface until those future items, plus authentication and authorisation, are complete.

## Engineering already in this repository

- Consent required before the survey opens; reset returns to the gate
- `sessionStorage` only; legacy `localStorage` survey data removed
- No user-agent, page URL, or precise free-text geography in the payload
- No anon key, service-role key, or public table insert from browser code
- Collection disabled unless an HTTPS protected endpoint (not `/rest/v1/`) is configured
- Forced RLS and revoked `anon` / `authenticated` table privileges
- Inquiry archive UI at `researcher/` kept as a disconnected future workspace (no mock login, no token storage)
- Fail-closed researcher API scaffold (`RESEARCHER_API_ENABLED=false`; export/delete off)
- CSP meta tags; `_headers` and `vercel.json` for hosts that honour them
- Automated checks in GitHub Actions

## Go-live sequence (after blockers close)

1. Record controller, DPO, ethics reference, recruitment countries, lawful basis, and approved notice text in `privacy.html`.
2. Complete the institutional DPIA; replace the screening record.
3. Set retention, anonymisation, backup, and incident contacts.
4. Execute processor agreements; fix region and transfer safeguards.
5. Deploy the submission endpoint (origin allowlist, validation, size cap, rate limit).
6. Apply `supabase/schema.sql` in the approved region. Confirm there is still **no** public SELECT policy.
7. Provision authorised-researcher roles on the authenticated Supabase dashboard with MFA and least privilege. Brian may be the only provisioned researcher initially.
8. Agree dashboard procedure for aggregate review, controlled CSV export, deletion by participant reference, and audit notes.
9. Update public CSP `connect-src` for the submission endpoint origin only.
10. Keep `COLLECTION_ENABLED` false until a documented go-live decision. Only then set it to `true` with a filled `SUBMISSION_ENDPOINT`.
11. Keep `RESEARCHER_ENDPOINT` empty. Do not switch results review to `researcher/` in this launch.

## Explicit non-goals for this launch

- Do not describe the site as GDPR-, DPDP-, or otherwise legally compliant
- Do not add public analytics, Google Fonts, or inline event handlers
- Do not put secrets in browser files
- Do not open a public results page on `index.html`
- Do not describe `noindex` or `robots.txt` as access controls
- Do not hard-code Brian’s name or email as an application access check
