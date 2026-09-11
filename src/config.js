/** Public GitHub repo that receives contribution issues / PRs. */
export const GITHUB_REPO =
  import.meta.env.VITE_GITHUB_REPO?.trim() ||
  "What-LLMs-Can-not-Do/What-LLMs-Can-not-Do.github.io";

export const CONTRIBUTION_LABEL = "table-contribution";

/**
 * Cloudflare Worker URL for Contribute form submissions (opens a PR).
 * Example: https://wlcd-contribute.<account>.workers.dev
 * Local: leave unset to see a clear “API not configured” error, or point at `wrangler dev`.
 */
export const CONTRIBUTE_API_URL = import.meta.env.VITE_CONTRIBUTE_API_URL?.trim() || "";

/** GoatCounter site code (e.g. "wlcd" → https://wlcd.goatcounter.com). Empty disables analytics. */
export const GOATCOUNTER_CODE = import.meta.env.VITE_GOATCOUNTER_CODE?.trim() || "wlcd";
