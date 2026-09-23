# What LLMs Can(not) Do

A living survey of benchmarks that compare large language models with humans.

**Website:** [https://what-llms-can-not-do.org/](https://what-llms-can-not-do.org/)

## Custom domain (GitHub Pages + Cloudflare)

The site is served on **`https://what-llms-can-not-do.org`**. GitHub Pages automatically redirects `https://what-llms-can-not-do.github.io` to that domain once the custom domain is configured.

### 1. Cloudflare DNS (DNS only / grey cloud)

| Type | Name | Content |
| --- | --- | --- |
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| AAAA | `@` | `2606:50c0:8000::153` |
| AAAA | `@` | `2606:50c0:8001::153` |
| AAAA | `@` | `2606:50c0:8002::153` |
| AAAA | `@` | `2606:50c0:8003::153` |
| CNAME | `www` | `what-llms-can-not-do.github.io` |

Keep existing **Resend** email records (TXT / DKIM) as they are.

### 2. GitHub Pages settings

Repo → **Settings** → **Pages** → **Custom domain** → `what-llms-can-not-do.org` → Save. Wait for DNS check, then enable **Enforce HTTPS**.

(`public/CNAME` in this repo keeps that setting on each deploy.)

### 3. After cutover

- Update Contribute OAuth App **Homepage URL** to `https://what-llms-can-not-do.org/`
- Redeploy subscribe + contribute workers if you change `ALLOWED_ORIGINS` / `SITE_ORIGIN` in their `wrangler.toml`

## Contribute form API

The site’s Contribute page requires **Sign in with GitHub**, then posts to a Cloudflare Worker that edits the catalog CSVs (and optional audio) and opens a review PR **as that GitHub user**. See [workers/contribute/README.md](workers/contribute/README.md) for OAuth App setup, deploy, and secrets.

After deploying the worker, set the GitHub Actions **repository variable** `VITE_CONTRIBUTE_API_URL` to the worker origin with no trailing path (for example `https://wlcd-contribute.<account>.workers.dev`). It must be a full `https://…` URL — not a local filesystem path. Locally:

```bash
VITE_CONTRIBUTE_API_URL=http://127.0.0.1:8787 npm run dev
```

Manual GitHub issues with the `table-contribution` label still create PRs via [.github/workflows/contribution-pr.yml](.github/workflows/contribution-pr.yml).

## Email subscriptions (Resend + D1)

The **Subscribe** page lets people opt into News, table Additions, and/or table Changes. Double opt-in confirmation is required. See [workers/subscribe/README.md](workers/subscribe/README.md) for full setup.

Short version:

1. Create a [Resend](https://resend.com) account, verify a sending domain, and create an API key.
2. Create and migrate the D1 database, set worker secrets (`RESEND_API_KEY`, `FROM_EMAIL`, `NOTIFY_SECRET`, `ADMIN_PASSWORD`), deploy `workers/subscribe`.
3. Open `/admin` (not in the nav) with `ADMIN_PASSWORD` to list subscribers and send news emails.
3. Set repository **variables**:
   - `VITE_SUBSCRIBE_API_URL` — `https://subscribe.what-llms-can-not-do.org` (Pages build)
   - `SUBSCRIBE_API_URL` — same (notify/news workflows)
4. Set repository **secret** `SUBSCRIBE_NOTIFY_SECRET` to the same value as the worker `NOTIFY_SECRET`.

### Email deliverability (important)

Gmail often files new-domain mail as spam; some universities (e.g. TUM/LRZ) hard-reject with `554 … spam`. Do all of the following:

1. **DMARC** on the apex (Cloudflare DNS TXT `_dmarc`):  
   `v=DMARC1; p=none; rua=mailto:YOU@example.com`
2. **Send from a subdomain** (recommended by Resend), not the apex:
   - Resend → Domains → Add `mail.what-llms-can-not-do.org`
   - Add the DNS records Resend shows (DNS only / grey cloud)
   - After verified, in `workers/subscribe`:  
     `npx wrangler secret put FROM_EMAIL`  
     → `WLCD Updates <updates@mail.what-llms-can-not-do.org>`
3. **Reply-To** is set on the worker (`REPLY_TO` secret → a real inbox).
4. Confirm/unsubscribe links use the **site apex** (`https://what-llms-can-not-do.org/confirm?…`); the SPA redirects to the worker.
5. After any bounce: Resend → **Suppressions** → remove the address before retrying.
6. Optional: [Google Postmaster Tools](https://postmaster.google.com/) for the sending domain.
7. Keep volume low while the domain warms up.

Automated mail:

- Push to `main` that changes `public/data.csv` → [.github/workflows/notify-subscribers.yml](.github/workflows/notify-subscribers.yml) classifies additions vs changes and calls `POST /notify`.
- Manual news: Actions → **Send news email** → [.github/workflows/send-news.yml](.github/workflows/send-news.yml) (`workflow_dispatch`).

Locally:

```bash
VITE_SUBSCRIBE_API_URL=http://127.0.0.1:8787 npm run dev
```
