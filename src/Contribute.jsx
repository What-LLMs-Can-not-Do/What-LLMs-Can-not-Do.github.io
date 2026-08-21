import { useEffect, useMemo, useState } from "react";
import { CONTRIBUTION_LABEL, GITHUB_REPO } from "./config.js";
import { parseKeywords, splitKeywords } from "./parseCsv.js";

const CATEGORIES = [
  "Expert Knowledge",
  "Linguistics",
  "General NLP tasks",
  "Tasks with reasoning",
  "Cross-lingual tasks",
];

const HUMAN_BENCHMARK_OPTIONS = ["yes", "no", "unclear / other"];

const KEYWORD_STYLES = {
  Attribute: { background: "#ede9fe", color: "#5b21b6", border: "#ddd6fe" },
  Domain: { background: "#e0f2fe", color: "#075985", border: "#bae6fd" },
  Format: { background: "#dcfce7", color: "#166534", border: "#bbf7d0" },
  Language: { background: "#ffedd5", color: "#9a3412", border: "#fed7aa" },
  Task: { background: "#fce7f3", color: "#9d174d", border: "#fbcfe8" },
};

const FALLBACK_STYLE = { background: "#f1f5f9", color: "#475569", border: "#e2e8f0" };

const FIELD_CLASS =
  "mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm outline-none focus:border-slate-400";
const LABEL_CLASS = "block text-sm font-medium text-slate-700";

/** Keep issue URLs under common browser / proxy limits. */
const MAX_ISSUE_URL_LENGTH = 7200;

function Field({ label, hint, children, className = "" }) {
  return (
    <label className={`block ${className}`}>
      <span className={LABEL_CLASS}>{label}</span>
      {hint ? <span className="mt-0.5 block text-xs text-slate-500">{hint}</span> : null}
      {children}
    </label>
  );
}

function formatKeywordList(keywords) {
  return keywords.join(", ");
}

function hasKeyword(selected, keyword) {
  const lower = keyword.toLowerCase();
  return selected.some((item) => item.toLowerCase() === lower);
}

function buildIssueContent(form) {
  const title = `[Table contribution] ${form["Paper title"] || "Untitled"}`;
  const payload = { ...form };
  const body = [
    "<!-- wlcd-contribution-v1 -->",
    "## Table contribution",
    "",
    "Submitted via the website form. A workflow will open a pull request that appends this entry to `public/data.csv` for review.",
    "",
    `**Paper:** ${form["Paper title"]}`,
    `**Link:** ${form.Link}`,
    "",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
    "",
  ].join("\n");

  return { title, body };
}

function buildIssueUrl(title, body, { includeBody = true } = {}) {
  const params = new URLSearchParams();
  params.set("title", title);
  params.set("labels", CONTRIBUTION_LABEL);
  if (includeBody) params.set("body", body);
  return `https://github.com/${GITHUB_REPO}/issues/new?${params.toString()}`;
}

const initialForm = {
  "General category": "",
  Keywords: "",
  "Paper title": "",
  License: "",
  "Language(s) tested": "",
  "Model(s) tested": "",
  "Year of publication": "",
  Link: "",
  Summary: "",
  "Human benchmark?": "",
  Closed: "",
  "Open-weight": "",
  "Open-source": "",
  "Benchmark Example": "",
  Abstract: "",
  Comments: "",
};

