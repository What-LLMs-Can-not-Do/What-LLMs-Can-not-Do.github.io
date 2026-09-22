/** Public GitHub repo that receives contribution issues / PRs. */
export const GITHUB_REPO =
  import.meta.env.VITE_GITHUB_REPO?.trim() ||
  "What-LLMs-Can-not-Do/What-LLMs-Can-not-Do.github.io";

export const CONTRIBUTION_LABEL = "table-contribution";

/**
 * Normalize Contribute worker origin.
 * Rejects empty values and repairs accidental path-join corruption
 * (e.g. "/local/path/https:/host.workers.dev" → "https://host.workers.dev").
 */
export function resolveContributeApiUrl(raw) {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value.replace(/\/$/, "");

  const embedded = value.match(/https?:\/{1,2}[^\s]+/i);
  if (!embedded) return "";
  const fixed = embedded[0]
    .replace(/^http:\/(?!\/)/i, "http://")
    .replace(/^https:\/(?!\/)/i, "https://")
    .replace(/\/$/, "");
  return /^https?:\/\//i.test(fixed) ? fixed : "";
}

/**
 * Cloudflare Worker URL for Contribute form submissions (opens a PR).
 * Example: https://wlcd-contribute.<account>.workers.dev
 * Local: leave unset to see a clear “API not configured” error, or point at `wrangler dev`.
 */
export const CONTRIBUTE_API_URL = resolveContributeApiUrl(
  import.meta.env.VITE_CONTRIBUTE_API_URL
);

/**
 * Cloudflare Worker URL for email subscriptions.
 * Example: https://wlcd-subscribe.<account>.workers.dev
 * Override with VITE_SUBSCRIBE_API_URL (GitHub Actions variable for Pages builds).
 */
export const SUBSCRIBE_API_URL = resolveContributeApiUrl(
  import.meta.env.VITE_SUBSCRIBE_API_URL ||
    "https://wlcd-subscribe.ledman0.workers.dev"
);

/** GoatCounter site code (e.g. "wlcd" → https://wlcd.goatcounter.com). Empty disables analytics. */
export const GOATCOUNTER_CODE = import.meta.env.VITE_GOATCOUNTER_CODE?.trim() || "wlcd";
