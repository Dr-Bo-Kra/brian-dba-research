# Data retention and incident response (draft)

**Status:** Working draft for this privacy-hardened demonstration. Retention periods, anonymisation dates, and incident contacts are **unresolved**. This file is not an approved policy and is not a claim of legal compliance.

Live collection must stay **disabled** until the institution completes the items marked TBD.

## Retention (intended, not yet approved)

| Store | Intended handling | Period |
| --- | --- | --- |
| Browser `sessionStorage` | Latest local result for the current tab; cleared on tab end, reset, or successful protected submit | Session only |
| Legacy `localStorage` keys | Deleted by the current client | Immediate deletion |
| `assessment_responses` | Identifiable-enough research records until anonymisation | **TBD** |
| Backups of the research database | Follow the processor’s backup cycle, then expire | **TBD** |
| Researcher CSV exports | Approved institutional location only; no personal email or shared drives | **TBD** (no longer than the source records) |
| Dashboard / project audit material | Sign-in, export, and deletion actions | **TBD** |
| `researcher_audit_events` | Reserved for a later researcher API; unused while that API is disabled | **TBD** |
| Irreversible anonymisation | Strip participant reference and free-text as approved | **TBD** |

Until those periods exist, do not accept live submissions.

## Anonymisation and deletion

- Participants can delete local data with **Delete local data and restart**.
- After a protected submission, withdrawal uses the participant reference in the downloaded record.
- Authorised researchers delete matching rows in the **authenticated Supabase dashboard** by participant reference (`client_record_id`) while the reference still exists.
- After the approved anonymisation point, individual deletion may no longer be possible. That limit must appear in the approved privacy notice.

## Authorised-researcher stewardship (initial release)

- Role-based authorised-researcher identities on the authenticated Supabase dashboard. Brian may be the only provisioned researcher initially. Do not hard-code his name or email in application code.
- MFA and least-privilege project permissions.
- No anonymous or public SELECT.
- Aggregate reporting only inside the authenticated dashboard.
- CSV export only from an authenticated dashboard session; treat the file as restricted research material.
- Deletion by participant reference before anonymisation.
- Keep a written record of exports and deletions alongside processor logs.

The Inquiry archive is not used for this initial stewardship path.

## Incident contacts (TBD)

| Role | Name | How to notify | Time to acknowledge |
| --- | --- | --- | --- |
| Researcher | Brian E Pereira | Published LinkedIn profile until an institutional address is issued | **TBD** |
| Data controller | **TBD** | **TBD** | **TBD** |
| Privacy / DPO | **TBD** | **TBD** | **TBD** |
| Hosting / database processor | **TBD** | **TBD** | **TBD** |
| Supervisory / privacy authority | **TBD** (depends on recruitment countries) | **TBD** | Statutory |

Do not post participant records, keys, or raw logs in a public issue tracker.

## Draft incident steps (to be approved)

1. Contain: disable `COLLECTION_ENABLED`, rotate endpoint credentials, revoke dashboard sessions.
2. Preserve: keep logs and a factual timeline; do not delete evidence.
3. Assess: what was accessed, which participant references are involved, whether free-text or exports were involved.
4. Notify: controller, DPO, and any required authority using the approved thresholds — **those thresholds are TBD**.
5. Recover: patch the endpoint, review RLS and grants, confirm there is still no public read path.
6. Record: write the outcome into the institutional incident register (not yet created).

## Related files

- `docs/researcher-dashboard-architecture.md` — researcher access design
- `privacy.html` — participant-facing notice
- `SECURITY.md` — technical model
- `docs/launch-readiness.md` — blockers
- `docs/data-protection-impact-assessment.md` — screening record