export default function Contribute() {
  const [form, setForm] = useState(initialForm);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [pasteHint, setPasteHint] = useState(false);
  const [keywordList, setKeywordList] = useState([]);

  const selectedKeywords = useMemo(
    () => splitKeywords(form.Keywords),
    [form.Keywords]
  );

  useEffect(() => {
    const asset = (path) => `${import.meta.env.BASE_URL}${path}`;
    fetch(asset("keywords.csv"))
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load keywords.csv (${response.status})`);
        return response.text();
      })
      .then((text) => {
        const { list } = parseKeywords(text);
        setKeywordList(list);
      })
      .catch(() => setKeywordList([]));
  }, []);

  const update = (key) => (event) => {
    setForm((prev) => ({ ...prev, [key]: event.target.value }));
  };

  const toggleKeyword = (keyword) => {
    setForm((prev) => {
      const current = splitKeywords(prev.Keywords);
      const next = hasKeyword(current, keyword)
        ? current.filter((item) => item.toLowerCase() !== keyword.toLowerCase())
        : [...current, keyword];
      return { ...prev, Keywords: formatKeywordList(next) };
    });
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setPasteHint(false);

    const { title, body } = buildIssueContent(form);
    let url = buildIssueUrl(title, body);

    if (url.length > MAX_ISSUE_URL_LENGTH) {
      try {
        await navigator.clipboard.writeText(body);
        setPasteHint(true);
      } catch {
        setError(
          "Submission is too large to open automatically. Copy the generated issue body manually, then continue on GitHub."
        );
        return;
      }
      url = buildIssueUrl(
        title,
        [
          "<!-- wlcd-contribution-v1 -->",
          "## Table contribution",
          "",
          "The full submission was copied to your clipboard because it was too large for the URL.",
          "Paste it here (Ctrl/Cmd+V), replacing these instructions, then submit the issue.",
          "",
        ].join("\n")
      );
    }

    setStatus("sent");
    setForm(initialForm);
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <h1 className="!mt-0 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
        Suggest an addition
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-600">
        Propose a benchmark or paper for the table. Submitting opens a GitHub issue;
        a pull request is created automatically. You need a GitHub account to finish
        the submission.
      </p>

      {status === "sent" ? (
        <div className="mt-8 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
          <p className="font-medium">Continue on GitHub to finish.</p>
          <p className="mt-1">
            A new browser tab should have opened with a prefilled issue. Submit that
            issue, then maintainers will get a PR to review.
          </p>
          {pasteHint && (
            <p className="mt-2 rounded border border-emerald-300 bg-white/70 px-3 py-2 text-emerald-950">
              The full submission was copied to your clipboard — paste it into the issue
              body before submitting.
            </p>
          )}
          <button
            type="button"
            onClick={() => {
              setStatus("idle");
              setPasteHint(false);
            }}
            className="mt-4 text-sm font-medium text-emerald-800 underline hover:text-emerald-950"
          >
            Submit another
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 space-y-8">
          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">Paper / benchmark</h2>
            <Field label="Paper title">
              <input
                required
                value={form["Paper title"]}
                onChange={update("Paper title")}
                className={FIELD_CLASS}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Link">
                <input
                  required
                  type="url"
                  placeholder="https://"
                  value={form.Link}
                  onChange={update("Link")}
                  className={FIELD_CLASS}
                />
              </Field>
              <Field label="Year">
                <input
                  inputMode="numeric"
                  placeholder="2025"
                  value={form["Year of publication"]}
                  onChange={update("Year of publication")}
                  className={FIELD_CLASS}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="General category">
                <select
                  required
                  value={form["General category"]}
                  onChange={update("General category")}
                  className={FIELD_CLASS}
                >
                  <option value="" disabled>
                    Select a category
                  </option>
                  {CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="License">
                <input
                  value={form.License}
                  onChange={update("License")}
                  placeholder="MIT, Apache-2.0, …"
                  className={FIELD_CLASS}
                />
              </Field>
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={LABEL_CLASS}>Keywords</span>
                <span className="text-xs text-slate-500">Click chips to add or remove</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {keywordList.map(({ keyword, category }) => {
                  const style = KEYWORD_STYLES[category] ?? FALLBACK_STYLE;
                  const isSelected = hasKeyword(selectedKeywords, keyword);
                  return (
                    <button
                      key={keyword}
                      type="button"
                      title={category}
                      onClick={() => toggleKeyword(keyword)}
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border transition ${
                        isSelected
                          ? "ring-2 ring-offset-1 ring-slate-400 scale-105"
                          : "opacity-90 hover:opacity-100"
                      }`}
                      style={{
                        backgroundColor: style.background,
                        color: style.color,
                        borderColor: style.border,
                      }}
                    >
                      {keyword}
                    </button>
                  );
                })}
              </div>
              <input
                value={form.Keywords}
                onChange={update("Keywords")}
                placeholder="Selected keywords appear here; you can also type extras"
                className={FIELD_CLASS}
                aria-label="Keywords"
              />
            </div>
            <Field label="Summary">
              <textarea
                rows={3}
                value={form.Summary}
                onChange={update("Summary")}
                className={FIELD_CLASS}
              />
            </Field>
          </section>

          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">Evaluation details</h2>
            <Field label="Language(s) tested" hint="Comma-separated">
              <input
                value={form["Language(s) tested"]}
                onChange={update("Language(s) tested")}
                className={FIELD_CLASS}
              />
            </Field>
            <Field label="Model(s) tested" hint="Comma-separated">
              <input
                value={form["Model(s) tested"]}
                onChange={update("Model(s) tested")}
                className={FIELD_CLASS}
              />
            </Field>
            <Field label="Human benchmark?">
              <select
                value={form["Human benchmark?"]}
                onChange={update("Human benchmark?")}
                className={FIELD_CLASS}
              >
                <option value="">Select</option>
                {HUMAN_BENCHMARK_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </Field>
            <div>
              <p className={LABEL_CLASS}>Who is better?</p>
              <p className="mt-0.5 text-xs text-slate-500">
                e.g. Humans, LLMs, LLMs (1+), Humans (by assumption)
              </p>
              <div className="mt-2 grid gap-4 sm:grid-cols-3">
                <Field label="Closed">
                  <input value={form.Closed} onChange={update("Closed")} className={FIELD_CLASS} />
                </Field>
                <Field label="Open-weight">
                  <input
                    value={form["Open-weight"]}
                    onChange={update("Open-weight")}
                    className={FIELD_CLASS}
                  />
                </Field>
                <Field label="Open-source">
                  <input
                    value={form["Open-source"]}
                    onChange={update("Open-source")}
                    className={FIELD_CLASS}
                  />
                </Field>
              </div>
            </div>
            <Field label="Benchmark example">
              <textarea
                rows={4}
                value={form["Benchmark Example"]}
                onChange={update("Benchmark Example")}
                className={FIELD_CLASS}
              />
            </Field>
            <Field label="Abstract">
              <textarea
                rows={5}
                value={form.Abstract}
                onChange={update("Abstract")}
                className={FIELD_CLASS}
              />
            </Field>
            <Field label="Comments" hint="Optional notes for the maintainers">
              <textarea
                rows={3}
                value={form.Comments}
                onChange={update("Comments")}
                className={FIELD_CLASS}
              />
            </Field>
          </section>

          {error && (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              className="inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Continue on GitHub
            </button>
            <span className="text-xs text-slate-500">Opens a prefilled issue → auto PR</span>
          </div>
        </form>
      )}
    </main>
  );
}
