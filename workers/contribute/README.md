# Contribute worker (`wlcd-contribute`)

Accepts Contribute form submissions (JSON payload + optional `.mp3`/`.wav` uploads), updates `public/data.csv` (and models/keywords/audio when needed), and opens a review PR **as the signed-in GitHub user**.

Submitters must **Sign in with GitHub** on the Contribute page. The worker uses their OAuth token to open the PR (pushing to the main repo when they have write access, otherwise via their fork).

## Setup

### 1. GitHub OAuth App

1. Create an OAuth App under the org or your user: [Developer settings → OAuth Apps](https://github.com/settings/developers).
2. Homepage URL: `https://what-llms-can-not-do.github.io/`
3. Authorization callback URL: `https://wlcd-contribute.<account>.workers.dev/auth/callback` (your worker origin + `/auth/callback`).
4. Copy the **Client ID**. Generate a **Client secret**.

Scopes requested by the worker: `public_repo` and `read:user`.

### Organization access (required)

The site repo is under the **What-LLMs-Can-not-Do** org. Org OAuth restrictions block unapproved apps from creating branches/PRs (HTTP 403), even on a public repo.

An org owner must approve the OAuth App:

1. Open [OAuth app policy](https://github.com/organizations/What-LLMs-Can-not-Do/settings/oauth_application_policy)
2. Approve **WLCD Contribute** (or whatever you named the app), or transfer/create the OAuth App **under the organization** so it is trusted automatically
3. On the Contribute page: Sign out → Sign in with GitHub again (re-authorize if GitHub prompts for org access)

### 2. Worker secrets and deploy

```bash
npm install
npx wrangler login
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put SESSION_SECRET   # long random string
```

Optional: keep `GITHUB_TOKEN` only if you still need a bot token for other tooling; PR creation no longer uses it.

Set the public Client ID in `wrangler.toml` (`GITHUB_CLIENT_ID`) or:

```bash
npx wrangler secret put GITHUB_CLIENT_ID
```

Then:

```bash
npm run deploy
```

Note the worker URL (e.g. `https://wlcd-contribute.<account>.workers.dev`).

### 3. Site build (GitHub Pages)

Set repository variable / secret `VITE_CONTRIBUTE_API_URL` to the deployed worker origin (no trailing `/contribute`). The Pages workflow passes it into `npm run build`.

## Local development

```bash
npm run dev
```

Point the site at the local worker, and add `http://127.0.0.1:8787/auth/callback` (and/or `http://localhost:8787/auth/callback`) as an additional callback URL on the OAuth App (or use a second OAuth App for local).

```bash
# from the website root
VITE_CONTRIBUTE_API_URL=http://127.0.0.1:8787 npm run dev
```

## API

### Auth

- `GET /auth/login?return_to=<https url>` — start GitHub OAuth
- `GET /auth/callback` — OAuth redirect target; sets session cookie
- `GET /auth/me` — `{ authenticated, login, name, avatar_url }` (credentials required)
- `POST /auth/logout` — clear session cookie

### Contribute

`POST /contribute` (multipart, **credentials / session cookie required**):

- `payload` — JSON string (`contribution_type`, form fields, optional `new_models` / `new_keywords`, `ID` for changes)
- `audio` — zero or more `.mp3`/`.wav` files (20 MB total cap)

Success: `{ "ok": true, "pr_url": "...", "pr_number": N, "submitted_by": "<login>" }`
