# Data retention and incident response

**Status:** Working governance baseline for the privacy-hardened platform. This file documents the agreed retention and withdrawal practice. It is **not** a claim of GDPR, ISO, or other legal certification.

Live public collection must stay **disabled** until go-live is explicitly approved. Export and deletion capabilities are implemented but fail-closed (`EXPORTS_ENABLED=false`, `DELETIONS_ENABLED=false`) until Production env enables them for Brian.

## Retention (agreed)

| Store | Handling | Period |
| --- | --- | --- |
| Browser `sessionStorage` | Latest local result for the current tab; cleared on tab end, reset, or successful protected submit | Session only |
| Legacy `localStorage` keys | Deleted by the current client | Immediate deletion |
| `assessment_responses` | Identifiable-enough research records until authorised review after the retention threshold | **12 months after research completion**, unless AIM requires otherwise |
| Backups of the research database | Follow the processor’s backup cycle, then expire | Processor-dependent |
| Researcher CSV exports | Approved institutional location only; no personal email or shared drives | No longer than the source records |
| Dashboard / project audit material | Sign-in, export, deletion, and retention-review actions | Institutional schedule TBD |
| `researcher_audit_events` | Researcher API metadata audit (no survey answers) | Institutional schedule TBD |
| Irreversible anonymisation / deletion | Only after authorised researcher review — **never silent auto-destroy** | After retention review |

### Retention review in the Inquiry Archive

- Configure optional `STUDY_COMPLETION_DATE` (YYYY-MM-DD) and `RETENTION_MONTHS` (default 12) on the researcher API.
- When `STUDY_COMPLETION_DATE` is set, review opens at completion date + retention months and lists non-anonymised records accepted on or before completion.
- Until completion date is set, the dashboard surfaces records whose **acceptance age** exceeds retention months (heuristic) for authorised review.
- `GET /v1/retention-review` is authenticated, audited, and does **not** delete rows.

Hosting region for the research archive: **Singapore** (approved).

## Withdrawal and deletion

1. Participant contacts Brian (published LinkedIn profile until a Production institutional email is supplied) and supplies the participant reference from the downloaded record.
2. Authorised researcher locates the row by `resp_…` reference in the Inquiry Archive.
3. Researcher confirms deliberately in the Administration panel and submits deletion.
4. Server path: authenticated session + CSRF + `DELETIONS_ENABLED=true` + `POST /v1/deletions` → `delete_assessment_by_reference` (security definer). Table-level DELETE stays revoked for `researcher_api`. `submission_inserter` cannot DELETE.
5. Legal hold blocks deletion. Client always receives generic `{ "ok": true }` after a well-formed authorised request.
6. Audit records actor, reference, legal_hold, and deleted flags (not answers).

## Export

- Authenticated authorised researcher only; MFA session; CSRF on POST.
- Fail-closed unless `EXPORTS_ENABLED=true`.
- Approved CSV schema only (participant reference, accepted_at, region, role, experience, orientation). No free-text, no auth/session metadata.
- Optional single-participant export via `reference` in the export body.
- No public export URLs. Actions are audit-logged.

## Authorised-researcher stewardship

- Role-based identities in `authorised_researchers`. Brian is expected to be the sole active researcher. Do not hard-code his name or email in application code.
- MFA and least-privilege project permissions.
- No anonymous or public SELECT.
- Aggregate reporting inside the authenticated dashboard.
- Keep a written institutional record of exports and deletions alongside processor logs.

## Incident contacts

| Role | Name | How to notify | Time to acknowledge |
| --- | --- | --- | --- |
| Researcher | Brian E Pereira | Published LinkedIn profile until an institutional address is issued | AIM to confirm |
| Data controller | AIM / sponsoring institution | TBD | TBD |
| Privacy / DPO | TBD | TBD | TBD |
| Hosting / database processor | Singapore-hosted research DB + approved app host | Processor channels | Processor SLA |
| Supervisory / privacy authority | Depends on recruitment countries | TBD | Statutory |

Do not post participant records, keys, or raw logs in a public issue tracker.

## Draft incident steps

1. Contain: disable `COLLECTION_ENABLED` / `SUBMISSION_API_ENABLED`, rotate endpoint credentials, revoke dashboard sessions.
2. Preserve: keep logs and a factual timeline; do not delete evidence.
3. Assess: what was accessed, which participant references are involved, whether free-text or exports were involved.
4. Notify: controller, DPO, and any required authority using approved thresholds.
5. Recover: patch the endpoint, review RLS and grants, confirm there is still no public read path.
6. Record: write the outcome into the institutional incident register.

## Related files

- `docs/researcher-dashboard-architecture.md` — researcher access design
- `privacy.html` — participant-facing notice
- `SECURITY.md` — technical model
- `docs/launch-readiness.md` — blockers
- `docs/data-protection-impact-assessment.md` — screening record
