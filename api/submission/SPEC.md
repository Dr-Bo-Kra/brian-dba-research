# Protected participant submission API specification

**Status:** Implemented scaffold. Fail-closed until `SUBMISSION_API_ENABLED=true`, a valid `SUBMISSION_DATABASE_URL` for the `submission_inserter` role, durable `SUBMISSION_RATE_LIMIT_STORE=database`, and the browser dual kill switch (`COLLECTION_ENABLED` + HTTPS `SUBMISSION_ENDPOINT`) are deliberately enabled after institutional approval. Not enabled in committed config. Collection remains OFF.

This API is layer 2 in `docs/researcher-dashboard-architecture.md`. Browser files must never contain its credentials.

## Route

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/submission/health` | No | Liveness. No secrets. No data. |
| POST | `/api/submission` | No (origin + rate-limited) | Validate and insert one assessment response. |
| OPTIONS | `/api/submission` | Origin allowlist | Restrictive CORS preflight only. |

Same-site with the public survey on Vercel Node.js 20, not Edge. Nested paths rewrite to `api/submission/index.mjs`.

## Dual kill switch

1. **Browser:** `COLLECTION_ENABLED === true` and a credential-free HTTPS `SUBMISSION_ENDPOINT` that is not `/rest/v1/` (see `script.js`). Committed `config.js` keeps both false/empty.
2. **Server:** `SUBMISSION_API_ENABLED=true` **and** `SUBMISSION_DATABASE_URL` for `submission_inserter` **and** `SUBMISSION_RATE_LIMIT_STORE=database`. Otherwise every mutating request returns `unavailable`.

There is no production in-memory rate-limit or store fallback.

## Request rules

- `POST` + `Content-Type: application/json` only
- Body size cap (`SUBMISSION_MAX_BODY_BYTES`, default 48 KiB)
- Same-origin / allowlisted `Origin` (or Referer origin); never `Access-Control-Allow-Origin: *`
- Exact top-level keys matching `buildArchivePayload` in `script.js`
- Unknown fields rejected at every nested object (including smuggled `qualitative` / free-text keys)
- `instrument_id` must be `brian-dba-inclusive-lending-desk-v3`
- `responses.instrumentType` must be `quantitative-desk-assessment`
- `client_record_id` must match `^resp_[0-9a-f-]{32,36}$` and must **not** use the synthetic seed prefix `resp_00000000-0000-4000-8000-`
- Profile codes from region / role / experience allowlists (plus other instrument option codes)
- Likert `ITEM_ORDER` integers 1–7 only — no free-text / qualitative answers on the live contract
- Full assessment (domain/overall scores, levels, strongest/weakest, interpretation, summary, playStyle) recomputed from Likert and stored server-side; browser derived values are shape-checked then replaced
- Participant Likert answers and validated profile codes remain client-authored input

## Live instrument scope

**Current live research instrument: quantitative only.** Legacy mixed-methods rows (with qualitative JSON) may still exist in the database and on the protected researcher qualitative endpoint; they are not part of the active submission allowlist.

## Response

Success (including idempotent replay): `{ "ok": true }`

Errors are generic only: `invalid_request` | `forbidden` | `not_found` | `unavailable` | `rate_limited`

## Idempotency

Plain `INSERT` of the validated row. A unique index on `client_record_id` maps Postgres `23505` to the same `{ ok: true }` response. No pre-INSERT `SELECT` for existence. Clients cannot distinguish first write from replay.

## Rate limits and privacy

Durable table `submission_rate_limits` (not researcher tables). Bucket keys are SHA-256 digests of the server-observed connection identity so raw IPs are not stored in that table. Answers, payloads, credentials, tokens, and cookies are never logged.

## Database role

`submission_inserter`: `INSERT` on listed `assessment_responses` columns only, plus rate-limit table use. No `SELECT` / `UPDATE` / `DELETE` on research rows. No grants on researcher tables. No service-role. Schema definitions live in `supabase/schema.sql` and are **not** applied by this repository automatically.

## Synthetic E2E

Tests inject `createSubmissionApp({ allowMemoryStores: true, ... })` or a stub query adapter. There is no public HTTP bypass and no production DI path without explicit overrides.
