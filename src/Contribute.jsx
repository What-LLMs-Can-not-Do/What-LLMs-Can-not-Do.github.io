import { useCallback, useEffect, useState } from "react";
import { CONTRIBUTE_API_URL } from "./config.js";
import {
  clearStoredSession,
  contributeFetch,
  takeSessionFromUrl,
} from "./contributeAuth.js";
import ContributionForm, { initialForm } from "./ContributionForm.jsx";

export default function Contribute() {
  const [mode, setMode] = useState("addition");
  const [entryId, setEntryId] = useState("");
  const [form, setForm] = useState(initialForm);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [prUrl, setPrUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [audioFiles, setAudioFiles] = useState([]);
  const [ghUser, setGhUser] = useState(null);
  const [ghAuthLoading, setGhAuthLoading] = useState(Boolean(CONTRIBUTE_API_URL));

  const onFormChange = useCallback((next) => setForm(next), []);

  useEffect(() => {
    if (!CONTRIBUTE_API_URL) {
      setGhAuthLoading(false);
      return undefined;
    }
    let cancelled = false;
    takeSessionFromUrl();
    const endpoint = CONTRIBUTE_API_URL.replace(/\/$/, "") + "/auth/me";
    contributeFetch(endpoint)
      .then((response) => response.json().catch(() => ({})))
      .then((data) => {
        if (cancelled) return;
        if (data?.authenticated && data.login) {
          setGhUser({
            login: data.login,
            name: data.name || data.login,
            avatar_url: data.avatar_url || "",
          });
        } else {
          clearStoredSession();
          setGhUser(null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          clearStoredSession();
          setGhUser(null);
        }
      })
      .finally(() => {
        if (!cancelled) setGhAuthLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const startGitHubLogin = () => {
    if (!CONTRIBUTE_API_URL) {
      setError("Contribute API URL is not configured.");
      return;
    }
    let cleanReturn = window.location.href;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("wlcd_gh");
      cleanReturn = url.toString();
    } catch {
      // Keep current href.
    }
    const loginUrl =
      CONTRIBUTE_API_URL.replace(/\/$/, "") +
      "/auth/login?return_to=" +
      encodeURIComponent(cleanReturn);
    window.location.assign(loginUrl);
  };

  const signOutGitHub = async () => {
    if (!CONTRIBUTE_API_URL) return;
    clearStoredSession();
    try {
      await contributeFetch(CONTRIBUTE_API_URL.replace(/\/$/, "") + "/auth/logout", {
        method: "POST",
      });
    } catch {
      // Ignore network errors; clear local session UI either way.
    }
    setGhUser(null);
  };

  const handleSubmit = async ({ payload, audioFiles: files }) => {
    if (!CONTRIBUTE_API_URL) {
      setError(
        "Contribute API is not configured (set VITE_CONTRIBUTE_API_URL). Locally, run the worker with wrangler and point the env var at it."
      );
      return;
    }
    if (!ghUser) {
      setError("Sign in with GitHub before submitting.");
      return;
    }

    const body = new FormData();
    body.append("payload", JSON.stringify(payload));
    for (const file of files) {
      body.append("audio", file, file.name);
    }

    setSubmitting(true);
    try {
      const endpoint = CONTRIBUTE_API_URL.replace(/\/$/, "") + "/contribute";
      const response = await contributeFetch(endpoint, {
        method: "POST",
        body,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401) {
          clearStoredSession();
          setGhUser(null);
        }
        throw new Error(result.error || `Submission failed (${response.status})`);
      }
      if (!result.pr_url) {
        throw new Error("Worker did not return a pull request URL");
      }

      setPrUrl(result.pr_url);
      setStatus("sent");
      setAudioFiles([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <h1 className="!mt-0 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
        {mode === "change" ? "Suggest a change" : "Suggest an addition"}
      </h1>
      {mode === "change" ? (
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-600">
          Propose edits to an existing table entry. Enter its ID to load the current values,
          then sign in with GitHub and submit — a pull request is opened under your account.
        </p>
      ) : (
        <div className="mt-3 flex max-w-2xl flex-col gap-3 text-sm leading-relaxed text-slate-600">
          <p className="m-0">
            Propose a benchmark or paper for the table. Sign in with GitHub, then submit to
            open a pull request under your account for review.
          </p>
          <div className="flex flex-col gap-1.5">
            <p className="m-0 font-medium text-slate-800">Criteria</p>
            <ul className="m-0 list-disc space-y-1 pl-5">
              <li>
                The paper must be from{" "}
                <strong className="font-medium text-slate-800">2025 or later</strong>. If the
                original work is older but someone has tested the same task on a newer model,
                submit that newer evaluation instead.
              </li>
              <li>
                The paper must include a{" "}
                <strong className="font-medium text-slate-800">human baseline</strong>, or use{" "}
                <strong className="font-medium text-slate-800">
                  objective human-annotated labels
                </strong>
                .
              </li>
            </ul>
          </div>
          <div className="flex flex-col gap-1.5">
            <p className="m-0">
              <span className="font-medium text-slate-800">For now,</span> we will not accept
              papers that fall under:
            </p>
            <ul className="m-0 list-disc space-y-1 pl-5">
              <li>Non-natural language tasks (e.g. computer vision)</li>
              <li>Tasks focused on tool use or agentic LLMs</li>
            </ul>
            <p className="m-0">
              We&apos;re looking for experts in these fields to help review submissions. If
              that&apos;s you, contact us.
            </p>
          </div>
        </div>
      )}

      {status === "sent" ? (
        <div className="mt-8 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
          <p className="font-medium">Pull request opened.</p>
          <p className="mt-1">Thanks — maintainers will review the CSV in the PR.</p>
          {prUrl ? (
            <p className="mt-2">
              <a
                href={prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-emerald-900 underline hover:text-emerald-950"
              >
                View pull request
              </a>
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setStatus("idle");
              setPrUrl("");
              setEntryId("");
              setForm(initialForm);
              setAudioFiles([]);
              setError("");
            }}
            className="mt-4 text-sm font-medium text-emerald-800 underline hover:text-emerald-950"
          >
            Submit another
          </button>
        </div>
      ) : (
        <div className="mt-8">
          <ContributionForm
            mode={mode}
            onModeChange={setMode}
            entryId={entryId}
            onEntryIdChange={setEntryId}
            form={form}
            onFormChange={onFormChange}
            audioFiles={audioFiles}
            onAudioFilesChange={setAudioFiles}
            showCriteria={false}
            error={error}
            onError={setError}
            submitting={submitting}
            submitDisabled={ghAuthLoading || !ghUser}
            submitLabel="Submit pull request"
            submittingLabel="Opening pull request…"
            onSubmit={handleSubmit}
            topSlot={
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5">
                {ghAuthLoading ? (
                  <p className="m-0 text-sm text-slate-600">Checking GitHub sign-in…</p>
                ) : ghUser ? (
                  <>
                    <div className="flex min-w-0 items-center gap-2.5">
                      {ghUser.avatar_url ? (
                        <img
                          src={ghUser.avatar_url}
                          alt=""
                          className="h-7 w-7 rounded-full"
                          width={28}
                          height={28}
                        />
                      ) : null}
                      <p className="m-0 truncate text-sm text-slate-700">
                        Signed in as{" "}
                        <a
                          href={`https://github.com/${ghUser.login}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-slate-900 underline"
                        >
                          @{ghUser.login}
                        </a>
                        <span className="text-slate-500">
                          {" "}
                          — PR will be opened from your account
                        </span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={signOutGitHub}
                      className="text-sm font-medium text-slate-600 underline hover:text-slate-900"
                    >
                      Sign out
                    </button>
                  </>
                ) : (
                  <>
                    <p className="m-0 text-sm text-slate-600">
                      Sign in with GitHub so the pull request is opened under your account.
                    </p>
                    <button
                      type="button"
                      onClick={startGitHubLogin}
                      className="inline-flex items-center rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
                    >
                      Sign in with GitHub
                    </button>
                  </>
                )}
              </div>
            }
            extraActions={
              <span className="text-xs text-slate-500">
                {ghUser
                  ? `Creates a PR as @${ghUser.login}`
                  : "Sign in with GitHub to submit"}
              </span>
            }
          />
        </div>
      )}
    </main>
  );
}
