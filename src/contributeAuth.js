/**
 * Contribute worker auth helpers.
 *
 * The site (github.io) and worker (workers.dev) are different sites, so
 * third-party cookies are often blocked. After OAuth we pass a signed session
 * via `?wlcd_gh=…`, store it in sessionStorage, and send it as
 * `Authorization: Bearer …` on API calls. Cookies remain a same-site fallback.
 */

const SESSION_STORAGE_KEY = "wlcd_gh_session";
const SESSION_QUERY_PARAM = "wlcd_gh";

export function takeSessionFromUrl() {
  if (typeof window === "undefined") return getStoredSession();
  try {
    const url = new URL(window.location.href);
    const fromQuery = url.searchParams.get(SESSION_QUERY_PARAM);
    if (fromQuery) {
      sessionStorage.setItem(SESSION_STORAGE_KEY, fromQuery);
      url.searchParams.delete(SESSION_QUERY_PARAM);
      const next = `${url.pathname}${url.search}${url.hash}`;
      window.history.replaceState({}, "", next);
      return fromQuery;
    }
  } catch {
    // Ignore malformed URLs / storage failures.
  }
  return getStoredSession();
}

export function getStoredSession() {
  try {
    return sessionStorage.getItem(SESSION_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function clearStoredSession() {
  try {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    // Ignore.
  }
}

/** credentials:include + Bearer session when available. */
export function contributeFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const sealed = getStoredSession();
  if (sealed && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${sealed}`);
  }
  return fetch(url, {
    ...options,
    headers,
    credentials: options.credentials ?? "include",
  });
}
