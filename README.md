# Brian E Pereira — DBA Research Website

A responsive static website for the June 2026 DBA research proposal *Exploring Organizational Adoption of Alternative Creditworthiness Models for Inclusive Lending*.

This repository is **privacy-hardened**. It is **not** described as legally compliant. Live survey collection remains **disabled** until the sponsoring institution completes ethics, privacy, and deployment approvals and the protected APIs are in place.

Public site (when published): [dr-bo-kra.github.io/brian-dba-research](https://dr-bo-kra.github.io/brian-dba-research/)

## Intended architecture

```
1. Public survey interface
        │  HTTPS POST of a validated JSON payload
        ▼
2. Protected submission API
        │  parameterised INSERT
        ▼
3. Private Supabase database
        │  RLS forced; no anonymous or public SELECT
        ├── 4. Protected researcher API  →  5. Authenticated Inquiry Archive
        └── 6. Authenticated Supabase dashboard (administrative / fallback)
```

The public browser must never hold a database anon key, service-role key, or other secret. It must never insert or read rows through a public table API (`/rest/v1/...`).

Until the submission endpoint and the institutional items below are approved, `COLLECTION_ENABLED` stays `false` and responses remain in the participant’s browser tab only.

The Inquiry Archive is **not** live. See [docs/researcher-dashboard-architecture.md](docs/researcher-dashboard-architecture.md).

## Preview locally

Serve the folder over HTTP (opening files directly can restrict storage and scripts):

```bash
npx --yes serve -l 5500
```

Then open:

- public site: `http://localhost:5500/`
- privacy notice: `http://localhost:5500/privacy.html`
- Inquiry archive (future UI only; disconnected): `http://localhost:5500/researcher/`

## Publish the static site

The public site is static HTML, CSS, and JavaScript. No build step is required.

- **GitHub Pages** can host the public files. It does **not** provide complete configurable HTTP security headers. Pages include a Content-Security-Policy **meta** tag as a fallback. Some CSP directives, including `frame-ancestors`, are only enforced when sent as HTTP headers. Do not treat the meta tag as a substitute for host-level headers.
- **Netlify, Cloudflare Pages, or Vercel** can apply `_headers` or `vercel.json`. Prefer a host with configurable headers before enabling collection.

After deploy, confirm that `config.js` still has `COLLECTION_ENABLED: false` and an empty `SUBMISSION_ENDPOINT`. Preview `researcher/config.js` uses the same-origin path `/api/researcher`. Do not treat GitHub Pages as the production results interface.

## Configuration

Public browser configuration lives in `config.js` (see `config.example.js`).

| Field | Production value until launch is approved |
| --- | --- |
| `COLLECTION_ENABLED` | `false` |
| `SUBMISSION_ENDPOINT` | `''` (empty) |
| `PRIVACY_NOTICE_VERSION` | Match `privacy.html` (currently `2026-08-28`) |
| `LINKEDIN_URL` | Public researcher contact profile |

Researcher workspace configuration lives in `researcher/config.js`.

| Field | Production value until launch is approved |
| --- | --- |
| `RESEARCHER_ENDPOINT` | `'/api/researcher'` (same-origin; not a secret) |

When collection is eventually enabled:

1. Keep secrets out of every browser file. Point `SUBMISSION_ENDPOINT` at an HTTPS API that validates and inserts server-side.
2. Provision **authorised researcher** identities in Supabase with MFA. Access is role-based. Brian may be the only provisioned authorised researcher at first; application code must not hard-code his name or email as an access check.
3. Reject any `/rest/v1/` table URL from the participant browser. The public client already refuses that path.
4. Update CSP `connect-src` on the public page (meta tag and HTTP headers) to include **only** the submission endpoint origin.
5. Do not add a database anon key, publishable key, JWT secret, or service-role key to `config.js` or `researcher/config.js`.
6. Keep `RESEARCHER_ENDPOINT` as the same-origin `/api/researcher` path only. Do not host that API or `researcher/` on GitHub Pages.

## What the public activity stores

After both consent checkboxes are confirmed, the Inclusive Lending Desk can run. A completed record is written to **sessionStorage** for the current tab so the participant can view and download a copy. Older **localStorage** survey keys are deleted on load and on reset.

The payload is designed to include:

- broad professional demographics and a **regional category** (not free-text geography)
- vignette acknowledgement, Likert items, and free-text reflections
- a random participant reference, notice version, and consent timestamp
- derived assessment scores shown on the results screen

It is designed **not** to include name, email, user-agent, IP address, or page URL. Hosting and network operators may still process ordinary connection logs under their own policies.

Reset (**Delete local data and restart**) clears locally stored survey data and returns the participant to the consent gate.

## Initial-release results workflow (authenticated Supabase dashboard)

For the **initial release**, authorised researchers review completed results in **Supabase’s authenticated dashboard**, not in `researcher/`.

Required dashboard practice (to be enforced operationally; not implemented as browser access control):

| Control | Expectation |
| --- | --- |
| Authentication | Individual researcher accounts via Supabase Auth; TOTP MFA required. AIM is not used. |
| Authorisation | Role-based **authorised researcher** access. Brian may be the only provisioned researcher initially. Do not hard-code his name or email in application code. |
| Least privilege | Named dashboard users with the minimum project permissions needed to review, export, and delete research rows. No shared login. |
| Public / anonymous reads | None. Keep `anon` and `authenticated` table privileges revoked. Do not add a public SELECT policy. |
| Aggregate reporting | Use dashboard table views, counts, and filters. Do not publish aggregates on the public site. |
| Controlled CSV export | Export only from an authenticated dashboard session into an approved institutional location. Treat the file as restricted research material. |
| Deletion by participant reference | Delete matching `client_record_id` (`resp_…`) rows before anonymisation. |
| Retention / anonymisation | Follow the approved schedule once it exists. Collection stays off until those periods are written into the notice. |
| Audit logging | Use Supabase project logs plus a written export/deletion record. `researcher_audit_events` is reserved for a later API; it is not a live dashboard feature by itself. |

The public website has no results list and no researcher login.

## Inquiry archive (`researcher/`)

`researcher/` is the Inquiry Archive UI. It talks only to the same-origin protected API at `/api/researcher`. A fail-closed API lives in `api/researcher/` and stays disabled unless the host sets `RESEARCHER_API_ENABLED=true`. Collection, export, and deletion remain off.

The browser must not receive Supabase keys, database URLs, or researcher credentials. Password sign-in alone cannot open the workspace; the API must confirm TOTP MFA (`authenticated: true`) first.

GitHub Pages cannot protect this route. `noindex`, `robots.txt`, and `X-Robots-Tag` are **crawl hints only**. They do not restrict who can fetch static files.

The public website does not link to this workspace and must not gain database reads.

## Database schema

Apply `supabase/schema.sql` through a controlled migration **before** any collection is enabled. The script:

- stores consent version and timestamp
- drops user-agent and page URL columns
- constrains instrument id, participant-reference format, and payload size
- enables and forces row-level security
- revokes table privileges from `anon` and `authenticated`
- does not create public SELECT or INSERT policies
- adds private `authorised_researchers`, `researcher_sessions`, and `researcher_audit_events` tables with the same privilege model
- does not grant `anon` or `authenticated` SELECT, INSERT, UPDATE, or DELETE

Initial researcher review is through the authenticated Supabase dashboard and a least-privilege project role, not a public table policy and not the Inquiry archive.

## Tests and CI

```bash
node --check script.js
node --check researcher/dashboard.js
node --check api/researcher/server.mjs
node --test tests/*.test.mjs
```

GitHub Actions runs those commands on push and pull request. On Windows PowerShell, if the glob does not expand, run `node --test tests`.

## Documentation

| File | Purpose |
| --- | --- |
| [SECURITY.md](SECURITY.md) | Security model, reporting, researcher access |
| [docs/data-protection-impact-assessment.md](docs/data-protection-impact-assessment.md) | Working DPIA screening record |
| [docs/data-retention-and-incident-response.md](docs/data-retention-and-incident-response.md) | Retention draft and incident contacts (TBD) |
| [docs/launch-readiness.md](docs/launch-readiness.md) | Launch blockers and go-live checklist |
| [docs/researcher-dashboard-architecture.md](docs/researcher-dashboard-architecture.md) | Six-layer trust boundaries and researcher API design |
| [api/researcher/SPEC.md](api/researcher/SPEC.md) | Protected researcher API contract (scaffolded, disabled) |
| [privacy.html](privacy.html) | Participant-facing notice (versioned) |

These documents support a privacy-hardened demonstration. They do **not** replace institutional legal review, ethics approval, or a completed DPIA signed by the controller.

## Unresolved launch blockers

Do not enable live collection until the institution has confirmed at least:

- sponsoring university and legal data controller
- privacy / DPO contact
- ethics approval and reference
- countries where participants will be recruited
- lawful basis and consent wording approved by the institution
- retention and anonymisation periods
- hosting / database region
- processor agreements and international-transfer safeguards
- protected submission endpoint, abuse protection, rate limiting, and incident contacts
- authorised-researcher identities and roles for the authenticated Supabase dashboard (MFA, least privilege, no public SELECT)
- controlled dashboard export, deletion-by-reference, retention, and audit practice
- incident contacts

The Inquiry archive is **not** a collection-launch blocker. Collection stays off. The archive talks only to `/api/researcher` after MFA.

See [docs/launch-readiness.md](docs/launch-readiness.md).

## Content note

Substantive research claims, questions, methods, and sample sizes follow `Brian RP V1.5.docx`. The page labels the work as a **proposal** so planned methods are not mistaken for completed findings.
