# Researcher read-path production dependencies

This is a **decision and wiring contract**, not an approval and not a deployment. Live collection stays **disabled**. Exports and deletions stay **disabled**. GitHub Pages must **not** host the authenticated researcher application.

The **provisional** production stack is Vercel (Inquiry Archive + researcher API) and Supabase Postgres. Identity provider and geographic region are **not** selected. `vercel.json` is not an approval to deploy.

## How to read this matrix

- **Selected:** a concrete product/host/region has been chosen by the institution.
- **Wired:** the codebase can use the dependency when credentials and an approved adapter are supplied.
- **Fail closed:** missing or unapproved dependencies refuse authentication and research data.

---

### A. Hosting / runtime

| | |
| --- | --- |
| **Purpose** | Terminate TLS, keep server secrets, run `/api/researcher`, serve `/researcher/` same-site, set `__Host-` cookies, `Cache-Control: no-store`. |
| **Required configuration** | Approved host; HTTPS origin; process that can load server env; same-site archive + API paths. |
| **Currently selected** | Provisional: Vercel Node.js 20 (not Edge). Region not selected. |
| **Credentials required** | Host project/org access; not stored in this repo. |
| **Security requirements** | TLS; secret store; no GitHub Pages for this app; no public static host as the auth boundary. |
| **Failure behaviour** | Do not enable `RESEARCHER_API_ENABLED`. API remains unavailable. |
| **Who decides** | Sponsoring university / IT / DPO (host and region). |

### B. OIDC / MFA identity provider

| | |
| --- | --- |
| **Purpose** | Individual researcher authentication with mandatory MFA. |
| **Required configuration** | `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URI`, `OIDC_AUDIENCE` (defaults to client ID if empty), `OIDC_REQUIRED_ACR` and/or `OIDC_REQUIRED_AMR`. Optional: `OIDC_LOGOUT_URL`. |
| **Currently selected** | No IdP. No ACR/AMR values. |
| **Credentials required** | Confidential client secret; never in browser files. |
| **Security requirements** | Authorization Code + PKCE; server-side token verification; MFA claim check; no password form; no mock IdP. |
| **Failure behaviour** | `/v1/session/start` and data routes return `unavailable`. |
| **Who decides** | University identity / IAM + research supervisor. |

Administrator must obtain from the future IdP: issuer URL, confidential client, exact redirect URI (`https://<approved-host>/api/researcher/v1/session/callback`), audience, the ACR and/or AMR values that mean MFA, JWKS/discovery availability, and whether a logout endpoint exists.

### C. Session store

| | |
| --- | --- |
| **Purpose** | Durable opaque sessions (`researcher_sessions`): create, lookup, rotate, revoke, expire, cleanup. |
| **Required configuration** | `SESSION_STORE=database` and a working server-side query adapter on `DATABASE_URL`. `SESSION_SECRET` for cookie HMAC. |
| **Currently selected** | SQL table exists. Production adapter is `pg` via server-only `DATABASE_URL`. `SESSION_STORE=memory` is ignored. |
| **Credentials required** | Least-privilege DB role, not browser keys. |
| **Security requirements** | No survey answers in session rows; HttpOnly `__Host-` cookie; rotation after login. |
| **Failure behaviour** | Production uses the unavailable store. No in-memory fallback. |
| **Who decides** | Hosting + database operator. |

### D. Shared rate-limit store

| | |
| --- | --- |
| **Purpose** | Shared limits: `login`, `api`, `record`, `qualitative`. |
| **Required configuration** | `RATE_LIMIT_STORE=database` and the same query adapter. After Vercel is accepted as the TLS terminator: `TRUSTED_PROXY=vercel` (reads only `x-vercel-forwarded-for`). |
| **Currently selected** | SQL table exists. Trusted-proxy is **off**. Vercel-aware mode exists but is not enabled. |
| **Credentials required** | Same `researcher_api` connection if the database backend is used. |
| **Security requirements** | Do not trust `X-Forwarded-For` until a documented proxy boundary exists. Key from the socket address by default. |
| **Failure behaviour** | Unavailable limiter; researcher API refuses work (not fail-open). |
| **Who decides** | Hosting operator (proxy/IP derivation) + implementer. |

