# Data protection impact assessment (working screening record)

**Status:** Draft screening record for a privacy-hardened demonstration. This is **not** a completed, signed, or institutionally approved DPIA. It does **not** claim legal compliance.

**Notice version aligned to:** 28 August 2026
**Instrument:** Inclusive Lending Desk (`brian-dba-inclusive-lending-desk-v3`)
**Owner until a controller is named:** Brian E Pereira (researcher)

## 1. Purpose of processing

Academic DBA research on how lending professionals understand psychometric, social-capital, behavioural, organisational-readiness, and governance factors in responsible inclusive lending. Responses are not used to make credit, employment, insurance, or clinical decisions about participants.

Live collection is **disabled**. This record describes the intended processing if collection is later approved.

## 2. Processing in the current demonstration

| Activity | Current state |
| --- | --- |
| Public site | Browser-only activity after consent |
| Local storage | `sessionStorage` for the current tab; legacy `localStorage` keys removed |
| Server-side collection | Off (`COLLECTION_ENABLED: false`) |
| Researcher results | No live archive. Initial-release design is the authenticated Supabase dashboard after approval. |
| Inquiry archive (`researcher/`) | Future UI only; disconnected; no records loaded; no mock login |
| Protected researcher API | Scaffolded, fail-closed, not enabled |
| Third-party fonts / analytics | Not requested |

## 3. Intended processing after approval

1. Participant reads `privacy.html`, confirms eligibility, and consents.
2. Browser POSTs a JSON payload to a protected, validated, rate-limited HTTPS endpoint.
3. The endpoint inserts into `assessment_responses` with a server-side credential.
4. Authorised researchers review rows in the **authenticated Supabase dashboard**. Access is role-based. Brian may be the only provisioned authorised researcher at first. Application code does not check for his name or email.
5. Dashboard users apply least privilege, MFA, aggregate reporting where appropriate, controlled CSV export, deletion by participant reference, retention/anonymisation once approved, and audit notes.
6. The Inquiry archive and protected researcher API are **not** used for this initial processing path.

No public or anonymous database read is part of this design.

## 4. Categories of information

**Intended:** broad demographic and professional categories; regional category; Likert ratings; free-text reflections; random participant reference; notice version; consent timestamp; derived scores.

**Not intended in the research payload:** name, email, user-agent, page URL, IP address, precise free-text geography, employer identity, borrower or customer data.

**Residual risk:** hosting and network operators may process connection logs. Free-text may accidentally include identifiers. Researchers are instructed not to seek that information and to delete it when reported.

## 5. Data subjects and recruitment geography

Lending and related professionals aged 18 or over. **Countries of recruitment are not yet confirmed** by the institution. Until they are, lawful-basis analysis and transfer mapping cannot be completed.

## 6. Controller, processors, and transfers

| Item | Status |
| --- | --- |
| Sponsoring university / legal controller | Unresolved |
| Joint-controller arrangements | Unresolved |
| Privacy / DPO contact | Unresolved |
| Database and API region | Unresolved |
| Processor agreements | Unresolved |
| International-transfer safeguards | Unresolved |

A future database or hosting provider is a processor only after the institution executes an agreement. GitHub Pages currently hosts a public static demonstration and is not a research-archive processor while collection is off.

## 7. Lawful basis and consent

The on-page checkboxes record **research-participation consent**. They are not a substitute for the institution’s documented lawful basis in each applicable jurisdiction. Consent wording must be approved before collection is enabled.

## 8. Necessity, minimisation, and retention

The instrument uses categories rather than precise geography, avoids device identifiers in the payload, and keeps collection off until a protected path exists. Retention and anonymisation **periods are unresolved**. No live archive should be created until those periods are written into `privacy.html` and `docs/data-retention-and-incident-response.md`.

## 9. Access and security measures (designed, not yet operational)

- Forced row-level security; no `anon` / `authenticated` table privileges
- Separate protected submission endpoint; no participant-browser table writes
- Role-based authorised-researcher dashboard access with MFA and least privilege
- Deletion by participant reference before anonymisation
- CSP meta tags; HTTP headers where the host allows them

These measures reduce risk. They do not complete a statutory DPIA.

## 10. Rights, withdrawal, and residual high-risk notes

Withdrawal before anonymisation depends on the participant reference. After irreversible anonymisation, individual deletion may be impossible. Rights procedures, response times, and the supervisory authority are unresolved.

Possible high-risk flags for later institutional review (not determinations): professional opinions in free text; possible special-category data if accidentally typed; cross-border hosting; researcher access to identifiable-enough records before anonymisation.

## 11. Decision

**Do not enable live collection.** Complete the blockers in `docs/launch-readiness.md`, replace this screening record with the institution’s DPIA template, and obtain the required signatures first.
