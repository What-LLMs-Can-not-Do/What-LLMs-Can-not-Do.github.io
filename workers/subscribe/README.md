# Subscribe worker (`wlcd-subscribe`)

Email subscriptions for What LLMs Can(not) Do: **News**, **Additions**, and **Changes**.

Uses Cloudflare D1 for storage and [Resend](https://resend.com) for sending. Double opt-in confirmation is required before mail is sent.

## Setup

### 1. Resend

1. Create a Resend account and API key.
2. Verify a sending domain (not `github.io`).
3. Note a From address such as `WLCD <updates@yourdomain.org>`.

### 2. D1 database

```bash
cd workers/subscribe
npm install
npx wrangler login
npx wrangler d1 create wlcd-subscribers
```

Paste the returned `database_id` into `wrangler.toml`, then:

```bash
npm run db:migrate:remote
```

### 3. Secrets

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put FROM_EMAIL          # e.g. WLCD <updates@yourdomain.org>
npx wrangler secret put NOTIFY_SECRET       # long random string for GitHub Actions
```

Optional: set `SITE_ORIGIN` / `ALLOWED_ORIGINS` in `wrangler.toml` `[vars]`.

### 4. Deploy

```bash
npm run deploy
```

Note the worker URL (e.g. `https://wlcd-subscribe.<account>.workers.dev`).

### 5. Site + GitHub Actions

- Repository variable `VITE_SUBSCRIBE_API_URL` = worker origin (no trailing path)
- Repository secret `SUBSCRIBE_NOTIFY_SECRET` = same value as `NOTIFY_SECRET`
- Repository variable `SUBSCRIBE_API_URL` = worker origin (used by notify/news workflows)

## API

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `POST` | `/subscribe` | CORS origin | `{ email, topics: ["news","additions","changes"] }` |
| `GET` | `/confirm?token=` | — | Confirm subscription; redirects to site |
| `GET` | `/unsubscribe?token=` | — | Unsubscribe; redirects to site |
| `POST` | `/notify` | `X-Notify-Secret` | `{ type: "additions"\|"changes", title, summary?, pr_url? }` |
| `POST` | `/news` | `X-Notify-Secret` | `{ subject, body }` |

## Local development

```bash
npm run db:migrate:local
npm run dev
```

```bash
# from website root
VITE_SUBSCRIBE_API_URL=http://127.0.0.1:8787 npm run dev
```
