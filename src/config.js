/** Public GitHub repo that receives contribution issues / PRs. */
export const GITHUB_REPO =
  import.meta.env.VITE_GITHUB_REPO?.trim() ||
  "What-LLMs-Can-not-Do/What-LLMs-Can-not-Do.github.io";

export const CONTRIBUTION_LABEL = "table-contribution";

const CONTRIBUTE_API_DEFAULT = "https://wlcd-contribute.ledman0.workers.dev";
const SUBSCRIBE_API_DEFAULT = "https://subscribe.what-llms-can-not-do.org";

/**
 * Normalize a worker origin URL.
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

function looksLikeSubscribeApi(url) {
  return /subscribe/i.test(url);
}

function looksLikeContributeApi(url) {
  return /contribute/i.test(url);
}

/**
 * Cloudflare Worker URL for Contribute form submissions (opens a PR).
 * Override with VITE_CONTRIBUTE_API_URL (GitHub Actions variable for Pages builds).
 */
export const CONTRIBUTE_API_URL = (() => {
  const resolved = resolveContributeApiUrl(
    import.meta.env.VITE_CONTRIBUTE_API_URL || CONTRIBUTE_API_DEFAULT
  );
  // Guard against a swapped/mis-set env var pointing at the subscribe worker.
  if (!resolved || looksLikeSubscribeApi(resolved)) return CONTRIBUTE_API_DEFAULT;
  return resolved;
})();

/**
 * Cloudflare Worker URL for email subscriptions.
 * Override with VITE_SUBSCRIBE_API_URL (GitHub Actions variable for Pages builds).
 */
export const SUBSCRIBE_API_URL = (() => {
  const resolved = resolveContributeApiUrl(
    import.meta.env.VITE_SUBSCRIBE_API_URL || SUBSCRIBE_API_DEFAULT
  );
  if (!resolved || looksLikeContributeApi(resolved)) return SUBSCRIBE_API_DEFAULT;
  return resolved;
})();

/** GoatCounter site code (e.g. "wlcd" → https://wlcd.goatcounter.com). Empty disables analytics. */
export const GOATCOUNTER_CODE = import.meta.env.VITE_GOATCOUNTER_CODE?.trim() || "wlcd";
