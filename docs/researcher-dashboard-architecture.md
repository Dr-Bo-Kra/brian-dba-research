# Researcher dashboard architecture

This document defines the **intended production architecture** for authorised review of Inclusive Lending Desk responses. It is part of a **privacy-hardened** demonstration. It is **not** a claim that the system is hack-proof, legally compliant, approved for live human-subject research, or ready for live collection.

Live collection stays **disabled**. The Inquiry archive at `researcher/` stays **disconnected**. Do not put service-role, anon, database, or other privileged credentials in browser-delivered files.

## Layers

```
1. Public survey interface          (static HTML/JS, no secrets)
        │  HTTPS POST of a validated JSON payload
        ▼
2. Protected submission API         (server-side only; not deployed)
        │  parameterised INSERT
        ▼
3. Private Supabase database        (RLS forced; no public SELECT)
        │  parameterised SELECT / controlled DELETE
        ▼
4. Protected researcher API         (scaffolded, fail-closed, not enabled)
        │  cookie session + role check on every request
        ▼
5. Authenticated Inquiry Archive    (static UI; consumes API only)
```

**6. Authenticated Supabase dashboard** remains **administrative / fallback** research access for operators with MFA and least privilege. It is not a public page. It is the only results interface contemplated for an *initial* collection launch, until the researcher API is implemented, approved, and hosted on a platform that can protect it.

### Intended production path (after approvals)

```
Participant browser
  → protected submission API
  → private Supabase database
  → protected researcher API
  → authenticated researcher dashboard
```

The dashboard must **never** rely on obscurity, `robots.txt`, `noindex`, an unlinked URL, or GitHub Pages path hiding for security. Those are crawl hints or convenience. They are **not** access controls.

## Trust boundaries and credentials

| Layer | Trust | What may exist here | What must never exist here |
| --- | --- | --- | --- |
| 1. Public survey browser | Untrusted | Public copy, `COLLECTION_ENABLED`, empty or HTTPS submission URL | Anon key, service-role key, DB URL, JWT secret, researcher session |
| 2. Submission API | Trusted server | Server credential with **INSERT-only** on `assessment_responses` | Browser-readable keys; researcher read role |
| 3. Database | Trusted store | Research rows, audit rows, researcher-role directory | Public/anon policies; Realtime on research tables |
| 4. Researcher API | Trusted server | Session store, `supabase.auth.getClaims()` + publishable Auth apikey, **read** role, optional delete function | Anything shipped to `researcher/config.js` |
| 5. Inquiry Archive browser | Untrusted UI | Same-origin API calls with **HttpOnly** cookies; non-secret UI state | Tokens, passwords, service-role, record dumps without a session |
| 6. Supabase dashboard | Privileged operator UI | Named dashboard users with MFA | Shared logins; SQL for untrained roles if the institution can avoid it |

**Research authentication:** Supabase Auth with mandatory TOTP MFA. There is no technical dependency on AIM Microsoft/Entra SSO or AIM ICT.

**Application authorization:** exactly one active `authorised_researchers` row. The verified Supabase user id (`auth_subject`) must match that row. Role may be `researcher_admin`. Email is not an authorization check.

**Database access:** Vercel researcher API using the `researcher_api` role. The browser never SELECTs research tables.

**Researcher interface:** Inquiry Archive.

**Supabase dashboard:** administrative / fallback only.

Deny access **by default**. A request is authorised only after the researcher API has confirmed an **active authorised-researcher role**, MFA assurance (`aal2` + TOTP), and the single-active-directory invariant. Brian may be the only provisioned authorised researcher. Application code must **not** hard-code his name, email, or user id as an access check.

## What is implemented now

- Public survey consent gate, sessionStorage-only local result, collection **off**.
- Schema: forced RLS, revoked `anon` / `authenticated` table privileges, no `CREATE POLICY`, dropped `user_agent` / `page_url`.
- Inquiry archive **UI** that fails closed when `RESEARCHER_ENDPOINT` is empty (the default).
- Researcher API **scaffold** under `api/researcher/` that refuses data unless explicitly enabled **and** server-side configuration exists. Defaults keep it disabled.
- Architecture tests for fail-closed behaviour, allowlisted filters, CSV formula escaping, and documentation invariants.

## What is only scaffolded

