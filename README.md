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
