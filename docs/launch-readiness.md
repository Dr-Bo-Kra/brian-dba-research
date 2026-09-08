# Launch readiness

This checklist is for a **privacy-hardened** quantitative research platform. Completing engineering items here does **not** make the project legally compliant. Live collection must stay **off** until the institutional blockers below are closed and a documented go-live decision is made.

**Engineering snapshot (re-verified `privacy-security-baseline` HEAD `bcd0283`, 8 Sep 2026):**

| Surface | State |
| --- | --- |
| Live instrument | Quantitative-only; no active qualitative participant flow |
| Submission contract | Rejects qualitative/free-text smuggling; server scoring aligned |
| Inquiry Archive | Quantitative dashboard accepted; export/delete UI session-gated and flag-gated |
| Committed `config.js` | `COLLECTION_ENABLED: false`, empty `SUBMISSION_ENDPOINT` |
| Automated regression | **172/172** pass (`npm test`) |
| Preview | Researcher + submission wiring on branch Preview; Vercel Deployment Protection (SSO) gates Preview URLs |
| Production alias | `https://brian-dba-research.vercel.app` now serves `privacy-security-baseline` (promoted 8 Sep 2026); `COLLECTION_ENABLED: false` verified on Production |
| Production env | Fail-closed **flags** set (`SUBMISSION_API_ENABLED=false`, researcher/export/delete off). **Secrets not yet copied** into Production (owner action — researcher API stays unavailable until secrets + `RESEARCHER_API_ENABLED=true`) |
| Public collection | **OFF** |

**Preview access (required):** open Preview only after Vercel team SSO, or with Automation Protection Bypass that also sets the cookie: `?x-vercel-protection-bypass=…&x-vercel-set-bypass-cookie=true`. Prefer the stable branch alias over ephemeral deployment URLs: `https://brian-dba-research-git-privacy-security-baseline-kay-bee1.vercel.app`.

## Production database strategy (decision)

**Recommendation: reuse the existing Supabase project as Production** after a controlled synthetic purge. Do **not** create a second Production project unless AIM later requires strict Preview/Production data isolation.

| Factor | Assessment |
| --- | --- |
| 48 synthetic Preview responses | Identifiable by reserved `resp_00000000-0000-4000-8000-*` prefix; currently **48/48** rows are synthetic |
| Preview Auth / MFA history | Already proven on this project; roles and FORCE RLS already applied |
| Researcher authorization | Exactly **one** active `authorised_researchers` row (Kranthi test); one older row disabled |
| Least-privilege roles | `researcher_api` and `submission_inserter` verified live |
| Operational complexity | Second project doubles Auth users, CA certs, role passwords, and grant drift risk |
| Clean real-research data | Achieved by **purging synthetics before go-live**, not by splitting projects now |

A separate Production database would be cleaner isolation but is a **material architecture change** — not justified while collection remains off and synthetics are fully removable by prefix.

## Synthetic-data cleanup plan (do not run merely for a green report)

**When:** immediately before Brian Production cutover / live-collection enablement — **after** Production hosts this branch and Production secrets are present, **before** any real participant submit. Keep the 48 Preview rows until then so Preview validation remains reproducible.

**How:**

1. Dry-run: `node scripts/cleanup-synthetic-responses.mjs --dry-run` (inspect via operator URL or `DATABASE_URL` read).
2. Confirm count equals **48** and matches reserved prefix only.
3. Delete: `node scripts/cleanup-synthetic-responses.mjs --confirm-synthetic-cleanup` using local gitignored `SYNTHETIC_OPERATOR_DATABASE_URL` only.
4. Prove zero synthetics: re-run dry-run / count query → `synthetic_count = 0` and `total` reflects only real rows (expected **0** before first live submit).
5. Remove elevated operator URL from local `.env.synthetic.local` after cleanup. Never put it in Vercel, browser assets, or git.

## Researcher cutover (prepared — do not execute yet)

**Current verified state:** one active authorised researcher (`researcher_admin`, subject prefix `3be64676…`, created 2026-09-01) — Kranthi test. One prior row disabled (`d16e2209…`). Brian is **not** activated.

**Exact safe transactional cutover** (Supabase SQL editor / elevated operator only — `researcher_api` cannot mutate the directory):

```sql
-- Run only after Brian's Supabase Auth user exists and Brian has enrolled HIS own TOTP.
-- Replace <BRIAN_AUTH_SUBJECT> with the immutable Auth user id (do not guess).
begin;

update public.authorised_researchers
   set disabled_at = coalesce(disabled_at, now())
 where revoked_at is null
   and disabled_at is null;

insert into public.authorised_researchers (auth_subject, role, mfa_required)
values ('<BRIAN_AUTH_SUBJECT>', 'researcher_admin', true);

-- Must return exactly 1
select count(*)::int as active_count
  from public.authorised_researchers
 where revoked_at is null
   and disabled_at is null;

commit;
```

Then: revoke leftover Kranthi sessions if any; Brian signs in on Production with password + **his** TOTP; set `EXPORTS_ENABLED=true` and `DELETIONS_ENABLED=true` on Production researcher env only. Do **not** enable collection in this step.

## Governance blockers (block live collection)