- HTTP routes, validation, authorisation checks, rate-limit hooks, CSV export builder, deletion workflow, audit event shape.
- Database roles, `authorised_researchers`, legal-hold / anonymisation columns, append-only audit trigger.
- Cookie session, CSRF, revocation, rate limits, and audit. Production still needs server env (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_JWT_AUD`, `SESSION_SECRET`, `DATABASE_URL`, `DATABASE_CA_CERT`, `SESSION_STORE=database`, `RATE_LIMIT_STORE=database`) before authentication can succeed. A JWT secret is not required.

## What remains disabled

- `COLLECTION_ENABLED`
- `SUBMISSION_ENDPOINT`
- `RESEARCHER_ENDPOINT`
- `RESEARCHER_API_ENABLED`
- `EXPORTS_ENABLED`
- `DELETIONS_ENABLED`

## What requires institutional approval

Lawful basis, consent wording, ethics reference, controller/DPO, recruitment countries, retention and anonymisation periods, processor agreements, transfer safeguards, hosting region, export/deletion policy, and whether the Inquiry Archive (layer 5) may be used at all. Research authentication is Supabase Auth + TOTP MFA; AIM is not a technical dependency.

Until those exist, **do not enable collection** and **do not enable the researcher API**.

## What must never be deployed on GitHub Pages

GitHub Pages can host the **public** static site only. It cannot:

- keep `/researcher/` private
- apply complete HTTP security headers
- hold server-side secrets
- run the submission or researcher APIs
- enforce authentication in front of static files

`noindex`, `robots.txt`, and `X-Robots-Tag` are **crawl hints only**. Anyone who knows the URL can fetch the static HTML/CSS/JS. Those files must continue to hold **no** participant records.

Host the Inquiry Archive and researcher API on a platform that can terminate TLS, set headers, keep secrets server-side, and require authentication **before** HTML is served, preferably as **same-site** `/researcher/` + `/api/researcher`.

## Authorisation model

Role-based, server-side, deny by default:

| Role | Purpose |
| --- | --- |
| *(none)* | Denied |
| `authorised_researcher` | Review aggregates and records, export if policy allows, delete if policy allows |
| `researcher_admin` | Same, plus provisioning/revocation of researcher identities (not a database admin console) |

Provisioning uses an **opaque Supabase Auth subject** (`auth_subject`) in `authorised_researchers`, not a browser check for a person’s name or email. Exactly one active row is expected. Additional active rows cause login to fail closed. Revocation sets `revoked_at` and invalidates sessions. There is no researcher invitation or team-management UI.

Mandatory MFA is enforced by Supabase Auth TOTP and re-checked server-side (`aal2` plus TOTP in `amr`, then `mfa_ok` on the application session). A password-only session is rejected.

## Authentication and sessions

- Individual identity from **Supabase Auth** (email + password + mandatory TOTP). The Inquiry Archive posts credentials to the same-origin researcher API. The API talks to Supabase Auth. Access tokens are verified with `supabase.auth.getClaims()` (JWKS for asymmetric keys; Auth `getUser()` for legacy HS256). The browser does not receive the publishable key, JWT secret, service-role key, or research-table access.
- AIM Microsoft/Entra SSO is **not** a technical authentication dependency.
- Short-lived server sessions (default 20 minutes, hard cap). Opaque session id in a `__Host-` **HttpOnly; Secure; SameSite=Strict; Path=/** cookie.
- Session metadata (role, expiry) is returned by `GET /v1/session` and is **not** a secret. **No access token is stored in `localStorage` or `sessionStorage`.**
- Logout is `POST /v1/session/logout` (server revocation + cookie expiry).
- Session fixation: new session id after authentication.
- Replay/revocation: every protected request looks up the session server-side; revoked users fail closed.
- CSRF: `SameSite=Strict` plus a required `X-CSRF-Token` header on state-changing requests, matching a token from `GET /v1/session`.
- Cache: `Cache-Control: no-store` on all protected API responses and on the archive HTML when hosted behind auth.

## Researcher API rules (normative)

See `api/researcher/SPEC.md` for routes. The implementation **must**:

- require an authenticated authorised-researcher session on every data request
- return only allowlisted DTO fields
- use parameterised queries / SDK binds (no string-concatenated SQL)
- validate filters, pagination, sort fields, export scope, and `resp_…` references
- paginate and cap result size
- rate-limit and fail closed when the limiter cannot operate in production
- return generic errors (`unauthorized`, `forbidden`, `not_found`, `unavailable`, `invalid_request`)
- prevent IDOR by authorising the *action*, not a per-row ACL that leaks existence to strangers
- prevent arbitrary column selection, arbitrary query execution, and unrestricted bulk export
- never send service-role credentials to the client

## Dashboard capabilities (after the API is live)

Allowed: totals, intake trends, aggregate domain/construct scores, item distributions, approved filters, individual review by participant reference, restricted qualitative review, controlled CSV export, deletion by participant reference, retention/anonymisation status.

**Not allowed:** database administration, SQL editor, schema changes, user-management beyond researcher-role revocation, arbitrary table dumps.

## Export, deletion, audit, retention

- CSV export is a privileged API action, policy-gated (`EXPORTS_ENABLED`, default off), MFA session required, approved columns only, formula-injection escaped, count-capped, audit-logged (actor, time, scope, count — **not** answers).
- Deletion by `resp_…` is policy-gated (`DELETIONS_ENABLED`, default off), confirm-step in the UI, server-side validation, legal-hold respected, generic success after a well-formed authorised request (does not disclose whether unrelated IDs exist), audit-logged.
- Audit events: login, failed access, individual-record / qualitative viewing, export, deletion/anonymisation, role changes, significant configuration changes. **Do not put survey answers in logs.**
- Retention period and lawful basis are **not invented here**. Columns exist for later policy (`legal_hold`, `anonymised_at`). Periods remain launch blockers.

## Web security expectations

Protect against broken access control, IDOR, injection, XSS, CSRF, credential leakage, insecure cookies, excessive data exposure, misconfiguration, unrestricted exports, brute-force/login abuse, noisy errors, and cache leakage.

When hosted properly: strict CSP, `frame-ancestors 'none'`, HSTS, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` on private responses, Secure SameSite cookies, CSRF on cookie-authenticated mutations.

GitHub Pages **cannot** provide this control plane for the dashboard.
