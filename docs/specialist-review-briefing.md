# Specialist review briefing

**Project:** Brian E Pereira DBA research proposal site and Inclusive Lending Desk
**Workspace:** local research repository (path not recorded)
**Branch:** `privacy-security-baseline`
**Briefing date:** 28 August 2026
**Notice version aligned to:** 28 August 2026 (`privacy.html`, `config.js`)

This file is a standalone briefing for an independent specialist (privacy, security, research ethics, or product). It summarises what is in the repository. It is not a legal opinion, a DPIA, or an ethics approval.

---

## 1. How to use this briefing

**Audience.** A reviewer who has not seen prior chat history and should not need it.

**What to review.** The public static site, the Inclusive Lending Desk survey, the privacy notice, the intended (not yet deployed) collection architecture, the database schema, the private Inquiry archive UI, the working privacy documents, and the automated checks.

**How to work.** Use this briefing as a map. Then read the source documents and files listed here. Do not treat quotations in this briefing as a substitute for the files themselves.

**What not to assume.**

- Do not assume the project is legally compliant, GDPR-compliant, DPDP-compliant, ethics-approved, or production-ready for live research collection.
- Do not assume a live database, submission API, or researcher API exists. Those are designed in schema and client code. They are not deployed.
- Do not assume GitHub Pages applies the HTTP security headers in `_headers` or `vercel.json`. It does not apply them fully.
- Do not assume `noindex` or `robots.txt` restrict access to `researcher/` files. They are crawl hints only.
- Do not assume uncommitted files are published. This branch still contains uncommitted and untracked work (see §2).

**Live collection.** Leave `COLLECTION_ENABLED` false. Do not add secrets, anon keys, or service-role keys to any browser file.

---

## 2. Project snapshot

The repository is a **responsive static website** for the June 2026 DBA research proposal *Exploring Organizational Adoption of Alternative Creditworthiness Models for Inclusive Lending* (proposal reference **DBA 2027-10384**). Substantive research claims, questions, methods, and sample sizes are intended to follow `Brian RP V1.5.docx`. The public page labels the work as a **proposal** so planned methods are not mistaken for completed findings.

The interactive instrument is the **Inclusive Lending Desk** (`brian-dba-inclusive-lending-desk-v3`): a vignette-based mixed-methods desk activity for lending professionals. After consent, the participant completes demographics, a standardised borrower vignette, Likert items, and free-text reflections, then receives a local “lending-instinct profile.”

**Current git state (as of this briefing).**

| Item | State |
| --- | --- |
| Branch | `privacy-security-baseline` (do not merge) |
| HEAD | `bda584f` — same tip as `main` (“Reorder ethics and impact above the Play challenge, and drop the keywords box.”) |
| Live collection | **Disabled.** `config.js` has `COLLECTION_ENABLED: false` and `SUBMISSION_ENDPOINT: ''`. |
| Researcher API | **Not configured.** `researcher/config.js` has `RESEARCHER_ENDPOINT: ''`. |
| Commit / push / merge | Not requested at briefing time. Work remains uncommitted on this branch. |

**Uncommitted work on this branch (preserve it).**

Modified tracked files:

- `.gitignore`, `README.md`, `config.example.js`, `config.js`, `index.html`, `script.js`, `styles.css`, `supabase/schema.sql`

Untracked (present on disk, not in `HEAD`):

- `.github/`, `SECURITY.md`, `_headers`, `docs/`, `privacy.html`, `researcher/`, `robots.txt`, `tests/`, `vercel.json`

The privacy-hardening work, Inquiry archive, tests, and this briefing therefore exist in the working tree. A reviewer checking only the last commit on GitHub will not see them.

