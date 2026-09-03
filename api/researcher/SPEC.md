# Protected researcher API specification

**Status:** Specification plus implemented read-only researcher path. Production authentication stays fail-closed until Supabase Auth, JWT verification, mandatory TOTP MFA, durable session store, durable rate-limit store, and `researcher_api` database credentials are configured. Not deployed. Not enabled. Not approved for live research access.

This API is layer 4 in `docs/researcher-dashboard-architecture.md`. Browser files must never contain its credentials.

## Deployment constraints

- Same-site with the Inquiry Archive (`/api/researcher` + `/researcher/`) on Vercel Node.js 20, not Edge.
- Thin adapter: `api/researcher/index.mjs` calls shared `createResearcherApp`. Nested `/api/researcher/:path*` requests are rewritten to that function. Helpers live under `_lib` / `_vercel` so they are not public functions.
- Never on GitHub Pages.
- TLS required. Do not invent the production domain.
- Secrets only in the server environment. Browser config may hold `/api/researcher` only.
- Default: `RESEARCHER_API_ENABLED=false`, `EXPORTS_ENABLED=false`, `DELETIONS_ENABLED=false`.
- Export and delete routes exist in the shared app but stay disabled and are not live surfaces.

## Identity

Authentication is **Supabase Auth** with **mandatory TOTP MFA**. The Inquiry Archive posts email, password, and authenticator codes to the Vercel researcher API. The API verifies the Supabase-issued JWT (issuer, audience, expiry, subject, `aal2`, TOTP `amr`) and then looks up `authorised_researchers`. Browser-provided email, role, subject, and MFA flags are ignored for authorization.

After authentication succeeds, the API:

1. Cryptographically verifies the Supabase access token with `supabase.auth.getClaims()` on a server-only client (`SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY`, no session persistence). Asymmetric tokens are verified against the project JWKS; legacy HS256 tokens are accepted only when Auth `getUser()` confirms them. Issuer, audience, expiry, subject, and role are then checked. A JWT secret is not used.
2. Requires MFA assurance (`aal2` and TOTP). Password-only tokens cannot create a researcher session.
3. Looks up `authorised_researchers` by opaque `auth_subject`.
4. Denies the request if there is no active row, `revoked_at` / `disabled_at` is set, or more than one active researcher exists.
5. Creates a server-side session and sets `__Host-dba-researcher` (HttpOnly, Secure, SameSite=Strict, Path=/).
6. Issues a CSRF token for subsequent mutations.

Role comes from the directory table (`authorised_researcher` or `researcher_admin`), not from matching a person’s name or email in application code. AIM / Entra is not used.

## Common headers

**Request (mutations):** `X-CSRF-Token`, `Content-Type: application/json` when a body is sent.

**Response:**

```
Cache-Control: no-store
Pragma: no-cache
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Frame-Options: DENY
Content-Security-Policy: default-src 'none'; frame-ancestors 'none'
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

CORS is same-origin by default. There is no `Access-Control-Allow-Origin: *`.

## Error envelope

Generic messages only:

```json
{ "error": "unauthorized" | "forbidden" | "not_found" | "invalid_request" | "unavailable" | "rate_limited" }
```

Do not include stack traces, SQL, whether a participant reference exists on deletion, or survey content.

## Routes

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | No | Liveness. No configuration secrets. No data. |
| POST | `/v1/session/login` | No (rate-limited) | Email + password to Supabase Auth. `unavailable` if Auth or API disabled. Returns MFA step or an application session. |
| POST | `/v1/session/mfa` | No (rate-limited) | Verify TOTP against the pending Auth ticket; rotate application session. |
| GET | `/v1/session` | Session optional | `{ authenticated, role, expiresAt, csrfToken }` or unauthenticated. Never a raw access token. |
| POST | `/v1/session/logout` | CSRF if cookie present | Revoke session; expire cookies. |
| GET | `/v1/summary` | Authorised researcher | Aggregates for the approved filters. |
| GET | `/v1/responses` | Authorised researcher | Paginated ledger DTOs. |
| GET | `/v1/responses/{ref}` | Authorised researcher | One record DTO. Audit `view_record`. |
| GET | `/v1/responses/{ref}/qualitative` | Authorised researcher | Free-text only when requested. Audit `view_qualitative`. |
| POST | `/v1/exports` | Authorised researcher | CSV of the **approved export schema**. Disabled by default. Audit `export`. |
| POST | `/v1/deletions` | Authorised researcher | Delete by `resp_…`. Disabled by default. Legal hold. Audit `delete`. Generic result. |

No SQL, no arbitrary `columns=` query, no generic `/audit` write from the client, no database-admin routes.

## Query validation

Allowlisted filters: `from`, `to` (ISO dates), `region`, `role`, `experience` (instrument category codes), `q` (participant-reference search only).

Pagination: `limit` (1–50, default 20), `cursor` (opaque, server-issued).

Sort: `created_at` descending only.

`ref` must match `^resp_[0-9a-f-]{32,36}$`.

Unknown fields → `invalid_request`.

## Response DTO (ledger / summary)

Allowlisted fields only, for example:

- `participant_reference`, `accepted_at`, `region`, `role`, `experience`, `orientation`
- summary: `total`, `last_24h`, `mean_orientation`, `last_intake`, `trend[]`, `domains[]`, `items[]`, `retention` (`legal_hold`, `anonymised` counts — no period invented)

Never return `id` (internal UUID) to the browser if `client_record_id` is the participant reference. Never return raw `jsonb` dumps, service metadata, or audit payloads.

## Export schema (approved columns)

`participant_reference,accepted_at,region,role,experience,orientation`

No internal UUID, no JSON blobs, no qualitative text in the default export. Formula-injection prefixes (`=`, `+`, `-`, `@`, tab, CR) are escaped. `MAX_EXPORT_ROWS` applies. Requesting more is `invalid_request`.

## Deletion body

```json
{ "reference": "resp_…", "confirm": true }
```

If deletions are disabled, legal hold applies, or the API is disabled: `unavailable` or `forbidden`. After a well-formed authorised request while deletions are enabled: generic `{ "ok": true }` whether or not a row existed.

## Rate limits (scaffold defaults)

- Login/start/callback: strict per-IP cap.
- Authenticated reads: per-session cap.
- Export/delete: stricter cap.

Production must use a durable limiter (gateway or shared store). An in-memory Map is not sufficient across instances.

## Fail-closed behaviour

If `RESEARCHER_API_ENABLED` is not `true`, or database/session/Supabase Auth/durable-store configuration is missing, or a query adapter is not injected, authentication and data routes return `unavailable` and empty bodies. `SESSION_STORE=memory` and `RATE_LIMIT_STORE=memory` are ignored. The UI must show zero records.

MFA login uses a short-lived `__Host-dba-auth-tx` SameSite=Strict ticket cookie plus an encrypted server-side Auth bootstrap. It is not a session and cannot read research data. The authenticated session cookie remains `__Host-dba-researcher` SameSite=Strict.

See `docs/researcher-production-dependencies.md`.
