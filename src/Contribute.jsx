import { useEffect, useMemo, useRef, useState } from "react";
import { CONTRIBUTE_API_URL } from "./config.js";
import {
  findTableRowById,
  groupKeywordsByCategory,
  KEYWORD_CATEGORY_ORDER,
  modelIdentityKey,
  canonicalizeModelName,
  parseKeywords,
  parseModelsCsv,
  parseCsv,
  parseTableCsv,
  sortKeywords,
  splitKeywords,
  splitLanguages,
  splitModels,
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

const MODEL_OPENNESS_OPTIONS = ["Closed", "Open-weight", "Open-source"];

const WHO_IS_BETTER_OPTIONS = [
  "Not tested",
  "LLMs",
  "Humans",
  "Humans (trivial)",
];

const LICENSE_OPTIONS = [
  "None listed",
  "MIT",
  "Apache-2.0",
  "CC BY 4.0",
  "CC BY-SA 4.0",
  "CC BY-SA 3.0",
  "CC BY-NC 4.0",
  "CC BY-NC-SA 4.0",
  "CC BY-NC-ND 4.0",
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

const SUMMARY_MIN_LENGTH = 120;
const SUMMARY_MAX_LENGTH = 200;
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

function Field({ label, hint, children, className = "" }) {
  return (
    <label className={`block ${className}`}>
      <span className={LABEL_CLASS}>{label}</span>
      {hint ? <div className="mt-0.5 text-xs text-slate-500">{hint}</div> : null}
      {children}
    </label>
  );
}

function ComboboxInput({ value, onChange, listId, options, filterValue, applyOption }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef(null);
  const querySource = filterValue ? filterValue(value) : value;

  const filteredOptions = useMemo(() => {
    const query = querySource.trim().toLowerCase();
    if (!query) return options;
    return options.filter((option) => option.toLowerCase().includes(query));
  }, [querySource, options]);

  useEffect(() => {
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [querySource, open]);

  const selectOption = (option) => {
    const nextValue = applyOption ? applyOption(value, option) : option;
    onChange({ target: { value: nextValue } });
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

function currentCommaDraft(value) {
  const parts = String(value ?? "").split(/[,;]/);
  return parts[parts.length - 1] ?? "";
}

function CommaSeparatedCombobox({ value, onChange, options, listId, splitValue = splitKeywords }) {
  const selected = useMemo(() => splitValue(value), [value, splitValue]);
  const draft = currentCommaDraft(value).trim().toLowerCase();

  const filteredOptions = useMemo(() => {
    return options.filter((option) => {
      const lower = option.toLowerCase();
      if (selected.some((item) => item.toLowerCase() === lower) && lower !== draft) {
        return false;
      }
      if (!draft) return true;
      return lower.includes(draft);
    });
  }, [options, selected, draft]);

  return (
    <ComboboxInput
      value={value}
      onChange={onChange}
      listId={listId}
      options={filteredOptions}
      filterValue={() => ""}
      applyOption={(current, option) => {
        const parts = String(current ?? "").split(/[,;]/);
        const completed = [
          ...parts.slice(0, -1).map((part) => part.trim()).filter(Boolean),
          option,
        ];
        return completed.join(", ");
      }}
    />
  );
}

function WhoIsBetterInput({ value, onChange, listId, options }) {
  return (
    <ComboboxInput value={value} onChange={onChange} listId={listId} options={options} />
  );
}

function formatKeywordList(keywords) {
  return keywords.join(", ");
}

function hasKeyword(selected, keyword) {
  const lower = keyword.toLowerCase();
  return selected.some((item) => item.toLowerCase() === lower);
}

function lookupModelMeta(name, modelMeta) {
  if (!name || !modelMeta?.size) return null;
  return (
    modelMeta.get(name) ??
    modelMeta.get(name.toLowerCase()) ??
    modelMeta.get(canonicalizeModelName(name)) ??
    modelMeta.get(modelIdentityKey(name)) ??
    null
  );
}

function emptyNewModelDetails() {
  return { family: "", openness: "", release_date: "", link: "" };
}

function emptyNewKeywordDetails() {
  return { category: "" };
}

function normalizeFormValue(value) {
  return String(value ?? "")
    .trim()
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ");
}

function contributionFormEquals(a, b) {
  const keys = [
    "General category",
    "Keywords",
    "Paper title",
    "License",
    "Language(s)",
    "Model(s) tested",
    "Year of publication",
    "Paper Link",
    "Dataset Link",
    "Other Links",
    "Summary",
    "Human benchmark?",
    "Closed",
    "Open-weight",
    "Open-source",
    "Benchmark Example",
    "Abstract",
    "Comments",
  ];
  return keys.every((key) => normalizeFormValue(a?.[key]) === normalizeFormValue(b?.[key]));
}

function buildContributionPayload(
  form,
  { mode = "addition", entryId = "", newModels = [], newKeywords = [] } = {}
) {
  const payload =
    mode === "change"
      ? { contribution_type: "change", ID: entryId.trim(), ...form }
      : { contribution_type: "addition", ...form };

  if (newModels.length > 0) {
    payload.new_models = newModels;
  }
  if (newKeywords.length > 0) {
    payload.new_keywords = newKeywords;
  }

  return payload;
}

const initialForm = {
  "General category": "",
  Keywords: "",
  "Paper title": "",
  License: "",
  "Language(s)": "",
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
  const [prUrl, setPrUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [audioFiles, setAudioFiles] = useState([]);
  const [keywordList, setKeywordList] = useState([]);
  const [keywordCategories, setKeywordCategories] = useState(() => new Map());
  const [tableRows, setTableRows] = useState([]);
  const [modelMeta, setModelMeta] = useState(() => new Map());
  const [knownModelNames, setKnownModelNames] = useState([]);
  const [newModelDetails, setNewModelDetails] = useState(() => ({}));
  const [newKeywordDetails, setNewKeywordDetails] = useState(() => ({}));
  const [ghUser, setGhUser] = useState(null);
  const [ghAuthLoading, setGhAuthLoading] = useState(Boolean(CONTRIBUTE_API_URL));

  useEffect(() => {
    if (!CONTRIBUTE_API_URL) {
      setGhAuthLoading(false);
      return undefined;
    }
    let cancelled = false;
    const endpoint = CONTRIBUTE_API_URL.replace(/\/$/, "") + "/auth/me";
    fetch(endpoint, { credentials: "include" })
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
          setGhUser(null);
        }
      })
      .catch(() => {
        if (!cancelled) setGhUser(null);
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
    const returnTo = window.location.href;
    const loginUrl =
      CONTRIBUTE_API_URL.replace(/\/$/, "") +
      "/auth/login?return_to=" +
      encodeURIComponent(returnTo);
    window.location.assign(loginUrl);
  };

  const signOutGitHub = async () => {
    if (!CONTRIBUTE_API_URL) return;
    try {
      await fetch(CONTRIBUTE_API_URL.replace(/\/$/, "") + "/auth/logout", {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Ignore network errors; clear local session UI either way.
    }
    setGhUser(null);
  };

  const selectedKeywords = useMemo(
    () => sortKeywords(splitKeywords(form.Keywords), keywordCategories),
    [form.Keywords, keywordCategories]
  );

  const knownKeywordNames = useMemo(
    () => keywordList.map(({ keyword }) => keyword),
    [keywordList]
  );

  const licenseOptions = useMemo(() => {
    const seen = new Set(LICENSE_OPTIONS.map((item) => item.toLowerCase()));
    const extras = [];
    for (const row of tableRows) {
      const license = row.License?.trim();
      if (!license) continue;
      const key = license.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      extras.push(license);
    }
    extras.sort((a, b) => a.localeCompare(b));
    return [...LICENSE_OPTIONS, ...extras];
  }, [tableRows]);

  const languageOptions = useMemo(() => {
    const seen = new Set();
    const options = [];
    for (const row of tableRows) {
      for (const language of splitLanguages(row["Language(s)"] ?? row["Language(s) tested"])) {
        const key = language.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        options.push(language);
      }
    }
    options.sort((a, b) => a.localeCompare(b));
    return options;
  }, [tableRows]);

  const knownFamilies = useMemo(() => {
    const families = new Set();
    for (const entry of modelMeta.values()) {
      if (entry?.family) families.add(entry.family);
    }
    return [...families].sort((a, b) => a.localeCompare(b));
  }, [modelMeta]);

  const unknownModels = useMemo(() => {
    return splitModels(form["Model(s) tested"]).filter(
      (model) => !lookupModelMeta(model, modelMeta)
    );
  }, [form["Model(s) tested"], modelMeta]);

  const unknownKeywords = useMemo(() => {
    return splitKeywords(form.Keywords).filter((keyword) => {
      return !(
        keywordCategories.has(keyword) || keywordCategories.has(keyword.toLowerCase())
      );
    });
  }, [form.Keywords, keywordCategories]);

  useEffect(() => {
    setNewModelDetails((prev) => {
      const next = {};
      let changed = Object.keys(prev).length !== unknownModels.length;
      for (const model of unknownModels) {
        if (prev[model]) {
          next[model] = prev[model];
        } else {
          next[model] = emptyNewModelDetails();
          changed = true;
        }
      }
      for (const key of Object.keys(prev)) {
        if (!(key in next)) changed = true;
      }
      return changed ? next : prev;
    });
  }, [unknownModels]);

  useEffect(() => {
    setNewKeywordDetails((prev) => {
      const next = {};
      let changed = Object.keys(prev).length !== unknownKeywords.length;
      for (const keyword of unknownKeywords) {
        if (prev[keyword]) {
          next[keyword] = prev[keyword];
        } else {
          next[keyword] = emptyNewKeywordDetails();
          changed = true;
        }
      }
      for (const key of Object.keys(prev)) {
        if (!(key in next)) changed = true;
      }
      return changed ? next : prev;
    });
  }, [unknownKeywords]);

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

    fetch(asset("models.csv"))
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load models.csv (${response.status})`);
        return response.text();
      })
      .then((text) => {
        setModelMeta(parseModelsCsv(text));
        const delimiter = text.includes("\t") ? "\t" : ",";
        const names = parseCsv(text, delimiter)
          .map((row) => row.model?.trim())
          .filter(Boolean);
        setKnownModelNames([...new Set(names)].sort((a, b) => a.localeCompare(b)));
      })
      .catch(() => {
        setModelMeta(new Map());
        setKnownModelNames([]);
      });
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
    setAudioFiles([]);
    setNewModelDetails({});
    setNewKeywordDetails({});
    setEntryLoadError("");
    setError("");
  };

  const update = (key) => (event) => {
    setForm((prev) => ({ ...prev, [key]: event.target.value }));
  };

  const updateNewModel = (model, key) => (event) => {
    const value = event.target.value;
    setNewModelDetails((prev) => ({
      ...prev,
      [model]: {
        ...(prev[model] ?? emptyNewModelDetails()),
        [key]: value,
      },
    }));
  };

  const updateNewKeyword = (keyword, key) => (event) => {
    const value = event.target.value;
    setNewKeywordDetails((prev) => ({
      ...prev,
      [keyword]: {
        ...(prev[keyword] ?? emptyNewKeywordDetails()),
        [key]: value,
      },
    }));
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

    if (!CONTRIBUTE_API_URL) {
      setError(
        "Contribute API is not configured (set VITE_CONTRIBUTE_API_URL). Locally, run the worker with wrangler and point the env var at it."
      );
      return;
    }

    if (mode === "change") {
      const id = entryId.trim();
      if (!id) {
        setError("Enter the table entry ID you want to change.");
        return;
      }
      const existingRow = findTableRowById(tableRows, id);
      if (!existingRow) {
        setError(entryLoadError || `No table entry with ID ${id}.`);
        return;
      }
      const baseline = tableRowToContributionForm(existingRow);
      const rowUnchanged = contributionFormEquals(form, baseline);
      if (
        rowUnchanged &&
        unknownModels.length === 0 &&
        unknownKeywords.length === 0 &&
        audioFiles.length === 0
      ) {
        setError(
          "No changes detected. Edit at least one field (or add models, keywords, or audio) before submitting."
        );
        return;
      }
    }

    for (const model of unknownModels) {
      const details = newModelDetails[model] ?? emptyNewModelDetails();
      if (!details.openness.trim()) {
        setError(`Choose openness for new model “${model}”.`);
        return;
      }
      if (!details.family.trim()) {
        setError(`Enter a family for new model “${model}”.`);
        return;
      }
    }

    for (const keyword of unknownKeywords) {
      const details = newKeywordDetails[keyword] ?? emptyNewKeywordDetails();
      if (!details.category.trim()) {
        setError(`Choose a category for new keyword “${keyword}”.`);
        return;
      }
    }

    const totalAudio = audioFiles.reduce((sum, file) => sum + file.size, 0);
    if (totalAudio > MAX_AUDIO_BYTES) {
      setError("Total audio size exceeds the 20 MB limit.");
      return;
    }
    for (const file of audioFiles) {
      if (!/\.(mp3|wav)$/i.test(file.name)) {
        setError(`Only .mp3 and .wav files are allowed (got ${file.name}).`);
        return;
      }
    }

    const newModels = unknownModels.map((model) => {
      const details = newModelDetails[model] ?? emptyNewModelDetails();
      return {
        model,
        family: details.family.trim(),
        openness: details.openness.trim(),
        release_date: details.release_date.trim(),
        link: details.link.trim(),
      };
    });

    const newKeywords = unknownKeywords.map((keyword) => {
      const details = newKeywordDetails[keyword] ?? emptyNewKeywordDetails();
      return {
        keyword,
        category: details.category.trim(),
      };
    });

    const payload = buildContributionPayload(form, {
      mode,
      entryId,
      newModels,
      newKeywords,
    });

    const body = new FormData();
    body.append("payload", JSON.stringify(payload));
    for (const file of audioFiles) {
      body.append("audio", file, file.name);
    }

    setSubmitting(true);
    try {
      if (!CONTRIBUTE_API_URL) {
        throw new Error("Contribute API URL is not configured.");
      }
      if (!ghUser) {
        throw new Error("Sign in with GitHub before submitting.");
      }
      const endpoint = CONTRIBUTE_API_URL.replace(/\/$/, "") + "/contribute";
      const response = await fetch(endpoint, {
        method: "POST",
        body,
        credentials: "include",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.error || `Submission failed (${response.status})`);
      }
      if (!result.pr_url) {
        throw new Error("Worker did not return a pull request URL");
      }

      setPrUrl(result.pr_url);
      setStatus("sent");
      setAudioFiles([]);
      setNewModelDetails({});
      setNewKeywordDetails({});
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
                The paper must be from <strong className="font-medium text-slate-800">2025 or later</strong>.
                If the original work is older but someone has tested the same task on a newer
                model, submit that newer evaluation instead.
              </li>
              <li>
                The paper must include a <strong className="font-medium text-slate-800">human baseline</strong>,
                or use{" "}
                <strong className="font-medium text-slate-800">objective human-annotated labels</strong>.
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
          <p className="mt-1">
            Thanks — maintainers will review the CSV in the PR.
          </p>
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
              setNewModelDetails({});
              setNewKeywordDetails({});
              setError("");
            }}
            className="mt-4 text-sm font-medium text-emerald-800 underline hover:text-emerald-950"
          >
            Submit another
          </button>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-8 space-y-8">
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
                    <span className="text-slate-500"> — PR will be opened from your account</span>
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
              <Field label="Entry ID" hint="Row number shown in the table ID column (1, 2, 3, … in file order).">
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
                <ComboboxInput
                  value={form.License}
                  onChange={update("License")}
                  listId="license-options"
                  options={licenseOptions}
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
                      <div className="flex flex-wrap gap-0.5">
                        {keywords.map(({ keyword }) => {
                          const isSelected = hasKeyword(selectedKeywords, keyword);
                          return (
                            <button
                              key={keyword}
                              type="button"
                              title={`${category}: ${keyword}`}
                              onClick={() => toggleKeyword(keyword)}
                              className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-xs font-medium transition ${
                                isSelected
                                  ? "ring-2 ring-offset-0 ring-slate-400 scale-105"
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
              <CommaSeparatedCombobox
                value={form.Keywords}
                onChange={update("Keywords")}
                options={knownKeywordNames}
                listId="keywords-options"
                splitValue={splitKeywords}
              />
              {unknownKeywords.length > 0 ? (
                <div className="mt-3 space-y-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                  <p className="text-sm font-medium text-amber-950">New keyword details</p>
                  <p className="text-xs text-amber-900/80">
                    These keywords are not in <code className="text-[11px]">keywords.csv</code>{" "}
                    yet. Choose a category for each.
                  </p>
                  {unknownKeywords.map((keyword) => {
                    const details = newKeywordDetails[keyword] ?? emptyNewKeywordDetails();
                    return (
                      <div
                        key={keyword}
                        className="grid gap-3 rounded-md border border-amber-100 bg-white p-3 sm:grid-cols-[1fr_12rem] sm:items-end"
                      >
                        <div>
                          <p className="text-sm font-semibold text-slate-800">{keyword}</p>
                        </div>
                        <Field label="Category">
                          <select
                            value={details.category}
                            onChange={updateNewKeyword(keyword, "category")}
                            className={FIELD_CLASS}
                            required
                          >
                            <option value="">Select</option>
                            {KEYWORD_CATEGORY_ORDER.map((category) => (
                              <option key={category} value={category}>
                                {category}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                    );
                  })}
                </div>
              ) : null}
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
              label="Language(s)"
              hint="Comma-separated. Glottolog official names; if not in Glottolog (e.g. conlangs), use the Wikipedia name; otherwise use your best judgment. Pick from existing names or type a new one."
            >
              <CommaSeparatedCombobox
                value={form["Language(s)"]}
                onChange={update("Language(s)")}
                options={languageOptions}
                listId="languages-options"
                splitValue={splitLanguages}
              />
            </Field>
            <Field
              label="Model(s) tested"
              hint="Comma-separated. For models not already in the catalog, fill in the details below."
            >
              <CommaSeparatedCombobox
                value={form["Model(s) tested"]}
                onChange={update("Model(s) tested")}
                options={knownModelNames}
                listId="models-tested-options"
                splitValue={splitModels}
              />
            </Field>
            {unknownModels.length > 0 ? (
              <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                <p className="text-sm font-medium text-amber-950">New model details</p>
                <p className="text-xs text-amber-900/80">
                  These names are not in <code className="text-[11px]">models.csv</code> yet.
                  Reuse an existing family when possible; enter a new family name only if needed.
                  For open-weight models, prefer a Hugging Face id (
                  <code className="text-[11px]">org/model</code>
                  ); for closed models, use a product URL.
                </p>
                {unknownModels.map((model) => {
                  const details = newModelDetails[model] ?? emptyNewModelDetails();
                  const familyIsNew =
                    details.family.trim() !== "" &&
                    !knownFamilies.some(
                      (family) => family.toLowerCase() === details.family.trim().toLowerCase()
                    );
                  return (
                    <div
                      key={model}
                      className="space-y-3 rounded-md border border-amber-100 bg-white p-3"
                    >
                      <p className="text-sm font-semibold text-slate-800">{model}</p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field
                          label="Family"
                          hint={
                            familyIsNew
                              ? "This will add a new family."
                              : "Pick an existing family or type a new one."
                          }
                        >
                          <ComboboxInput
                            value={details.family}
                            onChange={updateNewModel(model, "family")}
                            listId={`new-model-family-${modelIdentityKey(model)}`}
                            options={knownFamilies}
                          />
                        </Field>
                        <Field label="Openness">
                          <select
                            value={details.openness}
                            onChange={updateNewModel(model, "openness")}
                            className={FIELD_CLASS}
                            required
                          >
                            <option value="">Select</option>
                            {MODEL_OPENNESS_OPTIONS.map((option) => (
                              <option key={option} value={option}>
                                {option}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Release date" hint="YYYY-MM-DD if known">
                          <input
                            type="date"
                            value={details.release_date}
                            onChange={updateNewModel(model, "release_date")}
                            className={FIELD_CLASS}
                          />
                        </Field>
                        <Field label="Link" hint="HF org/model or full URL">
                          <input
                            value={details.link}
                            onChange={updateNewModel(model, "link")}
                            className={FIELD_CLASS}
                            placeholder="org/model or https://…"
                          />
                        </Field>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
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
                Models are <em>closed</em> if they have no publicly available weights,{" "}
                <em>open-weight</em> if their weights are available but not their data, and{" "}
                <em>open-source</em> if their weights and training data are publicly available.
              </p>
              <p className="mt-1.5 text-xs text-slate-500">
                Put &ldquo;Humans (trivial)&rdquo; for tasks without human evaluation that
                are nevertheless obviously easy for humans (e.g., make this text all caps).
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
                    options={WHO_IS_BETTER_OPTIONS}
                    value={form["Open-source"]}
                    onChange={update("Open-source")}
                  />
                </Field>
              </div>
            </div>
            <Field
              label="Benchmark example"
              hint="Benchmark text. Reference .mp3/.wav filenames to show audio players above the text by default. Write a filename inline in a sentence to embed the player there (e.g. Listen to sample.mp3 and answer …), or add [audio below] to place players after the text. Attach matching audio files below (20 MB total max)."
            >
              <textarea
                rows={4}
                value={form["Benchmark Example"]}
                onChange={update("Benchmark Example")}
                className={FIELD_CLASS}
              />
            </Field>
            <Field
              label="Benchmark audio"
              hint="Optional .mp3 or .wav files referenced in the benchmark example. Filenames must match the text (e.g. sample.mp3)."
            >
              <input
                type="file"
                accept=".mp3,.wav,audio/mpeg,audio/wav,audio/x-wav"
                multiple
                onChange={(event) => {
                  const next = Array.from(event.target.files || []);
                  setAudioFiles(next);
                }}
                className="mt-1 block w-full text-sm text-slate-700 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-slate-800 hover:file:bg-slate-200"
              />
              {audioFiles.length > 0 ? (
                <ul className="mt-2 list-inside list-disc text-xs text-slate-600">
                  {audioFiles.map((file) => (
                    <li key={`${file.name}-${file.size}-${file.lastModified}`}>
                      {file.name} ({Math.max(1, Math.round(file.size / 1024))} KB)
                    </li>
                  ))}
                </ul>
              ) : null}
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
              disabled={submitting || ghAuthLoading || !ghUser}
              className="inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Opening pull request…" : "Submit pull request"}
            </button>
            <span className="text-xs text-slate-500">
              {ghUser
                ? `Creates a PR as @${ghUser.login}`
                : "Sign in with GitHub to submit"}
            </span>
          </div>
        </form>
      )}
    </main>
  );
}