**Public URL (when published):** [https://dr-bo-kra.github.io/brian-dba-research/](https://dr-bo-kra.github.io/brian-dba-research/). GitHub Pages can host the public static files. It cannot authenticate `researcher/` and cannot fully apply HTTP security headers.

---

## 3. Important framing

Describe this project as **privacy-hardened** and **blocked from live collection** pending:

1. institutional and legal approval (controller, ethics, lawful basis, recruitment geography, retention, processors, transfers); and
2. missing deployment details (protected submission endpoint, authorised-researcher dashboard access).

Do **not** describe it as:

- legally compliant
- GDPR-compliant (or compliant with any other data-protection statute)
- ethics-approved
- production-ready for live research collection

The working DPIA file is a **draft screening record**, not a signed institutional DPIA. Retention periods and incident contacts are **TBD**. On-page checkboxes record **research-participation consent**; they are not a substitute for the institution’s documented lawful basis.

The public ethics card on `index.html` now states that data protection is a design requirement and that live collection stays off until institutional approval. It does **not** claim GDPR compliance.

---

## 4. Intended architecture

The **intended** path (documented in `README.md`, `SECURITY.md`, and `supabase/schema.sql`) is:

```
Participant browser (consent + activity)
        │  HTTPS POST of a validated JSON payload
        ▼
Protected submission endpoint
  • allowlisted Origin
  • schema and size checks
  • rate limiting / abuse controls
  • server-side credential
        │
        ▼
Private Supabase database (RLS forced; no anon / public SELECT)
        │
        ▼
Authorised researcher access through the authenticated Supabase dashboard
(initial release; role-based identities; Brian may be the only provisioned researcher at first)
```

A later, separately approved path may add a protected researcher API and the Inquiry archive (`researcher/`). That path is **not** the initial-release results interface.

**What exists today versus what is a plan.**

| Layer | Status |
| --- | --- |
| Public HTML/CSS/JS, consent gate, local survey | Implemented in the working tree |
| Browser config with collection off | Implemented (`config.js`) |
| Database schema with forced RLS and privilege revocation | SQL file only (`supabase/schema.sql`). Not evidence of a live database. |
| Protected submission endpoint | **Not deployed.** Client refuses collection unless `COLLECTION_ENABLED === true` and the URL is HTTPS, credential-free, and not `/rest/v1/`. |
| Initial results interface | **Authenticated Supabase dashboard** (not deployed). Role-based authorised-researcher access. |
| Inquiry archive UI | Future interface only. Static files under `researcher/`. Disconnected. Holds no records. |
| Realtime channel on the table | Explicitly not to be published. Client uses authenticated polling only, and polling is inactive until the API exists. |

The public browser must never hold a database anon key, service-role key, or other secret. It must never insert or read rows through a public table API (`/rest/v1/...`). The Inquiry archive is a future UI only and is not linked from the public survey.

Until the endpoints and institutional items in §11 are approved, responses remain in the participant’s **browser tab only** (`sessionStorage`).

---

## 5. Public site files and what they do

### `index.html`

Public research proposal page plus the Inclusive Lending Desk.

- Sections: challenge, integrated framework, theory, three-paper method, research questions, ethics, impact, survey (“Play”), researcher bio, footer.
- Consent gate (`#participant-gate`) before the survey shell (`#survey-shell`, `hidden` until both checkboxes are confirmed). Continue button `#survey-consent-continue` starts disabled.
- Links to `privacy.html`. Does **not** link to `researcher/`.
- CSP **meta** tag: `script-src 'self'`; `connect-src 'self'`; **no** `frame-ancestors`; **no** `supabase.co`; **no** Google Fonts URL.
- `referrer` meta: `no-referrer`.
- Skip link, primary nav, LinkedIn CTAs via `data-linkedin` (URL from `config.js`).
- Loads `config.js` then `script.js`. No inline event handlers (`onclick=`).
- Proposal disclaimer in the method section: planned methods are not reported findings.
- Ethics card 04 describes data protection as a design requirement and states that live collection stays off until institutional approval. It does **not** claim GDPR compliance.

### `privacy.html`

Participant-facing notice, **version 28 August 2026**.

- Banner: “Protected research collection is currently disabled.”
- CSP meta: `script-src 'none'`; `connect-src 'none'`. No scripts on this page.
- States that the university, controller, DPO, ethics reference, retention, region, and transfer mechanism are **not yet inserted**.
- Describes intended payload categories and what is **not** intended (name, email, user-agent, IP, page URL).
- Distinguishes research-participation consent from the institution’s lawful basis.
- Return link: `index.html#survey`.

### `script.js`

Public application logic.

- Mobile nav, tab panels, LinkedIn CTA wiring, Inclusive Lending Desk.
- Consent: both checkboxes required; records `privacyNoticeVersion`, `consentedAt`, eligibility and voluntary flags in memory; `hasValidConsent()` gates start; reset calls `returnToConsentGate()`.
- Collection: `archiveConfigured` is true only if `COLLECTION_ENABLED === true` **and** `isProtectedSubmissionEndpoint()` accepts the URL (HTTPS, no embedded credentials, path must not contain `/rest/v1/`).
- Storage: writes the latest result to `sessionStorage` key `brian-dba-survey-latest`; purges legacy `localStorage` keys (`purgeLegacyLocalData`, prefix `brian-dba-`); never `localStorage.setItem`.
- Payload builder (`buildArchivePayload`) sends instrument id, participant reference (`resp_…`), profile, responses, assessment, notice version, consent timestamp. No `userAgent`, `user_agent`, `page_url`, `location.href`, or `navigator.` collection.
- Geography is a **regional category** select, not free-text location.
- Fetch (only if configured): `POST` JSON, `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`. On success, local survey data is purged. Today this path does not run because collection is off.
- Reset: “Delete local data and restart” purges storage and returns to the consent gate.

### `styles.css`

Shared visual system for the public site and, via reuse, the Inquiry archive. Colour, type (Manrope / DM Sans **family names only** — no Google Fonts stylesheet), spacing, survey/desk UI, results radar, consent gate, and responsive rules. Fonts are expected from the participant’s operating system, not a third-party font CDN.

### `config.js`

Public browser configuration. **Must never contain credentials.** Current values:

```js
COLLECTION_ENABLED: false
SUBMISSION_ENDPOINT: ''
PRIVACY_NOTICE_VERSION: '2026-08-28'
LINKEDIN_URL: 'https://www.linkedin.com/in/brianpereira/'
```

### `config.example.js`

Documented template of the same object. Comments state that `SUBMISSION_ENDPOINT` must be a protected HTTPS API (origin checks, validation, size limits, abuse controls, server-side insert) and that collection stays false until institutional items are approved. Example comment URL is a function-style path, not a `/rest/v1/` table URL.

---

## 6. Privacy and security controls already implemented

These are **engineering controls in the working tree**. They reduce risk. They do not complete legal or ethics review.

| Control | Where | Notes |
| --- | --- | --- |
| Consent gate | `index.html`, `script.js` | Two checkboxes; continue disabled until both are checked; survey shell hidden until then. |
| Reset returns to consent | `script.js` `returnToConsentGate` | Unchecks boxes, clears in-memory consent, hides survey shell. |
| `sessionStorage` only for latest result | `script.js` | Key `brian-dba-survey-latest`. |
| `localStorage` purge | `script.js` | Removes `brian-dba-*` keys; no `localStorage.setItem`. |
| No UA / page URL / precise geography in research payload | `script.js`, `supabase/schema.sql` | Regional category only; schema drops `user_agent` and `page_url` if present. |
| No anon Supabase key | browser files + tests | Tests reject `SUPABASE_ANON_KEY`, `service_role`, and JWT-like `eyJ…` blobs. |
| No `/rest/v1` insert | `script.js`, `researcher/dashboard.js` | Endpoint helpers reject that path. |
| Collection disabled unless HTTPS protected endpoint | `config.js`, `script.js` | Both flag and URL checks required. |
| No inline handlers | HTML | Tests assert no `onclick=`. |
| No Google Fonts / analytics requests | HTML, CSS, privacy notice | Family names only; no `fonts.googleapis`; no analytics scripts. |
| CSP meta | `index.html`, `privacy.html`, `researcher/index.html` | Fallback for hosts without headers. **`frame-ancestors` is omitted from meta** because browsers do not enforce it there. |
| GitHub Pages header limits | `SECURITY.md`, `_headers`, `vercel.json` | Pages cannot fully apply HTTP security headers. `frame-ancestors 'none'`, `X-Frame-Options`, `Referrer-Policy`, `X-Content-Type-Options`, `Permissions-Policy`, and researcher `X-Robots-Tag` are defined for Netlify/Cloudflare (`_headers`) and Vercel (`vercel.json`) only. |
| Secrets hygiene | `.gitignore`, comments | Ignores `.env`; comments forbid committing keys. `config.js` is committed (or intended to be) **with collection off and empty endpoint**. |

**Residual risks the controls do not remove.**

- Hosting and network operators may still process ordinary connection logs (IP, user-agent at the HTTP layer).
- Free-text fields can still contain identifiers if a participant types them.
- CSP meta is not a substitute for HTTP headers; clickjacking protection is **not** claimed on GitHub Pages.
- Static `researcher/` files are world-readable if hosted on GitHub Pages; privacy of that workspace depends on a host that can authenticate every request. The files themselves hold no records.

---

## 7. Database (`supabase/schema.sql`)

This is a **migration script to apply before any collection is enabled**. It is not proof that a project database exists or that the script has been run.

**`public.assessment_responses`**

- Columns: `id` (uuid), `created_at`, `instrument_id`, `client_record_id`, `profile` / `responses` / `assessment` (jsonb), `privacy_notice_version`, `consented_at`.
- Drops `user_agent` and `page_url` if they exist.
- Unique index on `client_record_id` where not null; indexes on `created_at` and `instrument_id`.
- Constraints (`NOT VALID` so historical rows would not block migration; new rows are still checked):
  - `instrument_id = 'brian-dba-inclusive-lending-desk-v3'`
  - `client_record_id ~ '^resp_[0-9a-f-]{32,36}$'`
  - consent required (`consented_at` not null; notice version length 1–40)
  - payload size caps: profile ≤ 12 000, responses ≤ 60 000, assessment ≤ 24 000 octets of text
- `ENABLE` and **`FORCE`** row-level security.
- Drops former policies: `anon_insert_assessment_responses`, `anon_select_assessment_responses`, `authenticated_select_assessment_responses`.
- `REVOKE ALL` from `anon` and `authenticated`.
- **No `CREATE POLICY`.** No public SELECT or INSERT.

**`public.researcher_audit_events`**

- Present. Columns: `id`, `occurred_at`, `actor_id`, `action`, `participant_reference`, `detail` jsonb.
- Forced RLS; privileges revoked from `anon` and `authenticated`.
- Comments reserve it for a later researcher API; initial-release review uses the authenticated dashboard and processor logs.

Schema comments instruct: do not add PostgREST read/insert policies; do not publish a Realtime channel; browsers never SELECT or INSERT these tables; initial researcher review is the authenticated Supabase dashboard with a role-based authorised-researcher model.

---

## 8. Inquiry archive (`researcher/`) — future interface only

A **future** researcher UI that reuses the public visual system (`../styles.css` + `researcher/dashboard.css`). It is **not** the initial-release or production results interface.

**Access and discovery**

- Path: `/researcher/` (local: `http://localhost:5500/researcher/`).
- **Not linked** from the public survey (`index.html` has no `researcher/` href).
- `meta name="robots" content="noindex, nofollow"`; `robots.txt` disallows `/researcher/`; `_headers` / `vercel.json` set `X-Robots-Tag` for that path on hosts that honour them.
- Those crawl hints are **not access controls**. Anyone who knows the URL can fetch the static files. The files hold no participant records.
- Copy: future interface, disconnected, role-based authorised researchers. No “Brian-only” identity check in application code.
- **No service-role key in browser files.** Future sessions are HttpOnly cookies from the API. The UI does not store tokens in `localStorage` or `sessionStorage`.
- Stays disconnected until a protected researcher API is implemented (not merely scaffolded), MFA identity exists, institutional approval is granted, and a host can protect the route. GitHub Pages cannot.

**UI features (implemented as empty/disconnected states today)**

| Feature | DOM / behaviour |
| --- | --- |
| KPIs | Accepted responses, last 24 hours, mean orientation, last intake — render as zero / “—” without records |
| Live activity | Recent intake list + empty copy |
| Trends | Arrival-rhythm chart frame |
| Filters | Date range, broad geography, position category, lending experience, search (participant reference or role words) |
| Domain scores | Five research domains (psychometric, social, behavioral, readiness, inclusive decision) |
| Item distributions | Likert items B1–F25 |
| Record ledger | Table of reference, accepted time, region, role, experience, orientation |
| Qualitative viewer | Hidden until `#reveal-reflections` is checked |
| CSV export | Disabled without an authenticated API session; requests `POST /v1/exports`; no client-side public dump |
| Delete by participant reference | `resp_…` format + confirmation; `POST /v1/deletions`; disabled without session and until policy is enabled |
| Auth gate | “Sign in with authorised identity” (OIDC start). No password field, no mock login |
| Empty / disconnected / loading / error | `showDisconnectedWorkspace()` is the current default |

**Client expectations of a future API (scaffolded, disabled)**

- `GET /v1/session/start` — redirect to MFA IdP (unavailable until configured)
- `GET /v1/session` — `{ authenticated, role, expiresAt, csrfToken }` with credentials included
- `GET /v1/summary` and `GET /v1/responses` — allowlisted DTOs only
- `POST /v1/exports` and `POST /v1/deletions` — policy-gated, CSRF-protected
- Endpoint must be HTTPS or same-origin `/api/researcher`, credential-free in the URL, and not `/rest/v1/`

**Hosting constraint.** GitHub Pages cannot keep this workspace private. Static files would be world-readable. Deploy only where the researcher API can reject unauthenticated data requests. The static UI still holds no participant records.

---

## 9. Docs already in the repo (read these as source documents)

| File | What it is | What it is not |
| --- | --- | --- |
| [`README.md`](../README.md) | Project overview, architecture, local preview, publish notes, config tables, payload design, Inquiry archive behaviour, schema summary, tests, blocker list | A compliance certificate |
| [`SECURITY.md`](../SECURITY.md) | Security model, what the repo hardens, archive controls, CSP/header limits, vulnerability reporting via LinkedIn until a DPO is named | Completed institutional security assurance |
| [`docs/data-protection-impact-assessment.md`](data-protection-impact-assessment.md) | Working DPIA **screening record**: purpose, current vs intended processing, categories, unresolved controller/geography/transfers, residual risks | A signed DPIA or lawful-basis determination |
| [`docs/data-retention-and-incident-response.md`](data-retention-and-incident-response.md) | Intended stores, anonymisation/deletion by participant reference, draft incident steps | An approved retention policy; all periods and contacts are **TBD** |
| [`docs/launch-readiness.md`](launch-readiness.md) | Blocker table, engineering already present, go-live sequence, explicit non-goals | Permission to enable collection |
| [`privacy.html`](../privacy.html) | Participant-facing notice (versioned) | Complete institutional notice |

The README states: these documents support a privacy-hardened demonstration. They do **not** replace institutional legal review, ethics approval, or a completed DPIA signed by the controller.

---

## 10. Tests and CI

**Tests:** `tests/privacy-security.test.mjs` — **10** static tests (Node’s test runner). They read files and assert patterns; they do not hit a live API.

1. Consent and privacy notice exist
2. Collection defaults to disabled
3. No Supabase anonymous key or direct REST table endpoint in browser code
4. No user-agent or page URL is collected
5. `sessionStorage` is used and `localStorage` is only purged
6. CSP and privacy links exist without HTTP-only `frame-ancestors` in meta
7. Database RLS and privilege revocation with no public SELECT
8. Inquiry archive is a disconnected future workspace without secrets
9. Documentation names launch blockers and does not claim legal compliance
10. Repository has CI workflow and deployable security headers

**CI:** `.github/workflows/checks.yml`

- Triggers: `push`, `pull_request`
- Runner: `ubuntu-latest`, Node 20
- Commands: `node --check script.js` then `node --test tests/*.test.mjs`
- Does **not** currently `node --check` `researcher/dashboard.js`

Local equivalent (from README):

```bash
node --check script.js
node --test tests/*.test.mjs
```

On Windows PowerShell, if the glob does not expand, run `node --test tests`.

**Headers files**

- `_headers` — Netlify / Cloudflare Pages style; includes `frame-ancestors 'none'` and `/researcher/*` `X-Robots-Tag`
- `vercel.json` — same header set for Vercel

**GitHub Pages cannot fully apply these HTTP security headers.** Reviewers should treat meta CSP as a partial fallback only.

---

## 11. Unresolved launch blockers

Do not enable live collection until the institution has confirmed **all** of the following. These are explicit; they are not residual footnotes.

1. **Sponsoring university and legal data controller** — not named in the privacy notice.
2. **Privacy / DPO contact** — not named.
3. **Ethics approval and reference** — not recorded.
4. **Countries where participants will be recruited** — not confirmed (the proposal text mentions South and Southeast Asia; that is not an institutional recruitment decision).
5. **Lawful basis and consent wording approved by the institution** — on-page checkboxes are a research-consent record only.
6. **Retention and anonymisation periods** — TBD in notice and retention draft.
7. **Hosting / database region** — TBD.
8. **Processor agreements and international-transfer safeguards** — TBD.
9. **Protected submission endpoint, abuse protection, rate limiting, and incident contacts** — not deployed; client keeps collection disabled.
10. **Authorised-researcher identities and roles** on the authenticated Supabase dashboard (MFA, least privilege, no public SELECT) — not provisioned. Brian may be the only provisioned researcher initially; this is not a hard-coded identity check.
11. **Controlled dashboard export, deletion-by-reference, retention, and audit practice** — operational procedure not yet approved.

The Inquiry archive API and a host that can protect `/researcher/` are **future-interface** items, not initial-collection blockers. `noindex` / `robots.txt` are crawl hints, not access controls.

See `docs/launch-readiness.md` for the same list in table form and a proposed go-live sequence **after** blockers close.

---

## 12. Suggested specialist review questions

### Privacy

- Is research-participation consent on `index.html` clearly separated from a documented lawful basis for each recruitment country, once those countries exist?
- Does `privacy.html` say enough — and not too much — given that collection is off and controller/DPO/ethics/retention fields are empty?
- Are regional categories plus free-text reflections an acceptable minimisation design, or is free-text still too likely to contain identifiers?
- Should withdrawal-by-`resp_…` reference be treated as adequate before anonymisation, and what happens after irreversible anonymisation?
- Does the public ethics card still over-claim protection, or is the current “design requirement / collection stays off” wording sufficient?
- Is LinkedIn an acceptable interim contact channel for privacy and security reports?

### Security

- Is refusing `/rest/v1/` and omitting anon keys sufficient, or could a future operator re-enable a public table path by mistake? What operational control prevents that?
- Are CSP meta tags acceptable for a GitHub Pages demonstration, given that `frame-ancestors` is not enforced there?
- When collection is enabled, who updates `connect-src` (meta **and** HTTP headers) to a single allowlisted origin?
- The Inquiry archive no longer collects a password. Sign-in is an OIDC start against the protected researcher API. Is that the right identity source for the institution?
- Researcher sessions are designed as HttpOnly cookies; participant survey copies remain in `sessionStorage`. Is that split the right trade-off?
- GitHub Pages would expose `researcher/` static files. That is a future-interface issue. Initial-release review is the authenticated Supabase dashboard. Crawl hints are not access controls.
- In-memory rate limiting and session maps in the API scaffold are not production-safe across instances. What durable stores will the institution require?

### Research ethics

- Is a game-like “Play the challenge” framing compatible with informed consent for lending professionals?
- The desk produces a named “play style” and domain scores. Could participants reasonably (and wrongly) treat that as a professional assessment, credit score, or institutional decision? The disclaimer exists; is it prominent enough?
- Paper 2 sample (200–300) and Paper 3 interviews (15–20) are proposal numbers. Does the web instrument match the protocol the ethics committee will see?
- Ethics page copy mentions anonymised identities and “removal of recordings after transcription” (interview methods). The web survey has no recordings. Is that mismatch confusing?
- Eligibility is self-asserted (“18+ and professional capacity”). Is that enough?

### UX and accessibility

- Can a keyboard and screen-reader user complete consent, the desk, results, download, and reset?
- `prefers-reduced-motion` is respected in CSS and sampled in JS. Is motion elsewhere still excessive?
- Likert scales and the desk UI: are labels, errors, and progress announced?
- The Inquiry archive qualitative reveal is a checkbox. Is that an adequate “need to know” control, or only a UI convention?
- Public site does not link to `researcher/`. Is security-through-unlisted-URL being over-read? (The files are still fetchable if the path is known.)

### Deployment

- Which host will serve the public site, the submission API, and the database? The Inquiry archive is not part of the initial results path.
- Who applies `supabase/schema.sql`, and how will reviewers confirm there is still **no** public SELECT policy after later migrations?
- What prevents someone from setting `COLLECTION_ENABLED: true` before blockers close?
- Incident contacts, acknowledgement times, and notification thresholds are TBD. What is the minimum viable incident plan before any live row is stored?

---

## 13. How to run locally

Serve the folder over HTTP. Opening files as `file://` can restrict storage and scripts.

```bash
npx --yes serve -l 5500
```

A server may already be running at `http://localhost:5500/`.

| Page | URL | What to expect |
| --- | --- | --- |
| Public site | `http://localhost:5500/` | Proposal page |
| Survey (consent first) | `http://localhost:5500/#survey` | Consent checkboxes must be confirmed before the desk opens |
| Privacy notice | `http://localhost:5500/privacy.html` | Version 28 August 2026; collection described as disabled |
| Inquiry archive | `http://localhost:5500/researcher/` | Disconnected future UI; not the initial-release results system |

**Consent.** Both eligibility and notice checkboxes are required. The Continue button stays disabled until then.

**Collection remains local-only.** Completing the desk writes to `sessionStorage` in that tab. The archive status should indicate local/not configured. Reset deletes local survey data and returns to the consent gate. The Inquiry archive will not show that local result.

Do not paste keys into `config.js` or `researcher/config.js` for this review.

---

## 14. File inventory

Compact tree of files that matter for this review. One-line purpose each.

```
brian-dba-research-local/
├── index.html                          Public proposal page + consent + Inclusive Lending Desk shell
├── privacy.html                        Participant information notice (v. 28 Aug 2026); no scripts
├── script.js                           Public behaviour: consent, desk, sessionStorage, collection guard
├── styles.css                          Shared design system (public + archive)
├── config.js                           Public browser config; collection OFF; no secrets
├── config.example.js                   Documented public config template; no secrets
├── robots.txt                          Disallow /researcher/
├── _headers                            HTTP security headers for Netlify / Cloudflare Pages
├── vercel.json                         Same headers for Vercel
├── .gitignore                          Ignores .env and similar; comments forbid committing keys
├── README.md                           Project overview and blocker list
├── SECURITY.md                         Security model and reporting
├── .github/workflows/checks.yml        CI: syntax check + privacy-security tests
├── docs/
│   ├── specialist-review-briefing.md   This briefing
│   ├── launch-readiness.md             Launch blockers and go-live sequence
│   ├── data-protection-impact-assessment.md   Draft DPIA screening record
│   ├── data-retention-and-incident-response.md  Retention/incident draft (TBD)
│   └── researcher-dashboard-architecture.md     Six-layer researcher access design
├── api/researcher/                     Fail-closed researcher API scaffold (disabled)
├── researcher/
│   ├── index.html                      Inquiry archive markup; noindex; OIDC start gate + empty panels
│   ├── dashboard.js                    Archive client: disconnected default; cookie session later
│   ├── dashboard.css                   Archive layout on top of styles.css
│   ├── config.js                       Researcher config; empty endpoint; no secrets
│   └── config.example.js               Documented researcher config template
├── supabase/
│   └── schema.sql                      RLS, revokes, researcher roles, audit table; no public policies
└── tests/
    ├── privacy-security.test.mjs       Static tests of privacy/security invariants
    └── researcher-api.test.mjs         Fail-closed API, DTO, export, deletion tests
```

Not in this tree, but cited as the research-content source: `Brian RP V1.5.docx` (proposal document; not duplicated here).

---

## Reviewer close-out

If you need a one-line status for notes: **privacy-hardened static demonstration; live collection disabled; institutional and API blockers unresolved; not a claim of legal compliance.**

Please record findings against the files above, not against this briefing alone. If the working tree has moved since 28 August 2026, re-check `config.js`, `researcher/config.js`, and `docs/launch-readiness.md` first.