| Blocker | Current state |
| --- | --- |
| Sponsoring university and legal data controller | Not named in the privacy notice |
| Privacy / DPO contact | Not named |
| Ethics approval and reference | Not recorded (proposal ref DBA 2027-10384 is not an ethics approval id) |
| Brian participant-facing institutional email | Not supplied — LinkedIn remains published contact |
| Countries where participants will be recruited | Not confirmed |
| Lawful basis and consent wording approved by the institution | On-page checkboxes are a research-consent record only |
| Retention and anonymisation periods | Agreed: 12 months after research completion; surface for review; no auto-delete. Confirm AIM does not mandate a different period. `STUDY_COMPLETION_DATE` still to be set at study end |
| Hosting / database region | Singapore hosting approved |
| Processor agreements and international-transfer safeguards | TBD (AIM) |
| Incident contacts | Researcher: Brian via LinkedIn until institutional email; controller/DPO TBD |
| Controlled CSV export, deletion-by-reference, retention, and audit practice | Workflows implemented; `EXPORTS_ENABLED` / `DELETIONS_ENABLED` stay false until Brian Production cutover |
| Institutional approval to use the Inquiry Archive as the live results interface | Preview-proven; Production use not approved |

## Technical readiness (engineering)

| Capability | State |
| --- | --- |
| Public survey + consent gate | Ready (collection kill-switch off) |
| Protected submission endpoint | Ready / fail-closed — Preview proven; Production `SUBMISSION_API_ENABLED=false` |
| Validation, server-side scoring, durable rate limits | Ready in code |
| Database RLS / privilege revocation | Verified live — FORCE RLS on research tables; `anon`/`authenticated` have no `assessment_responses` grants |
| `researcher_api` | Least privilege verified (SELECT responses/directory; no table DELETE; no BYPASSRLS). `EXECUTE` on `delete_assessment_by_reference` restored 8 Sep 2026 |
| `submission_inserter` | Column-level INSERT only on assessment columns; no SELECT/UPDATE/DELETE; cannot execute deletion RPC |
| Researcher Auth + TOTP MFA + sessions/logout | Ready on Preview when durable stores are set |
| Researcher authorization | Deny-by-default; sole-active-row model. Brian cutover **not** performed |
| Inquiry Archive (quantitative) | Ready on Preview; free-text UI removed from current-study workspace |
| Exports / deletions | Implemented; flags false until Brian cutover |
| Secrets / configuration | Preview secrets in Vercel (branch-scoped). Production flags set; Production secrets **pending owner copy**. Never in browser files |
| Custom / final URL | Clean Production URL: `https://brian-dba-research.vercel.app` (no custom DNS). Prefer this over long Preview URLs for Brian |
| Production deployment | Promoted from `privacy-security-baseline` (8 Sep 2026). Do not merge `main` for this cutover. Production secrets still pending |

## Not an initial-collection blocker

| Item | Current state |
| --- | --- |
| Protected researcher API for `researcher/` | Same-origin `/api/researcher` on Vercel Node. Requires Production secrets + `RESEARCHER_API_ENABLED=true`; collection/export/delete stay off until their steps |
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

## Production smoke-test plan (collection remains OFF)

After Production secrets are present, with `COLLECTION_ENABLED` false and `SUBMISSION_API_ENABLED=false`:

1. Open `https://brian-dba-research.vercel.app` — TLS valid; survey loads; consent gate present; no free-text stage.
2. Confirm committed/served `config.js` still has `COLLECTION_ENABLED: false` and empty `SUBMISSION_ENDPOINT`.
3. `POST /api/submission` returns disabled/unavailable (not 200 accept).
4. Open `/researcher/` — sign-in + TOTP (Kranthi test until cutover) reaches Inquiry Archive.
5. Summary/ledger show quantitative fields only; Administration export/delete remain disabled while flags false.
6. Anonymous `/api/researcher/v1/summary` (no cookie) returns no records.
7. Confirm synthetic count still as expected (48 until purge) via authorised path or operator dry-run — not via public routes.

### Single controlled participant submission (activation procedure only — not now)

When go-live is approved: set Production `SUBMISSION_API_ENABLED=true` → set browser `COLLECTION_ENABLED=true` with HTTPS same-origin `SUBMISSION_ENDPOINT` → one real or labelled pilot submit → researcher verifies one ledger row → monitor rate-limit/audit → only then open recruitment.

## Go-live sequence (after governance blockers close)

1. Record controller, DPO, ethics reference, recruitment countries, lawful basis, and approved notice text in `privacy.html`.
2. Complete the institutional DPIA; replace the screening record.
3. Owner: copy Preview server secrets into Production; keep `SUBMISSION_API_ENABLED=false` until go-live; set `RESEARCHER_API_ENABLED=true` only when Auth/MFA/DB URLs are present.
4. Confirm Production still serves `privacy-security-baseline` at `https://brian-dba-research.vercel.app` (already promoted; re-deploy if needed). Do not merge `main` solely for this cutover.
5. Run synthetic cleanup; prove zero synthetic rows.
6. Cut over to Brian as the sole active `authorised_researchers` row; enroll **his** TOTP; disable test researchers.
7. Set `EXPORTS_ENABLED=true` and `DELETIONS_ENABLED=true` on Production researcher env only.
8. Disable Vercel Deployment Protection on the **public** Production hostname if it would block participants (survey must be reachable). Researcher data remains behind app MFA.
9. Keep `COLLECTION_ENABLED` false until a documented go-live decision. Then: server `SUBMISSION_API_ENABLED=true` → browser `COLLECTION_ENABLED=true` with HTTPS `SUBMISSION_ENDPOINT` → smoke → researcher verify → monitor.
10. Inquiry Archive uses `RESEARCHER_ENDPOINT: '/api/researcher'`. Do not host it on GitHub Pages.

## Explicit non-goals for this launch

- Do not describe the site as GDPR-, DPDP-, or otherwise legally compliant
- Do not add public analytics, Google Fonts, or inline event handlers
- Do not put secrets in browser files
- Do not open a public results page on `index.html`
- Do not describe `noindex` or `robots.txt` as access controls
- Do not hard-code Brian’s name or email as an application access check
- Do not enable public collection, merge to `main`, change Production/DNS, or activate Brian without an explicit owner decision
