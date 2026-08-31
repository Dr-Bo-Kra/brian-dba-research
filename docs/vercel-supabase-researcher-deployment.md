# Vercel + Supabase researcher read-path deployment

This is an integration contract, not an approval and not a deployment. Live
collection stays **off**. Exports and deletions stay **off**. Do not deploy
until the sponsoring university / DPO / legal reviewers say so.

## Architecture

```
Brian's browser
  → Vercel-hosted Inquiry Archive (`/researcher/`)
  → Vercel protected researcher API (`/api/researcher/*`, Node.js runtime)
  → least-privilege `researcher_api` Postgres connection
  → private Supabase survey data
```

The browser never receives a Supabase URL, anon key, service-role key, or
database password. Same-origin is the default design:

- `https://<future-domain>/researcher/`
- `https://<future-domain>/api/researcher/...`

Do not invent the final domain here.

Same-origin benefits: simpler `__Host-` cookies, CSRF on one site, no
researcher CORS surface, a single OIDC redirect URI, and less chance of
credentials leaking across origins.

## Runtime decision

Use the **Vercel Node.js 20** runtime, not Edge.

The existing API needs Node `crypto` HMAC, OIDC/JWT verification, and the
`pg` driver. Edge would force a different client, weaker session primitives,
or a rewrite of auth. That is not justified for this low-volume read path.

## Database connection

`DATABASE_URL` is a **server-only** secret consumed by `pg` inside the Node
function. Prefer the Supabase **transaction pooler** URI (serverless-compatible,
`pgbouncer` transaction mode). A direct Postgres URI is appropriate only for
long-lived processes, not Vercel functions.

The adapter:

- uses parameterised queries only (`$1`, `$2`, …)
- ignores statement names (transaction-mode poolers reject prepared statements)
- rejects URLs that mention `service_role` or `supabase_admin`
- fails closed if the URL is missing or the query fails
- never embeds a hostname, project id, password, or region in source

## Prerequisites

- Institutional decision that Vercel may host the researcher surface
- A Supabase project whose region is approved by the university / DPO
- An IdP that can issue Authorization Code + PKCE with MFA ACR/AMR
- An approved HTTPS origin (custom domain still outstanding)
- Schema applied, including `researcher_api` grants and role-scoped RLS

## Environment variables

### Public / client-safe

Committed `researcher/config.js` keeps `RESEARCHER_ENDPOINT: ''` (disconnected).
When operators intentionally connect the same-origin API they set
`RESEARCHER_ENDPOINT: '/api/researcher'`. That path is not a secret and still
returns no research data without an authenticated session.

Never put secrets in `researcher/config.js`, `config.js`, or any `NEXT_PUBLIC_` /
`VITE_` / `PUBLIC_` variable.

### Server-only (Vercel Environment Variables)

| Name | Notes |
| --- | --- |
| `RESEARCHER_API_ENABLED` | Must be `true` before auth or data. Default off. |
| `DATABASE_URL` | `researcher_api` pooled URI only |
| `SESSION_SECRET` | HMAC for cookies |
| `SESSION_STORE` | `database` |
| `RATE_LIMIT_STORE` | `database` |
| `OIDC_ISSUER` | Undecided IdP |
| `OIDC_CLIENT_ID` | Confidential client |
| `OIDC_CLIENT_SECRET` | Server only |
| `OIDC_REDIRECT_URI` | `https://<future-domain>/api/researcher/v1/session/callback` |
| `OIDC_AUDIENCE` | Optional; defaults to client id |
| `OIDC_REQUIRED_ACR` | MFA claim; required with or instead of AMR |
| `OIDC_REQUIRED_AMR` | MFA claim; required with or instead of ACR |
| `OIDC_LOGOUT_URL` | Optional |
| `TRUSTED_PROXY` | Leave unset/`false` until Vercel is accepted as the TLS terminator. Then `vercel` to read only `x-vercel-forwarded-for`. |
| `AUDIT_STORE_RESEARCHER_IP` | Keep `false` until DPO approval |
| `EXPORTS_ENABLED` | Keep `false` |
| `DELETIONS_ENABLED` | Keep `false` |
| `ALLOWED_ORIGIN` | Leave empty. Never `*` |

See `api/researcher/env.example`.

## Supabase role provisioning

Administrators eventually:

1. Create `researcher_api` as a LOGIN role. Store the password in a secret
   manager. Do not commit it.
2. `GRANT CONNECT` on the database if the platform requires it.
3. Re-apply `supabase/schema.sql` so grants and **researcher_api-only** RLS
   policies exist.
4. Confirm `anon` and `authenticated` have no survey SELECT/INSERT.
5. Confirm FORCE RLS remains. Do not grant `BYPASSRLS`.
6. Create a pooled URI as that role. Put it in Vercel as `DATABASE_URL`.

`researcher_api` may: directory SELECT; research-result SELECT (non-anonymised);
session/auth-state/rate-limit use; expired-session cleanup; audit INSERT.

It may not: change schema, execute `delete_assessment_by_reference`, use the
service-role, or administer the database.

## Vercel project setup (do not perform yet)

1. Create a Vercel project for this repository after institutional approval.
2. Framework preset: Other / no framework. Root is this repo.
3. Set server-only environment variables. Do not expose them to the browser.
4. Confirm function `api/researcher/index.mjs` runs as Node. Nested `/api/researcher/:path*` is rewritten to that function.
5. Confirm `_lib`, `_server`, and `_vercel` are not public routes.
6. Attach the future custom domain only after IT/DPO approval.
7. Register the OIDC redirect URI with the future IdP.
8. Keep `RESEARCHER_API_ENABLED=false` until IdP, MFA, region, and DPO items
   are closed.

## Security headers and CORS

`vercel.json` and API responses set HSTS, CSP, `nosniff`, Referrer-Policy,
Permissions-Policy, frame denial, and `Cache-Control: no-store` on the
researcher surface. `robots.txt` / `noindex` are not access controls.

Protected responses must not be publicly cached. There is no
`Access-Control-Allow-Origin: *`. Same-origin needs no CORS.

## Sessions, rate limits, audit

All three use the same Supabase Postgres adapter. Production has no
process-memory fallback. Session rows hold opaque ids, expiry, revocation,
and MFA flags — not participant answers. Rate-limit categories remain
`login`, `api`, `record`, `qualitative`. Audit rows are metadata only.

On Vercel, client IP is the function socket address unless
`TRUSTED_PROXY=vercel`, which reads only `x-vercel-forwarded-for`. Arbitrary
`X-Forwarded-For` is ignored.

## What must not be done before approval

- Enable `COLLECTION_ENABLED` or fill `SUBMISSION_ENDPOINT`
- Build or connect a participant submission API
- Enable exports or deletions
- Deploy this project to a production Vercel target
- Choose or hard-code a production region
- Invent IdP issuer, client, secret, ACR, or AMR values
- Use a Supabase service-role key
- Give the browser any database credential
- Weaken RLS so anon/authenticated can SELECT survey rows
- Trust `X-Forwarded-For` globally

University / DPO / legal decisions still outstanding: IdP product, MFA
assurance values, geographic region, custom domain, lawful basis, ethics
approval, researcher-IP audit, and go-live.
