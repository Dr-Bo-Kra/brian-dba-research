# Security

This project is a **privacy-hardened** static research site. It is **not** a claim of legal compliance, certification, or completed institutional security assurance.

Live survey collection is **disabled** by default. Do not enable it until the protected submission endpoint, authorised-researcher dashboard access, and the blockers in `docs/launch-readiness.md` are resolved.

## Architecture

```
1. Public survey interface
        → 2. Protected submission API
        → 3. Private Supabase database
        ├── 4. Protected researcher API → 5. Authenticated Inquiry Archive
        └── 6. Authenticated Supabase dashboard (administrative / fallback)
```

Full trust-boundary notes: `docs/researcher-dashboard-architecture.md`. API contract: `api/researcher/SPEC.md`.

- The public browser submits only after consent, and only if `COLLECTION_ENABLED === true` and `SUBMISSION_ENDPOINT` is a credential-free `https://` URL that is **not** a PostgREST table path (`/rest/v1/`).
- The submission endpoint (not yet deployed) must authenticate itself to the database with a **server-side** credential.
- For the **initial release**, authorised researchers review completed results in **Supabase’s authenticated dashboard**. Access is role-based. Brian may be the only provisioned authorised researcher at first. Application code must not hard-code his name or email as an access check.
- There is no anonymous database read. `anon` and `authenticated` have no table privileges.
- The protected researcher API is **fail-closed** unless the host sets `RESEARCHER_API_ENABLED=true` with durable Auth, session, and database configuration.

`researcher/` talks only to the same-origin `/api/researcher` path. The browser must not receive secrets. Password sign-in alone cannot open the archive. It is not a GitHub Pages access-control boundary.

## What this repository hardens

- Consent gate before the survey shell opens; reset returns to that gate and clears local survey data.
- `sessionStorage` for the current tab; legacy `localStorage` survey keys are removed.
- No user-agent, page URL, or precise free-text geography in the research payload.
- No database anon key, service-role key, or other secret in public or researcher browser files.
- No direct anonymous database insert or select from the participant browser.
- Restrictive Content-Security-Policy **meta** tags (`script-src 'self'` on application pages; `script-src 'none'` on the privacy page). No inline event handlers, no Google Fonts, no third-party analytics.
- Database row-level security is enabled and forced; former public insert/select policies are dropped.
- Researcher API scaffold: deny-by-default roles, HttpOnly session cookies, CSRF on mutations, allowlisted DTOs, CSV formula escaping, deletion generic responses, export/delete policy flags off.

## Initial-release researcher workflow (Supabase dashboard)

| Control | Expectation |
| --- | --- |
| Interface | Authenticated Supabase dashboard (not `researcher/`) |
| Accounts | Role-based authorised-researcher identities. Brian may be the only provisioned researcher initially. No shared login. |
| MFA | Required: Supabase Auth TOTP (`aal2`). AIM / Entra is not used |
| Least privilege | Minimum dashboard permissions to review, export, and delete research rows |
| Public reads | None. Do not add `anon` or `authenticated` SELECT policies |
| Aggregate reporting | Dashboard counts and filters only; nothing published on the public site |
| CSV export | Authenticated dashboard session; store extracts in an approved location |
| Deletion | By participant reference (`client_record_id` / `resp_…`) before anonymisation |
| Retention | Follow the approved schedule once it exists; collection stays off until then |
| Audit logging | Supabase project logs plus a written export/deletion record |

Never put the service-role key in `config.js`, `researcher/config.js`, GitHub Pages, or client-side JavaScript. Never add a public “view responses” page on the survey site.

## Inquiry archive (`researcher/`) and protected researcher API — future only

Static files under `researcher/` may remain in the repository. They talk only to `/api/researcher` and still return no research data without a server session. Do not describe GitHub Pages as the live results system.

The archive UI has no password form, no mock login, and no public-data fallback. Unauthenticated callers receive no survey records. Sessions, when later enabled, are HttpOnly cookies — not `localStorage` tokens.

`noindex`, `robots.txt`, and `X-Robots-Tag` are crawl hints. **They are not access controls.** Anyone who knows the URL can fetch the static HTML/CSS/JS. Those files hold no participant records.

**GitHub Pages cannot protect `/researcher/` or run the APIs.** Do not deploy the dashboard or researcher API there.

## Content Security Policy and HTTP headers

Pages include a CSP **meta** tag so GitHub Pages still has a same-origin policy.

**GitHub Pages does not provide complete configurable HTTP security headers.** Directives that browsers enforce only as HTTP headers are not reliable there. In particular, **`frame-ancestors` is not enforced via a meta tag**. This repository therefore:

- omits `frame-ancestors` from the meta CSP (so we do not imply that clickjacking protection is active on GitHub Pages)
- sets `frame-ancestors 'none'`, `X-Frame-Options`, `Referrer-Policy`, `X-Content-Type-Options`, `Permissions-Policy`, HSTS, `Cache-Control: no-store` on `/researcher/`, and a crawl-hint `X-Robots-Tag` for `/researcher/` in `_headers` (Netlify / Cloudflare Pages) and `vercel.json` (Vercel)

When collection is enabled, add **only** the submission endpoint origin to the public page `connect-src`. Do not add a researcher API origin until that future API is approved. Prefer hosting the archive and API same-site so `connect-src 'self'` can remain.

## Reporting a vulnerability or suspected incident

Do not file a public GitHub issue that contains participant data, keys, or request logs.

Until the institution names a privacy / security contact, notify Brian E Pereira through the [published LinkedIn profile](https://www.linkedin.com/in/brianpereira/) and preserve evidence. After approval, use the contacts in `docs/data-retention-and-incident-response.md`.

## See also

- `docs/researcher-dashboard-architecture.md` — layers, credentials, and fail-closed rules
- `docs/launch-readiness.md` — blockers that still prevent live collection
- `docs/data-protection-impact-assessment.md` — working screening record
- `docs/data-retention-and-incident-response.md` — retention and incident draft
- `supabase/schema.sql` — RLS, privilege revocation, no public SELECT
- `api/researcher/SPEC.md` — protected researcher API contract
