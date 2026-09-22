import { useEffect, useState } from "react";
import { SUBSCRIBE_API_URL } from "./config.js";

const SESSION_KEY = "wlcd_admin_password";

export default function Admin() {
  const [password, setPassword] = useState(() => sessionStorage.getItem(SESSION_KEY) || "");
  const [input, setInput] = useState("");
  const [subscribers, setSubscribers] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async (pwd) => {
    if (!SUBSCRIBE_API_URL) {
      setError("Subscribe API is not configured (set VITE_SUBSCRIBE_API_URL).");
      return;
    }
    if (!pwd.trim()) {
      setError("Enter the admin password.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const endpoint = SUBSCRIBE_API_URL.replace(/\/$/, "") + "/admin/subscribers";
      const response = await fetch(endpoint, {
        headers: { "X-Admin-Password": pwd.trim() },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || `Request failed (${response.status})`);
      }
      sessionStorage.setItem(SESSION_KEY, pwd.trim());
      setPassword(pwd.trim());
      setSubscribers(result.subscribers || []);
    } catch (err) {
      sessionStorage.removeItem(SESSION_KEY);
      setPassword("");
      setSubscribers([]);
      setError(err instanceof Error ? err.message : "Failed to load subscribers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (password) {
      load(password);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only auto-load stored session once
  }, []);

  const onSubmit = (event) => {
    event.preventDefault();
    load(input);
  };

  const signOut = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setPassword("");
    setInput("");
    setSubscribers([]);
    setError("");
  };

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:px-8">
      <h1 className="!mt-0 text-3xl font-semibold tracking-tight text-slate-900">Admin</h1>

      {!password ? (
        <form onSubmit={onSubmit} className="mt-8 max-w-sm space-y-4">
          <div>
            <label htmlFor="admin-password" className="block text-sm font-medium text-slate-800">
              Password
            </label>
            <input
              id="admin-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={input}
              onChange={(event) => setInput(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
            />
          </div>
          {error ? (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {loading ? "Checking…" : "Sign in"}
          </button>
        </form>
      ) : (
        <div className="mt-8 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 text-sm text-slate-600">
              {loading
                ? "Loading…"
                : `${subscribers.length} subscriber${subscribers.length === 1 ? "" : "s"}`}
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => load(password)}
                disabled={loading}
                className="text-sm font-medium text-slate-700 underline hover:text-slate-900 disabled:opacity-60"
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={signOut}
                className="text-sm font-medium text-slate-700 underline hover:text-slate-900"
              >
                Sign out
              </button>
            </div>
          </div>

          {error ? (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}

          <div className="overflow-x-auto rounded-md border border-slate-200">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Email</th>
                  <th className="px-3 py-2 font-medium">Topics</th>
                  <th className="px-3 py-2 font-medium">Confirmed</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                  <th className="px-3 py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {subscribers.length === 0 && !loading ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                      No subscribers yet.
                    </td>
                  </tr>
                ) : (
                  subscribers.map((row) => (
                    <tr key={row.email}>
                      <td className="px-3 py-2 font-medium text-slate-900">{row.email}</td>
                      <td className="px-3 py-2 text-slate-700">
                        {(row.topics || []).join(", ") || "—"}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {row.confirmed ? "yes" : "no"}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-500">
                        {formatDate(row.created_at)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-slate-500">
                        {formatDate(row.updated_at)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  );
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
