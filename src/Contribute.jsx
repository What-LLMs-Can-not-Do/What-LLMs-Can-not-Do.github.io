import { useEffect, useMemo, useRef, useState } from "react";
import { CONTRIBUTION_LABEL, GITHUB_REPO } from "./config.js";
import {
  findTableRowById,
  groupKeywordsByCategory,
  parseKeywords,
  parseTableCsv,
  sortKeywords,
  splitKeywords,
  tableRowToContributionForm,
} from "./parseCsv.js";

const CATEGORIES = [
  "Expert Knowledge",
  "Linguistics",
  "General NLP tasks",
  "Reasoning",
  "Cross-lingual tasks",
];

const HUMAN_BENCHMARK_OPTIONS = ["yes", "no"];

const WHO_IS_BETTER_OPTIONS = [
  "Not tested",
  "LLMs",
  "Humans",
  "Humans (trivial)",
];

const WHO_IS_BETTER_OPEN_SOURCE_OPTIONS = [
  ...WHO_IS_BETTER_OPTIONS,
  "Humans (by assumption)",
];

const KEYWORD_STYLES = {
  Modality: { background: "#ccfbf1", color: "#0f766e", border: "#99f6e4" },
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
const SUMMARY_MIN_LENGTH = 120;
const SUMMARY_MAX_LENGTH = 200;

function Field({ label, hint, children, className = "" }) {
  return (
    <label className={`block ${className}`}>
      <span className={LABEL_CLASS}>{label}</span>
      {hint ? <div className="mt-0.5 text-xs text-slate-500">{hint}</div> : null}
      {children}
    </label>
  );
}

function WhoIsBetterInput({ value, onChange, listId, options }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef(null);

  const filteredOptions = useMemo(() => {
    const query = value.trim().toLowerCase();
    if (!query) return options;
    return options.filter((option) => option.toLowerCase().includes(query));
  }, [value, options]);

  useEffect(() => {
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [value, open]);

  const selectOption = (option) => {
    onChange({ target: { value: option } });
    setOpen(false);
  };

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      setOpen(true);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, Math.max(filteredOptions.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Enter" && open && filteredOptions[activeIndex]) {
      event.preventDefault();
      selectOption(filteredOptions[activeIndex]);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <input
        value={value}
        onChange={(event) => {
          onChange(event);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        className={FIELD_CLASS}
      />
      {open && filteredOptions.length > 0 && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-56 overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          {filteredOptions.map((option, index) => (
            <li key={option}>
              <button
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectOption(option)}
                className={`block w-full px-3 py-1.5 text-left text-sm text-black ${
                  index === activeIndex ? "bg-slate-100" : "bg-white"
                }`}
              >
                {option}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatKeywordList(keywords) {
  return keywords.join(", ");
}

function hasKeyword(selected, keyword) {
  const lower = keyword.toLowerCase();
  return selected.some((item) => item.toLowerCase() === lower);
}

function buildIssueContent(form, { mode = "addition", entryId = "" } = {}) {
  const payload =
    mode === "change"
      ? { contribution_type: "change", ID: entryId.trim(), ...form }
      : { contribution_type: "addition", ...form };

  const paperTitle = form["Paper title"] || "Untitled";
  const title =
    mode === "change"
      ? `[Table change] ID ${entryId.trim()}: ${paperTitle}`
      : `[Table contribution] ${paperTitle}`;

  const intro =
    mode === "change"
      ? "Submitted via the website form. A workflow will open a pull request that updates this entry in `public/data.csv` for review."
      : "Submitted via the website form. A workflow will open a pull request that appends this entry to `public/data.csv` for review.";

  const body = [
    "<!-- wlcd-contribution-v1 -->",
    "## Table contribution",
    "",
    intro,
    "",
    mode === "change" ? `**Entry ID:** ${entryId.trim()}` : null,
    `**Paper:** ${form["Paper title"]}`,
    `**Paper link:** ${form["Paper Link"]}`,
    form["Dataset Link"] ? `**Dataset link:** ${form["Dataset Link"]}` : null,
    form["Other Links"] ? `**Other links:** ${form["Other Links"]}` : null,
    "",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");

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
  "Paper Link": "",
  "Dataset Link": "",
  "Other Links": "",
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
  const [mode, setMode] = useState("addition");
  const [entryId, setEntryId] = useState("");
  const [form, setForm] = useState(initialForm);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [entryLoadError, setEntryLoadError] = useState("");
  const [pasteHint, setPasteHint] = useState(false);
  const [keywordList, setKeywordList] = useState([]);
  const [keywordCategories, setKeywordCategories] = useState(() => new Map());
  const [tableRows, setTableRows] = useState([]);

  const selectedKeywords = useMemo(
    () => sortKeywords(splitKeywords(form.Keywords), keywordCategories),
    [form.Keywords, keywordCategories]
  );

  useEffect(() => {
    const asset = (path) => `${import.meta.env.BASE_URL}${path}`;
    fetch(asset("keywords.csv"))
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load keywords.csv (${response.status})`);
        return response.text();
      })
      .then((text) => {
        const { list, byKeyword } = parseKeywords(text);
        setKeywordList(list);
        setKeywordCategories(byKeyword);
      })
      .catch(() => {
        setKeywordList([]);
        setKeywordCategories(new Map());
      });

    fetch(asset("data.csv"))
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load data.csv (${response.status})`);
        return response.text();
      })
      .then((text) => setTableRows(parseTableCsv(text)))
      .catch(() => setTableRows([]));
  }, []);

  useEffect(() => {
    if (mode !== "change") return undefined;

    const id = entryId.trim();
    if (!id) {
      setForm(initialForm);
      setEntryLoadError("");
      return undefined;
    }

    const timer = window.setTimeout(() => {
      if (tableRows.length === 0) return;
      const row = findTableRowById(tableRows, id);
      if (row) {
        setForm(tableRowToContributionForm(row));
        setEntryLoadError("");
      } else {
        setForm(initialForm);
        setEntryLoadError(`No table entry with ID ${id}.`);
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [mode, entryId, tableRows]);

  const setContributionMode = (nextMode) => {
    setMode(nextMode);
    setEntryId("");
    setForm(initialForm);
    setEntryLoadError("");
    setError("");
  };

  const update = (key) => (event) => {
    setForm((prev) => ({ ...prev, [key]: event.target.value }));
  };

  const toggleKeyword = (keyword) => {
    setForm((prev) => {
      const current = splitKeywords(prev.Keywords);
      const next = hasKeyword(current, keyword)
        ? current.filter((item) => item.toLowerCase() !== keyword.toLowerCase())
        : [...current, keyword];
      return {
        ...prev,
        Keywords: formatKeywordList(sortKeywords(next, keywordCategories)),
      };
    });
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setPasteHint(false);

    if (mode === "change") {
      const id = entryId.trim();
      if (!id) {
        setError("Enter the table entry ID you want to change.");
        return;
      }
      if (!findTableRowById(tableRows, id)) {
        setError(entryLoadError || `No table entry with ID ${id}.`);
        return;
      }
    }

    const { title, body } = buildIssueContent(form, { mode, entryId });
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
    setMode("addition");
    setEntryId("");
    setForm(initialForm);
    window.open(url, "_blank", "noopener,noreferrer");
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
      <h1 className="!mt-0 text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
        {mode === "change" ? "Suggest a change" : "Suggest an addition"}
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-600">
        {mode === "change"
          ? "Propose edits to an existing table entry. Enter its ID to load the current values, then submit your changes on GitHub."
          : "Propose a benchmark or paper for the table. Submitting opens a GitHub issue; a pull request is created automatically. You need a GitHub account to finish the submission."}
      </p>

      {status === "sent" ? (
        <div className="mt-8 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm text-emerald-900">
          <p className="font-medium">Continue on GitHub to finish.</p>
          <p className="mt-1">
            A new browser tab should have opened with a prefilled issue. Submit that
            issue, then maintainers will get a PR to review.
          </p>
          <p className="mt-2 rounded border border-emerald-300 bg-white/70 px-3 py-2 text-emerald-950">
            If your benchmark includes audio, upload the .mp3/.wav files on the GitHub
            issue page before submitting the issue.
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
          <div className="space-y-4">
            <div
              className="inline-flex rounded-md border border-slate-200 bg-slate-50 p-0.5"
              role="tablist"
              aria-label="Contribution type"
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === "addition"}
                onClick={() => setContributionMode("addition")}
                className={`rounded px-3 py-1.5 text-sm font-medium transition ${
                  mode === "addition"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Suggest an addition
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "change"}
                onClick={() => setContributionMode("change")}
                className={`rounded px-3 py-1.5 text-sm font-medium transition ${
                  mode === "change"
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                Suggest a change
              </button>
            </div>

            {mode === "change" && (
              <Field label="Entry ID" hint="Table row ID from the first column of the table.">
                <input
                  required
                  inputMode="numeric"
                  value={entryId}
                  onChange={(event) => setEntryId(event.target.value)}
                  placeholder="e.g. 12"
                  className={FIELD_CLASS}
                />
                {entryLoadError ? (
                  <p className="mt-1 text-xs text-red-600">{entryLoadError}</p>
                ) : entryId.trim() && form["Paper title"] ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Loaded: {form["Paper title"]}
                  </p>
                ) : null}
              </Field>
            )}
          </div>

          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">Paper / benchmark</h2>
            <Field label="Paper title" hint="Full paper title">
              <input
                required
                value={form["Paper title"]}
                onChange={update("Paper title")}
                className={FIELD_CLASS}
              />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Paper link">
                <input
                  required
                  type="url"
                  placeholder="https://"
                  value={form["Paper Link"]}
                  onChange={update("Paper Link")}
                  className={FIELD_CLASS}
                />
              </Field>
              <Field label="Dataset link">
                <input
                  type="url"
                  placeholder="https://"
                  value={form["Dataset Link"]}
                  onChange={update("Dataset Link")}
                  className={FIELD_CLASS}
                />
              </Field>
            </div>
            <Field label="Other links">
              <input
                placeholder="Optional extra URLs, separated by spaces"
                value={form["Other Links"]}
                onChange={update("Other Links")}
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
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="General category" hint="The best fitting category.">
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
              <Field
                label="License"
                hint='Dataset license if it exists; otherwise put "None listed".'
              >
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
              <div className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                {groupKeywordsByCategory(keywordList).map(({ category, keywords }) => {
                  const style = KEYWORD_STYLES[category] ?? FALLBACK_STYLE;
                  return (
                    <div key={category}>
                      <div className="mb-1 text-xs font-medium text-slate-600">{category}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {keywords.map(({ keyword }) => {
                          const isSelected = hasKeyword(selectedKeywords, keyword);
                          return (
                            <button
                              key={keyword}
                              type="button"
                              title={`${category}: ${keyword}`}
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
                    </div>
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
            <Field
              label="Summary"
              hint={
                <>
                  1–2 sentences (120–200) characters including:
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    <li>
                      Brief benchmark description (e.g., exam-style expert-crafted medical
                      questions)
                    </li>
                    <li>
                      LLM vs. human findings (e.g., LLMs worse than human experts)
                    </li>
                  </ul>
                  <div className="block pt-1">Refer to another table entry with [ID: #].</div>
                </>
              }
            >
              <textarea
                rows={3}
                minLength={SUMMARY_MIN_LENGTH}
                maxLength={SUMMARY_MAX_LENGTH}
                value={form.Summary}
                onChange={update("Summary")}
                className={FIELD_CLASS}
              />
              <p
                className={`mt-1 text-right text-xs ${
                  form.Summary.length < SUMMARY_MIN_LENGTH ? "text-amber-600" : "text-slate-500"
                }`}
              >
                {form.Summary.length}/{SUMMARY_MAX_LENGTH} (minimum {SUMMARY_MIN_LENGTH})
              </p>
            </Field>
          </section>

          <section className="space-y-4">
            <h2 className="text-lg font-semibold text-slate-900">Evaluation details</h2>
            <Field
              label="Language(s) tested"
              hint="Comma-separated. Glottolog official names; if not in Glottolog (e.g. conlangs), use the Wikipedia name; otherwise use your best judgment."
            >
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
            <Field
              label="Human benchmark?"
              hint="Put yes only if there is an actual accuracy/score reported for humans."
            >
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
                Put &ldquo;Humans (by assumption)&rdquo; only next to open-source models
                — the assumption is that open-source models are equal to or worse than
                closed and open-weight models. Put &ldquo;Humans (trivial)&rdquo; for tasks
                without human evaluation that are nevertheless obviously easy for humans
                (e.g., make this text all caps).
              </p>
              <div className="mt-2 grid gap-4 sm:grid-cols-3">
                <Field label="Closed">
                  <WhoIsBetterInput
                    listId="who-is-better-closed"
                    options={WHO_IS_BETTER_OPTIONS}
                    value={form.Closed}
                    onChange={update("Closed")}
                  />
                </Field>
                <Field label="Open-weight">
                  <WhoIsBetterInput
                    listId="who-is-better-open-weight"
                    options={WHO_IS_BETTER_OPTIONS}
                    value={form["Open-weight"]}
                    onChange={update("Open-weight")}
                  />
                </Field>
                <Field label="Open-source">
                  <WhoIsBetterInput
                    listId="who-is-better-open-source"
                    options={WHO_IS_BETTER_OPEN_SOURCE_OPTIONS}
                    value={form["Open-source"]}
                    onChange={update("Open-source")}
                  />
                </Field>
              </div>
            </div>
            <Field
              label="Benchmark example"
              hint="Benchmark text. To include audio in the middle of the text, write the filename inline (e.g. Listen to sample.mp3 and answer …). Only .mp3/.wav are supported. Upload audio files on the GitHub issue page before submitting the issue."
            >
              <textarea
                rows={4}
                value={form["Benchmark Example"]}
                onChange={update("Benchmark Example")}
                className={FIELD_CLASS}
              />
            </Field>
            <Field label="Abstract" hint="The abstract from the paper, verbatim.">
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
