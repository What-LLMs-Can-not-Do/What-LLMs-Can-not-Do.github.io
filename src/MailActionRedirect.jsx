import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { SUBSCRIBE_API_URL } from "./config.js";

/**
 * Apex /confirm and /unsubscribe links land on the site (same domain as From),
 * then bounce to the subscribe worker so links match the sending domain.
 */
export default function MailActionRedirect({ action }) {
  const [params] = useSearchParams();
  const token = params.get("token") || "";

  useEffect(() => {
    const api = SUBSCRIBE_API_URL.replace(/\/$/, "");
    if (!api || !token) {
      window.location.replace(`${import.meta.env.BASE_URL}subscribe?error=missing_token`);
      return;
    }
    const target = `${api}/${action}?token=${encodeURIComponent(token)}`;
    window.location.replace(target);
  }, [action, token]);

  return (
    <main className="mx-auto max-w-lg px-4 py-16 text-center text-sm text-slate-600">
      <p>Redirecting…</p>
    </main>
  );
}
