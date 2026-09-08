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

The browser never receives a Supabase URL, publishable key, anon key, service-role key, or
database password. Same-origin is the default design:

- `https://<future-domain>/researcher/`
- `https://<future-domain>/api/researcher/...`

Do not invent the final domain here.

Same-origin benefits: simpler `__Host-` cookies, CSRF on one site, no
researcher CORS surface, and less chance of
credentials leaking across origins.

## Runtime decision

Use the **Vercel Node.js 20** runtime, not Edge.

The existing API needs Node `crypto` HMAC, Supabase Auth JWT verification, and the
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
- Supabase Auth with TOTP MFA enabled (no AIM/Entra dependency)
- An approved HTTPS origin (custom domain still outstanding)
- Schema applied, including `researcher_api` grants and role-scoped RLS

## Environment variables

### Public / client-safe

Committed `researcher/config.js` uses `RESEARCHER_ENDPOINT: '/api/researcher'`
(same-origin). That path is not a secret and still returns no research data
without an authenticated MFA session.

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
| `SUPABASE_URL` | Project URL; server uses Auth APIs only |
| `SUPABASE_PUBLISHABLE_KEY` | Server-only Auth apikey (`sb_publishable_…`). Not shipped to the browser. Research tables keep zero anon/authenticated privileges. `SUPABASE_ANON_KEY` is a legacy alias only. |
| `SUPABASE_JWT_AUD` | Optional; default `authenticated`. Tokens are verified with `supabase.auth.getClaims()`. Do not set `SUPABASE_JWT_SECRET` or `SUPABASE_SECRET_KEY` for this login flow. |
| `TRUSTED_PROXY` | Leave unset/`false` until Vercel is accepted as the TLS terminator. Then `vercel` to read only `x-vercel-forwarded-for`. |
| `AUDIT_STORE_RESEARCHER_IP` | Keep `false` until DPO approval |
| `EXPORTS_ENABLED` | Keep `false` until Brian Production cutover (then `true` on researcher API only) |
| `DELETIONS_ENABLED` | Keep `false` until Brian Production cutover (then `true` on researcher API only) |
| `RETENTION_MONTHS` | Default `12`; optional |
| `STUDY_COMPLETION_DATE` | Optional `YYYY-MM-DD`; set when research completes |
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

## Vercel project setup (current)

Project `kay-bee1/brian-dba-research` already exists.

| Target | URL / notes |
| --- | --- |
| Clean Production URL | `https://brian-dba-research.vercel.app` (also `https://brian-dba-research-kay-bee1.vercel.app`) |
| Production path | Promote / `vercel deploy --prod` from `privacy-security-baseline` — **do not** merge `main` for this cutover; **do not** change custom DNS |
| Stable Preview alias | `https://brian-dba-research-git-privacy-security-baseline-kay-bee1.vercel.app` (SSO-protected) |

1. Framework preset: Other / no framework. Root is this repo. Node 20+ (project currently 24.x).
2. Production: keep `SUBMISSION_API_ENABLED=false`, `EXPORTS_ENABLED=false`, `DELETIONS_ENABLED=false` until the documented cutover/go-live steps.
3. Production fail-closed flags are set; **copy Preview secrets into Production** (owner) before enabling `RESEARCHER_API_ENABLED=true`.
4. Confirm function `api/researcher/index.mjs` runs as Node. Nested `/api/researcher/:path*` is rewritten to that function.
5. Confirm `_lib`, `_server`, and `_vercel` are not public routes.
6. Attach a custom domain only after IT/DPO approval (not required for Brian cutover on `*.vercel.app`).
7. Create Brian’s Supabase Auth user, enroll **his** TOTP, then cut over `authorised_researchers` (see `docs/launch-readiness.md`).
8. Never place `SYNTHETIC_OPERATOR_DATABASE_URL`, service-role keys, or operator SQL in Vercel.

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
- Enable `SUBMISSION_API_ENABLED` on Production before go-live
- Enable exports or deletions before Brian cutover
- Merge `main` solely to obtain the Production URL (promote the privacy branch instead)
- Invent a Supabase user id / `auth_subject` without reading it from Auth
- Use a Supabase service-role key
- Give the browser any database credential
- Place `SYNTHETIC_OPERATOR_DATABASE_URL` or other elevated operator credentials in Vercel
- Weaken RLS so anon/authenticated can SELECT survey rows
- Trust `X-Forwarded-For` globally

University / DPO / legal decisions still outstanding: geographic region,
custom domain, lawful basis, ethics approval, researcher-IP audit, and go-live.
AIM is not a technical authentication dependency.
