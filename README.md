# What LLMs Can(not) Do

A living survey of benchmarks that compare large language models with humans.

**Website:** [https://what-llms-can-not-do.github.io/](https://what-llms-can-not-do.github.io/)

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
   - `VITE_SUBSCRIBE_API_URL` — worker origin (Pages build)
   - `SUBSCRIBE_API_URL` — same worker origin (notify/news workflows)
4. Set repository **secret** `SUBSCRIBE_NOTIFY_SECRET` to the same value as the worker `NOTIFY_SECRET`.

Automated mail:

- Push to `main` that changes `public/data.csv` → [.github/workflows/notify-subscribers.yml](.github/workflows/notify-subscribers.yml) classifies additions vs changes and calls `POST /notify`.
- Manual news: Actions → **Send news email** → [.github/workflows/send-news.yml](.github/workflows/send-news.yml) (`workflow_dispatch`).

Locally:

```bash
VITE_SUBSCRIBE_API_URL=http://127.0.0.1:8787 npm run dev
```