### E. Database / `researcher_api` role

| | |
| --- | --- |
| **Purpose** | Directory lookup, approved research SELECTs, session/auth-state/rate-limit writes, audit INSERT. |
| **Required configuration** | `DATABASE_URL` for the **`researcher_api`** role only (pooled URI on Vercel). |
| **Currently selected** | Schema, grants, and `researcher_api` RLS policies exist. Driver is server-only `pg`. No production URL. |
| **Credentials required** | Server-only `researcher_api` password/URL. Never anon, authenticated-browser, or service-role in the browser. |
| **Security requirements** | Forced RLS remains; parameterised SQL only; no privilege broadening. |
| **Failure behaviour** | No query adapter → no durable stores → no research data. |
| **Who decides** | Database administrator. **Stop before using the service-role** if that is proposed. |

### F. Audit sink

| | |
| --- | --- |
| **Purpose** | Durable insert of login, login failure, authz failure, logout, record view, qualitative view. |
| **Required configuration** | Query adapter + `researcher_audit_events`. `AUDIT_STORE_RESEARCHER_IP=false` until DPO approval. |
| **Currently selected** | Table exists. Process sink is wired when a query adapter is supplied. IP audit is off. |
| **Credentials required** | INSERT-only on audit via `researcher_api`. |
| **Security requirements** | No answers, qualitative text, tokens, cookies, or secrets. |
| **Failure behaviour** | Sensitive reads fail closed if the durable sink errors. |
| **Who decides** | DPO / legal for IP fields; operator for log retention. |

### G. TLS / domain / redirect URI

| | |
| --- | --- |
| **Purpose** | `__Host-` cookies, OIDC redirect exact match, same-site archive. |
| **Required configuration** | Approved HTTPS origin; `OIDC_REDIRECT_URI`; `ARCHIVE_PATH` (default `/researcher/`); `ALLOWED_ORIGIN` empty or exact origin (never `*`). |
| **Currently selected** | No production domain. |
| **Credentials required** | Certificate is a platform concern. |
| **Security requirements** | Exact redirect URI; no open redirects; HSTS on HTTPS. |
| **Failure behaviour** | OIDC not ready; authentication unavailable. |
| **Who decides** | University IT / hosting (domain and region). |

### H. Secret management

| | |
| --- | --- |
| **Purpose** | Keep server secrets out of git, browsers, logs, and error bodies. |
| **Required configuration** | Host secret store for `SESSION_SECRET`, `OIDC_CLIENT_SECRET`, `DATABASE_URL`. |
| **Currently selected** | `.env` is gitignored. `api/researcher/env.example` has placeholders only. |
| **Credentials required** | See §15 of the implementation response / env.example comments. |
| **Security requirements** | Never copy these into `researcher/config.js`. Startup public snapshot omits secrets. |
| **Failure behaviour** | Missing secrets → `authReady` false / runtime stores unavailable. |
| **Who decides** | Hosting operator + researcher who deploys (not this repository). |

## SameSite / OIDC transaction (design)

The authenticated session cookie `__Host-dba-researcher` stays **SameSite=Strict**. The IdP callback is a cross-site top-level GET, so that cookie is not used to resume login.

Login binding uses a separate, short-lived, **non-authenticating** `__Host-dba-oidc-tx` cookie (**SameSite=Lax**) plus server-side state (state, nonce, PKCE verifier, transaction id, expiry, one-time consume). Browser web storage is not used.

## What this repository will not decide

Hosting vendor, cloud region, IdP product, ACR/AMR values, lawful basis, ethics approval, and whether researcher IP may be stored.
