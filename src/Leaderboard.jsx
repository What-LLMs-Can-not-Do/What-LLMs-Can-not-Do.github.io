import { useEffect, useState } from "react";
import { CONTRIBUTE_API_URL } from "./config.js";

function rankLabel(rank) {
  if (rank === 1) return "1st";
  if (rank === 2) return "2nd";
  if (rank === 3) return "3rd";
  return `${rank}th`;
}

export default function Leaderboard() {
  const [contributors, setContributors] = useState([]);
  const [mergedPrs, setMergedPrs] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!CONTRIBUTE_API_URL) {
      setError("Contribute API is not configured (set VITE_CONTRIBUTE_API_URL).");
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    setError("");
    const endpoint = CONTRIBUTE_API_URL.replace(/\/$/, "") + "/leaderboard";
    fetch(endpoint)
      .then(async (response) => {
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(result.error || `Request failed (${response.status})`);
        }
        if (cancelled) return;
        setContributors(result.contributors || []);
        setMergedPrs(Number(result.merged_prs) || 0);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load leaderboard");
          setContributors([]);
          setMergedPrs(0);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <h1 className="!mt-0 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
        Contributor leaderboard
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-600">
        Ranked by merged table contribution pull requests (additions and changes) opened via
        the Contribute form.
      </p>

      {loading ? (
        <p className="mt-8 text-sm text-slate-600">Loading contributions…</p>
      ) : error ? (
        <p className="mt-8 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : contributors.length === 0 ? (
        <p className="mt-8 text-sm text-slate-600">No merged table contributions yet.</p>
      ) : (
        <>
          <p className="mt-6 text-xs text-slate-500">
            {mergedPrs} merged table PR{mergedPrs === 1 ? "" : "s"} · {contributors.length}{" "}
            contributor{contributors.length === 1 ? "" : "s"}
          </p>
          <ol className="mt-4 space-y-2">
            {contributors.map((entry, index) => {
              const rank = index + 1;
              const profile = `https://github.com/${entry.login}`;
              return (
                <li key={entry.login.toLowerCase()}>
                  <a
                    href={profile}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-3 py-3 transition hover:border-slate-300 hover:bg-slate-50"
                  >
                    <span
                      className={`w-10 shrink-0 text-center text-sm font-semibold tabular-nums ${
                        rank <= 3 ? "text-slate-900" : "text-slate-500"
                      }`}
                    >
                      {rankLabel(rank)}
                    </span>
                    {entry.avatar_url ? (
                      <img
                        src={entry.avatar_url}
                        alt=""
                        width={40}
                        height={40}
                        className="h-10 w-10 rounded-full bg-slate-100"
                      />
                    ) : (
                      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-sm font-medium text-slate-600">
                        {entry.login.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-slate-900">@{entry.login}</div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {entry.additions > 0 ? (
                          <span>
                            {entry.additions} addition{entry.additions === 1 ? "" : "s"}
                          </span>
                        ) : null}
                        {entry.additions > 0 && entry.changes > 0 ? (
                          <span className="text-slate-300"> · </span>
                        ) : null}
                        {entry.changes > 0 ? (
                          <span>
                            {entry.changes} change{entry.changes === 1 ? "" : "s"}
                          </span>
                        ) : null}
                        {entry.additions === 0 && entry.changes === 0 ? (
                          <span>{entry.total} contribution{entry.total === 1 ? "" : "s"}</span>
                        ) : null}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-lg font-semibold tabular-nums text-slate-900">
                        {entry.total}
                      </div>
                      <div className="text-[10px] uppercase tracking-wide text-slate-500">
                        total
                      </div>
                    </div>
                  </a>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </main>
  );
}
