import { useCallback, useEffect, useMemo, useState } from "react";
import { CONTRIBUTE_API_URL } from "./config.js";
import ContributionForm, { initialForm } from "./ContributionForm.jsx";

const SESSION_KEY = "wlcd_admin_password";

function formFromPayload(payload) {
  if (!payload || typeof payload !== "object") return initialForm;
  const next = { ...initialForm };
  for (const key of Object.keys(initialForm)) {
    if (payload[key] != null) next[key] = String(payload[key]);
  }
  return next;
}

async function reviewFetch(path, password, init = {}) {
  if (!CONTRIBUTE_API_URL) {
    throw new Error("Contribute API is not configured (set VITE_CONTRIBUTE_API_URL).");
  }
  const endpoint = CONTRIBUTE_API_URL.replace(/\/$/, "") + path;
  const headers = new Headers(init.headers || {});
  headers.set("X-Admin-Password", password);
  const response = await fetch(endpoint, { ...init, headers });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || `Request failed (${response.status})`);
  }
  return result;
}

export default function Review() {
  const [password, setPassword] = useState(
    () => sessionStorage.getItem(SESSION_KEY) || ""
  );
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [prs, setPrs] = useState([]);
  const [selectedNumber, setSelectedNumber] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [prMeta, setPrMeta] = useState(null);
  const [mode, setMode] = useState("addition");
  const [entryId, setEntryId] = useState("");
  const [form, setForm] = useState(initialForm);
  const [audioFiles, setAudioFiles] = useState([]);
  const [formError, setFormError] = useState("");
  const [presetExtras, setPresetExtras] = useState(null);
  const [baselineForm, setBaselineForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [merging, setMerging] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const onFormChange = useCallback((next) => setForm(next), []);

  const loadList = async (pwd) => {
    if (!pwd.trim()) {
      setError("Enter the admin password.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await reviewFetch("/review/prs", pwd.trim());
      sessionStorage.setItem(SESSION_KEY, pwd.trim());
      setPassword(pwd.trim());
      setPrs(result.pull_requests || []);
    } catch (err) {
      sessionStorage.removeItem(SESSION_KEY);
      setPassword("");
      setPrs([]);
      setError(err instanceof Error ? err.message : "Failed to load pull requests");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (password) {
      loadList(password);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only auto-load stored session once
  }, []);

  const loadDetail = async (number) => {
    if (!password) return;
    setSelectedNumber(number);
    setDetailLoading(true);
    setFormError("");
    setStatusMessage("");
    setAudioFiles([]);
    setPresetExtras(null);
    setBaselineForm(null);
    try {
      const result = await reviewFetch(`/review/prs/${number}`, password);
      const payload = result.payload || {};
      const contributionType =
        String(payload.contribution_type || result.contribution_type || "addition").toLowerCase() ===
        "change"
          ? "change"
          : "addition";
      setPrMeta(result.pull_request || null);
      setMode(contributionType);
      setEntryId(payload.ID != null ? String(payload.ID) : "");
      setForm(formFromPayload(payload));
      setBaselineForm(
        contributionType === "change" && result.baseline
          ? formFromPayload(result.baseline)
          : null
      );
      setPresetExtras({
        key: `${number}-${result.pull_request?.head_sha || ""}`,
        new_models: payload.new_models || [],
        new_keywords: payload.new_keywords || [],
      });
    } catch (err) {
      setPrMeta(null);
      setForm(initialForm);
      setBaselineForm(null);
      setFormError(err instanceof Error ? err.message : "Failed to load pull request");
    } finally {
      setDetailLoading(false);
    }
  };

  const onPasswordSubmit = (event) => {
    event.preventDefault();
    loadList(input);
  };

  const signOut = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setPassword("");
    setInput("");
    setPrs([]);
    setSelectedNumber(null);
    setPrMeta(null);
    setForm(initialForm);
    setBaselineForm(null);
    setError("");
    setFormError("");
    setStatusMessage("");
  };

  const handleSave = async ({ payload, audioFiles: files }) => {
    if (!selectedNumber || !password) return;
    setSaving(true);
    setFormError("");
    setStatusMessage("");
    try {
      const body = new FormData();
      body.append("payload", JSON.stringify(payload));
      for (const file of files) {
        body.append("audio", file, file.name);
      }
      const result = await reviewFetch(`/review/prs/${selectedNumber}`, password, {
        method: "POST",
        body,
      });
      setStatusMessage(`Saved review edits (commit ${String(result.commit_sha || "").slice(0, 7)}).`);
      setAudioFiles([]);
      await loadDetail(selectedNumber);
      await loadList(password);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  const handleMerge = async () => {
    if (!selectedNumber || !password) return;
    if (!window.confirm(`Merge pull request #${selectedNumber}?`)) return;
    setMerging(true);
    setFormError("");
    setStatusMessage("");
    try {
      const result = await reviewFetch(`/review/prs/${selectedNumber}/merge`, password, {
        method: "POST",
      });
      setStatusMessage(result.message || `Merged #${selectedNumber}.`);
      setSelectedNumber(null);
      setPrMeta(null);
      setForm(initialForm);
      setBaselineForm(null);
      setPresetExtras(null);
      await loadList(password);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to merge pull request";
      if (/merge conflict/i.test(message)) {
        setFormError(
          `${message} Click “Save to PR” to rebuild onto current main, then Merge again.`
        );
      } else {
        setFormError(message);
      }
    } finally {
      setMerging(false);
    }
  };

  const presetForForm = useMemo(() => {
    if (!presetExtras) return null;
    return {
      new_models: presetExtras.new_models,
      new_keywords: presetExtras.new_keywords,
    };
  }, [presetExtras]);

  if (!password) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 sm:px-8">
        <h1 className="!mt-0 text-2xl font-semibold tracking-tight text-slate-900">
          Review contributions
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Enter the admin password to list and merge open table contribution pull requests.
        </p>
        <form onSubmit={onPasswordSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="block text-sm font-medium text-slate-700">Admin password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-slate-400"
            />
          </label>
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
            {loading ? "Signing in…" : "Continue"}
          </button>
        </form>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="!mt-0 text-3xl font-semibold tracking-tight text-slate-900">
            Review contributions
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Open table addition/change pull requests. Edit fields, save fixes to the PR branch,
            then merge.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => loadList(password)}
            disabled={loading}
            className="text-sm font-medium text-slate-600 underline hover:text-slate-900"
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
          <button
            type="button"
            onClick={signOut}
            className="text-sm font-medium text-slate-600 underline hover:text-slate-900"
          >
            Sign out
          </button>
        </div>
      </div>

      {error ? (
        <p className="mt-4 text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(16rem,20rem)_1fr]">
        <aside className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Open PRs ({prs.length})
          </h2>
          {prs.length === 0 ? (
            <p className="text-sm text-slate-600">No open table contribution PRs.</p>
          ) : (
            <ul className="space-y-1">
              {prs.map((pr) => {
                const active = pr.number === selectedNumber;
                return (
                  <li key={pr.number}>
                    <button
                      type="button"
                      onClick={() => loadDetail(pr.number)}
                      className={`w-full rounded-md border px-3 py-2 text-left text-sm transition ${
                        active
                          ? "border-slate-400 bg-slate-100"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <div className="font-medium text-slate-900">#{pr.number}</div>
                      <div className="mt-0.5 line-clamp-2 text-slate-700">{pr.title}</div>
                      <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5">{pr.kind}</span>
                        {pr.user ? <span>@{pr.user}</span> : null}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <section>
          {!selectedNumber ? (
            <p className="text-sm text-slate-600">Select a pull request to review.</p>
          ) : detailLoading ? (
            <p className="text-sm text-slate-600">Loading pull request…</p>
          ) : (
            <div className="space-y-6">
              <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="m-0 text-sm font-semibold text-slate-900">
                      #{prMeta?.number}: {prMeta?.title}
                    </p>
                    <p className="mt-1 m-0 text-xs text-slate-600">
                      {prMeta?.user ? (
                        <>
                          Submitted by{" "}
                          <a
                            href={`https://github.com/${prMeta.user}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline"
                          >
                            @{prMeta.user}
                          </a>
                          {" · "}
                        </>
                      ) : null}
                      <a
                        href={prMeta?.html_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        View on GitHub
                      </a>
                    </p>
                  </div>
                  <span className="rounded bg-white px-2 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                    {mode}
                    {mode === "change" && entryId ? ` · ID ${entryId}` : ""}
                  </span>
                </div>
              </div>

              {statusMessage ? (
                <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                  {statusMessage}
                </p>
              ) : null}

              <ContributionForm
                key={presetExtras?.key || selectedNumber}
                mode={mode}
                onModeChange={setMode}
                entryId={entryId}
                onEntryIdChange={setEntryId}
                form={form}
                onFormChange={onFormChange}
                audioFiles={audioFiles}
                onAudioFilesChange={setAudioFiles}
                showModeTabs={false}
                showEntryId={mode === "change"}
                showCriteria={false}
                lockMode
                baselineForm={baselineForm}
                presetExtras={presetForForm}
                presetKey={presetExtras?.key || ""}
                error={formError}
                onError={setFormError}
                submitting={saving}
                submitDisabled={merging}
                submitLabel="Save to PR"
                submittingLabel="Saving…"
                onSubmit={handleSave}
                extraActions={
                  <>
                    <button
                      type="button"
                      onClick={handleMerge}
                      disabled={saving || merging}
                      className="inline-flex items-center rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {merging ? "Merging…" : "Merge"}
                    </button>
                    <span className="text-xs text-slate-500">
                      Save writes a commit on the PR branch; Merge merges into main.
                    </span>
                  </>
                }
              />
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
