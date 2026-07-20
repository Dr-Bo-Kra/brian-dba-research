# Brian E Pereira — DBA Research Website

A responsive, accessible static website translating the June 2026 DBA research proposal into a public-facing narrative.

Live site: [dr-bo-kra.github.io/brian-dba-research](https://dr-bo-kra.github.io/brian-dba-research/)

## Preview locally

Open `index.html` directly, or serve the folder with any static web server.

## Publish

The folder can be deployed as-is to GitHub Pages, Netlify, Vercel, Cloudflare Pages, or any standard web host. No build step or Node backend is required.

## Collecting Lending Desk assessment responses (Supabase)

The `#survey` Lending Desk game always saves a structured JSON record to **localStorage** and offers a **JSON download**. When Supabase is configured, the same record is also **POSTed** to a central archive so the researcher can review responses in one place.

The browser uses the **anon (public) key** only. That key is designed to be public when Row Level Security (RLS) is on. **Never** put the `service_role` key in front-end code or commit it.

### 1. Create a Supabase project

1. Sign up / sign in at [supabase.com](https://supabase.com).
2. Create a new project (free tier is enough).
3. Open **Project Settings → API** and copy:
   - **Project URL** → `SUPABASE_URL`
   - **anon public** key → `SUPABASE_ANON_KEY`

### 2. Create the table + RLS

1. In the Supabase dashboard, open **SQL → New query**.
2. Paste and run the contents of [`supabase/schema.sql`](supabase/schema.sql).
3. Confirm table `assessment_responses` exists under **Table Editor**.
4. Confirm RLS allows **INSERT** for `anon` and **no SELECT** for `anon` (researchers read via the dashboard or `service_role` locally).

### 3. Configure the site

1. Copy values into `config.js` (or start from `config.example.js`):

```js
window.BRIAN_DBA_CONFIG = {
  SUPABASE_URL: 'https://YOUR_PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR_ANON_KEY',
};
```

2. Commit and push to `main` (GitHub Pages will redeploy), or paste the same values into the deployed host’s `config.js`.

Until URL + anon key are filled, the game still works: the results screen shows **Saved locally only (offline / not configured)** and keeps localStorage + download as backup.

### 4. Verify

1. Play through the Lending Desk to the results screen.
2. You should see **Saved to research archive** when the POST succeeds.
3. In Supabase **Table Editor → assessment_responses**, a new row should appear (`profile`, `responses`, `assessment` jsonb columns).

### Payload shape (browser → REST)

`POST /rest/v1/assessment_responses` with headers `apikey` + `Authorization: Bearer <anon key>`:

| Column | Source |
| --- | --- |
| `instrument_id` | record.instrument |
| `client_record_id` | record.id |
| `profile` | record.profile |
| `responses` | record.gameplay (+ comment) |
| `assessment` | record.assessment |
| `user_agent` | navigator.userAgent |
| `page_url` | location.href |

Network failures never block the results UI; local backup always remains.

## Content note

All substantive research claims, questions, methods and sample sizes are based on `Brian RP V1.5.docx`. The page explicitly labels the work as a proposal so planned methods are not mistaken for completed findings.
