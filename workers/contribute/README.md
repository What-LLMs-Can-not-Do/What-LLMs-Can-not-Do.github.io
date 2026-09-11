# Contribute worker (`wlcd-contribute`)

Accepts Contribute form submissions (JSON payload + optional `.mp3`/`.wav` uploads), updates `public/data.csv` (and models/keywords/audio when needed), and opens a review PR on the site repo.

## Setup

1. Create a fine-grained GitHub PAT (or classic) with **Contents: Read and write** and **Pull requests: Read and write** on `What-LLMs-Can-not-Do/What-LLMs-Can-not-Do.github.io`.
2. From this directory:

```bash
npm install
npx wrangler login
npx wrangler secret put GITHUB_TOKEN
```

3. Optional vars in `wrangler.toml` (or override via dashboard):

| Variable | Purpose |
| --- | --- |
| `GITHUB_REPO` | Target repo (`owner/name`) |
| `ALLOWED_ORIGINS` | Comma-separated Origins allowed for CORS |

4. Deploy:

```bash
npm run deploy
```

Note the worker URL (e.g. `https://wlcd-contribute.<account>.workers.dev`).

## Local development

```bash
npm run dev
```

Point the site at the local worker:

```bash
# from the website root
VITE_CONTRIBUTE_API_URL=http://127.0.0.1:8787 npm run dev
```

## Site build (GitHub Pages)

Set repository variable / secret `VITE_CONTRIBUTE_API_URL` to the deployed worker origin (no trailing `/contribute`). The Pages workflow passes it into `npm run build`.

## API

`POST /contribute` (multipart):

- `payload` — JSON string (`contribution_type`, form fields, optional `new_models` / `new_keywords`, `ID` for changes)
- `audio` — zero or more `.mp3`/`.wav` files (20 MB total cap)

Success: `{ "ok": true, "pr_url": "...", "pr_number": N }`
