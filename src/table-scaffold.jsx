import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getExpandedRowModel,
  flexRender,
} from "@tanstack/react-table";
import {
  audioMimeType,
  defaultColumnVisibility,
  displayHeaders,
  isWhoIsBetterColumn,
  parseAudioCell,
  parseKeywords,
  parseReleaseDates,
  parseTableCsv,
  sortModelsByReleaseDate,
  splitKeywords,
  splitModels,
} from "./parseCsv.js";

const PREVIEW_COUNT = 3;

const CATEGORY_STYLES = {
  Modality: { background: "#ccfbf1", color: "#0f766e", border: "#99f6e4" },
  Attribute: { background: "#ede9fe", color: "#5b21b6", border: "#ddd6fe" },
  Domain: { background: "#e0f2fe", color: "#075985", border: "#bae6fd" },
  Format: { background: "#dcfce7", color: "#166534", border: "#bbf7d0" },
  Language: { background: "#ffedd5", color: "#9a3412", border: "#fed7aa" },
  Task: { background: "#fce7f3", color: "#9d174d", border: "#fbcfe8" },
};

const FALLBACK_STYLE = { background: "#f1f5f9", color: "#475569", border: "#e2e8f0" };

const CATEGORY_ROW_COLORS = {
  "Expert Knowledge": "#bfdbfe",
  Linguistics: "#fed7aa",
  "General NLP tasks": "#a7f3d0",
  Reasoning: "#ddd6fe",
  "Tasks with reasoning": "#ddd6fe",
  "Cross-lingual tasks": "#fbcfe8",
};

const NARROW_COLUMNS = new Set([
  "ID",
  "Language(s) tested",
  "Model(s) tested",
  "Links",
]);

const WHO_IS_BETTER_LEAF_COLUMNS = new Set([
  "Closed",
  "Open-weight",
  "Open-source",
]);

const MEDIUM_NARROW_COLUMNS = new Set(["Keywords"]);

const REDUCED_COLUMNS = new Set(["Paper title", "Summary"]);

function linkHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function HuggingFaceLogo({ className }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}icons/huggingface-icon.svg`}
      alt=""
      className={className}
      aria-hidden="true"
    />
  );
}

function AclLogo({ className }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}icons/acl-logo.svg`}
      alt=""
      className={className}
      aria-hidden="true"
    />
  );
}

function ArxivLogo({ className }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}icons/arxiv-logomark-small.svg`}
      alt=""
      className={className}
      aria-hidden="true"
    />
  );
}

function GitHubLogo({ className }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden="true" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8" />
    </svg>
  );
}

function ExternalLinkIcon({ href }) {
  const host = linkHostname(href);
  const iconClass = "inline-block h-[1.1em] w-[1.1em] align-[-0.15em] text-slate-800";
  if (host === "aclanthology.org" || host.endsWith(".aclanthology.org")) {
    return (
      <AclLogo className="inline-block h-[1.05em] w-auto align-[-0.12em]" />
    );
  }
  if (host === "arxiv.org" || host.endsWith(".arxiv.org")) {
    return (
      <ArxivLogo className="inline-block h-[1.05em] w-auto align-[-0.12em]" />
    );
  }
  if (host === "huggingface.co" || host.endsWith(".huggingface.co")) {
    return <HuggingFaceLogo className={iconClass} />;
  }
  if (
    host === "github.com" ||
    host === "gist.github.com" ||
    host.endsWith(".github.io") ||
    host === "raw.githubusercontent.com"
  ) {
    return <GitHubLogo className={iconClass} />;
  }
  return "🔗";
}

function splitUrls(value) {
  if (!value?.trim()) return [];
  return value
    .split(/[\s,;|]+/)
    .map((part) => part.trim())
    .filter((part) => /^https?:\/\//i.test(part));
}

function rowLinkEntries(row) {
  const paper = (row["Paper Link"] || row.Link || "").trim();
  const dataset = (row["Dataset Link"] || "").trim();
  const other = splitUrls(row["Other Links"]);

  const entries = [];
  if (paper) {
    entries.push({
      key: "paper",
      label: "Paper",
      href: /^https?:\/\//i.test(paper) ? paper : null,
      text: paper,
    });
  }
  if (dataset) {
    entries.push({
      key: "dataset",
      label: "Dataset",
      href: /^https?:\/\//i.test(dataset) ? dataset : null,
      text: dataset,
    });
  }
  other.forEach((href, index) => {
    entries.push({
      key: `other-${index}`,
      label: "Other",
      href,
      text: href,
    });
  });
  return entries;
}

function LinksCell({ row }) {
  const entries = rowLinkEntries(row);
  if (entries.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {entries.map((entry) =>
        entry.href ? (
          <a
            key={entry.key}
            href={entry.href}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-base leading-none no-underline sm:text-lg"
            title={`${entry.label}: ${entry.href}`}
            aria-label={`${entry.label}: ${entry.href}`}
          >
            <ExternalLinkIcon href={entry.href} />
          </a>
        ) : (
          <span key={entry.key} title={`${entry.label}: ${entry.text}`} className="text-xs text-slate-600">
            {entry.text}
          </span>
        )
      )}
    </div>
  );
}

function columnWidthClass(columnId) {
  if (WHO_IS_BETTER_LEAF_COLUMNS.has(columnId) || columnId.startsWith("Open-source")) {
    return "max-w-28";
  }
  if (columnId === "License") {
    return "max-w-28";
  }
  if (NARROW_COLUMNS.has(columnId)) {
    return "max-w-40";
  }
  if (MEDIUM_NARROW_COLUMNS.has(columnId)) {
    return "max-w-52";
  }
  if (REDUCED_COLUMNS.has(columnId)) {
    return "max-w-56";
  }
  return "max-w-md";
}

function formatCellValue(value) {
  if (value === "Humans (by assumption)") {
    return (
      <>
        Humans<sup>†</sup>
      </>
    );
  }
  return value;
}

function formatHumanBenchmark(value) {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "yes") {
    return <span className="text-base text-green-600 font-medium sm:text-lg">✔</span>;
  }
  if (normalized === "no") {
    return <span className="text-base text-red-600 font-medium sm:text-lg">✘</span>;
  }
  return value;
}

function ModelsCell({ value, expanded, releaseDates }) {
  const models = sortModelsByReleaseDate(splitModels(value), releaseDates);
  if (models.length === 0) return null;

  const visible = expanded ? models : models.slice(0, PREVIEW_COUNT);
  const remaining = models.length - visible.length;

  return (
    <span>
      {visible.join(", ")}
      {remaining > 0 ? `, … (+${remaining})` : null}
    </span>
  );
}

function LanguagesCell({ value, expanded }) {
  const languages = splitKeywords(value);
  if (languages.length === 0) return null;

  const visible = expanded ? languages : languages.slice(0, PREVIEW_COUNT);
  const remaining = languages.length - visible.length;

  return (
    <span>
      {visible.join(", ")}
      {remaining > 0 ? `, … (+${remaining})` : null}
    </span>
  );
}

function KeywordsCell({ value, keywordCategories }) {
  const keywords = splitKeywords(value);
  if (keywords.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {keywords.map((keyword) => {
        const category =
          keywordCategories.get(keyword) ?? keywordCategories.get(keyword.toLowerCase());
        const style = CATEGORY_STYLES[category] ?? FALLBACK_STYLE;
        return (
          <span
            key={keyword}
            title={category ? `${category}: ${keyword}` : keyword}
            className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border"
            style={{
              backgroundColor: style.background,
              color: style.color,
              borderColor: style.border,
            }}
          >
            {keyword}
          </span>
        );
      })}
    </div>
  );
}

function KeywordFilterBar({ keywords, selected, onToggle, onClear }) {
  if (keywords.length === 0) return null;

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-sm font-medium text-gray-700">Keywords</span>
        {selected.size > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-gray-500 underline hover:text-gray-700"
          >
            Clear filter
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {keywords.map(({ keyword, category }) => {
          const style = CATEGORY_STYLES[category] ?? FALLBACK_STYLE;
          const isSelected = selected.has(keyword);
          return (
            <button
              key={keyword}
              type="button"
              title={category}
              onClick={() => onToggle(keyword)}
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border transition ${
                isSelected ? "ring-2 ring-offset-1 ring-slate-400 scale-105" : "opacity-90 hover:opacity-100"
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
}

function CategoryFilterBar({ categories, selected, onToggle, onClear }) {
  if (categories.length === 0) return null;

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-sm font-medium text-gray-700">Category</span>
        {selected.size > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-gray-500 underline hover:text-gray-700"
          >
            Clear filter
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {categories.map((category) => {
          const background = CATEGORY_ROW_COLORS[category] ?? FALLBACK_STYLE.background;
          const isSelected = selected.has(category);
          return (
            <button
              key={category}
              type="button"
              onClick={() => onToggle(category)}
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border border-black/10 text-slate-800 transition ${
                isSelected ? "ring-2 ring-offset-1 ring-slate-400 scale-105" : "opacity-90 hover:opacity-100"
              }`}
              style={{ backgroundColor: background }}
            >
              {category}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function uniqueSorted(values) {
  const byLower = new Map();
  for (const value of values) {
    const key = value.toLowerCase();
    if (!byLower.has(key)) byLower.set(key, value);
  }
  return [...byLower.values()].sort((a, b) => a.localeCompare(b));
}

function isSelectedIgnoreCase(selected, value) {
  const lower = value.toLowerCase();
  return [...selected].some((item) => item.toLowerCase() === lower);
}

function rankMatches(options, query, selected, limit = 10) {
  const q = query.trim().toLowerCase();
  const available = options.filter((option) => !isSelectedIgnoreCase(selected, option));

  if (!q) {
    return available.length <= 20 ? available.slice(0, limit) : [];
  }

  const scored = [];
  for (const option of available) {
    const lower = option.toLowerCase();
    if (!lower.includes(q)) continue;
    scored.push({ option, score: lower.startsWith(q) ? 0 : 1 });
  }

  scored.sort((a, b) => a.score - b.score || a.option.localeCompare(b.option));
  return scored.slice(0, limit).map((item) => item.option);
}

function AutocompleteMultiFilter({ label, options, selected, onAdd, onRemove, onClear, placeholder }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef(null);
  const listId = `${label.toLowerCase()}-suggestions`;

  const suggestions = useMemo(
    () => rankMatches(options, query, selected),
    [options, query, selected]
  );

  useEffect(() => {
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  const addOption = (option) => {
    onAdd(option);
    setQuery("");
    setOpen(true);
  };

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "Backspace" && query === "" && selected.size > 0) {
      const last = [...selected].at(-1);
      if (last) onRemove(last);
      return;
    }
    if (!open && (event.key === "ArrowDown" || event.key === "Enter")) {
      setOpen(true);
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, Math.max(suggestions.length - 1, 0)));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const choice = suggestions[activeIndex];
      if (choice) addOption(choice);
    }
  };

  return (
    <div ref={rootRef} className="min-w-0">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        {selected.size > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-gray-500 underline hover:text-gray-700"
          >
            Clear filter
          </button>
        )}
      </div>
      <div className="relative">
        <div className="flex flex-wrap items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1.5 shadow-sm focus-within:border-slate-400">
          {[...selected].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onRemove(value)}
              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            >
              {value}
              <span aria-hidden="true" className="text-slate-400">
                ×
              </span>
            </button>
          ))}
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={selected.size === 0 ? placeholder : "Add another…"}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            className="min-w-[10rem] flex-1 border-0 bg-transparent px-1 py-0.5 text-sm outline-none"
          />
        </div>
        {open && (
          <div className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg">
            {suggestions.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-500">
                {query.trim() === "" ? "Type to search…" : "No matches"}
              </div>
            ) : (
              <ul id={listId} role="listbox" className="max-h-56 overflow-auto py-1">
                {suggestions.map((option, index) => (
                  <li key={option}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={index === activeIndex}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => addOption(option)}
                      className={`block w-full px-3 py-1.5 text-left text-sm ${
                        index === activeIndex ? "bg-slate-100 text-slate-900" : "text-slate-700"
                      }`}
                    >
                      {option}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function rowHasKeyword(row, keyword) {
  const keywords = splitKeywords(row.Keywords);
  return keywords.some((k) => k.toLowerCase() === keyword.toLowerCase());
}

/** Selecting one of these also matches its aliases (and vice versa). */
const LANGUAGE_FILTER_ALIASES = {
  chinese: ["chinese", "mandarin chinese"],
  "mandarin chinese": ["chinese", "mandarin chinese"],
  arabic: ["arabic", "standard arabic"],
  "standard arabic": ["arabic", "standard arabic"],
};

const LANGUAGE_FILTER_EXTRA_OPTIONS = ["Arabic"];

function languageMatchKeys(language) {
  const key = language.toLowerCase();
  return LANGUAGE_FILTER_ALIASES[key] ?? [key];
}

function rowHasLanguage(row, language) {
  const targets = new Set(languageMatchKeys(language));
  return splitKeywords(row["Language(s) tested"]).some((item) =>
    targets.has(item.toLowerCase())
  );
}

function rowHasModel(row, model) {
  return splitModels(row["Model(s) tested"]).some(
    (item) => item.toLowerCase() === model.toLowerCase()
  );
}

function rowHasLicense(row, license) {
  return (row.License ?? "").trim().toLowerCase() === license.toLowerCase();
}

function rowHasCategory(row, category) {
  return (row["General category"] ?? "").trim().toLowerCase() === category.toLowerCase();
}

function leafColumn(header, { releaseDates, keywordCategories }) {
  let displayHeader = header.startsWith("Open-source") ? "Open-source" : header;
  if (header === "Year of publication") {
    displayHeader = "Year";
  }
  if (header === "Human benchmark?" || header === "Human comparison?") {
    displayHeader = (
      <>
        Human
        <br />
        benchmark?
      </>
    );
  }

  return {
    accessorKey: header,
    id: header,
    header: displayHeader,
    cell: ({ getValue, row }) => {
      const value = getValue();
      if (header === "Model(s) tested") {
        return (
          <ModelsCell
            value={value}
            expanded={row.getIsExpanded()}
            releaseDates={releaseDates}
          />
        );
      }
      if (header === "Language(s) tested") {
        return <LanguagesCell value={value} expanded={row.getIsExpanded()} />;
      }
      if (header === "Keywords") {
        return <KeywordsCell value={value} keywordCategories={keywordCategories} />;
      }
      if (header === "Human benchmark?" || header === "Human comparison?") {
        return formatHumanBenchmark(value);
      }
      return formatCellValue(value);
    },
  };
}

function linksColumn() {
  return {
    id: "Links",
    header: "Links",
    enableSorting: false,
    accessorFn: (row) =>
      rowLinkEntries(row)
        .map((entry) => entry.text)
        .join(" "),
    cell: ({ row }) => <LinksCell row={row.original} />,
  };
}

function buildColumns(headers, ctx) {
  const whoIsBetterHeaders = headers.filter(isWhoIsBetterColumn);
  const withoutLinks = headers.filter(
    (header) =>
      header !== "Link" &&
      header !== "Paper Link" &&
      header !== "Dataset Link" &&
      header !== "Other Links" &&
      header !== "Links"
  );
  const paperIndex = withoutLinks.indexOf("Paper title");
  const ordered =
    paperIndex === -1
      ? [...withoutLinks, "Links"]
      : [
          ...withoutLinks.slice(0, paperIndex + 1),
          "Links",
          ...withoutLinks.slice(paperIndex + 1),
        ];
  const columns = [];
  let grouped = false;

  for (const header of ordered) {
    if (header === "Links") {
      columns.push(linksColumn());
      continue;
    }
    if (isWhoIsBetterColumn(header)) {
      if (!grouped) {
        columns.push({
          id: "who-is-better",
          header: "LLMs or Humans: Who is better?",
          columns: whoIsBetterHeaders.map((name) => leafColumn(name, ctx)),
        });
        grouped = true;
      }
      continue;
    }
    columns.push(leafColumn(header, ctx));
  }

  return columns;
}

function expandedFields(row) {
  const fromExample = parseAudioCell(row["Benchmark Example"]);
  const fromAudio = parseAudioCell(row["Benchmark Audio"]);

  const files = [];
  const seen = new Set();
  for (const file of [...fromExample.files, ...fromAudio.files]) {
    const key = file.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    files.push(file);
  }

  const textParts = [fromExample.text, fromAudio.text].filter(Boolean);
  const text = textParts.join("\n\n");

  const fields = [];
  if (text || files.length > 0) {
    fields.push(["Benchmark Example", text, files]);
  }
  if (row.Abstract?.trim()) {
    fields.push(["Abstract", row.Abstract, []]);
  }
  return fields;
}

function ExampleAudioPlayers({ files }) {
  if (!files.length) return null;
  const asset = (path) => `${import.meta.env.BASE_URL}${path}`;
  return (
    <div className="mt-2 space-y-2">
      {files.map((file) => (
        <div key={file} className="max-w-md">
          <audio controls preload="none" className="w-full">
            <source src={asset(`audio/${file}`)} type={audioMimeType(file)} />
          </audio>
          <div className="mt-0.5 text-xs text-slate-500">{file}</div>
        </div>
      ))}
    </div>
  );
}

export default function Table() {
  const [data, setData] = useState([]);
  const [releaseDates, setReleaseDates] = useState(() => new Map());
  const [keywordCategories, setKeywordCategories] = useState(() => new Map());
  const [keywordList, setKeywordList] = useState([]);
  const [selectedKeywords, setSelectedKeywords] = useState(() => new Set());
  const [selectedCategories, setSelectedCategories] = useState(() => new Set());
  const [selectedLanguages, setSelectedLanguages] = useState(() => new Set());
  const [selectedModels, setSelectedModels] = useState(() => new Set());
  const [selectedLicenses, setSelectedLicenses] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sorting, setSorting] = useState([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnVisibility, setColumnVisibility] = useState({});
  const [expanded, setExpanded] = useState({});
  const [panelWidth, setPanelWidth] = useState(0);
  const scrollRef = useRef(null);

  useEffect(() => {
    const asset = (path) => `${import.meta.env.BASE_URL}${path}`;
    Promise.all([
      fetch(asset("data.csv")).then((response) => {
        if (!response.ok) throw new Error(`Failed to load data.csv (${response.status})`);
        return response.text();
      }),
      fetch(asset("model_release_dates.csv")).then((response) => {
        if (!response.ok) throw new Error(`Failed to load model_release_dates.csv (${response.status})`);
        return response.text();
      }),
      fetch(asset("keywords.csv")).then((response) => {
        if (!response.ok) throw new Error(`Failed to load keywords.csv (${response.status})`);
        return response.text();
      }),
    ])
      .then(([tableText, datesText, keywordsText]) => {
        const rows = parseTableCsv(tableText);
        const { byKeyword, list } = parseKeywords(keywordsText);
        setReleaseDates(parseReleaseDates(datesText));
        setKeywordCategories(byKeyword);
        setKeywordList(list);
        setData(rows);
        setColumnVisibility(defaultColumnVisibility(Object.keys(rows[0] ?? {})));
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const languageOptions = useMemo(() => {
    const values = [...LANGUAGE_FILTER_EXTRA_OPTIONS];
    for (const row of data) {
      values.push(...splitKeywords(row["Language(s) tested"]));
    }
    return uniqueSorted(values);
  }, [data]);

  const modelOptions = useMemo(() => {
    const values = [];
    for (const row of data) {
      values.push(...splitModels(row["Model(s) tested"]));
    }
    return uniqueSorted(values);
  }, [data]);

  const licenseOptions = useMemo(() => {
    const values = [];
    for (const row of data) {
      const license = row.License?.trim();
      if (license) values.push(license);
    }
    return uniqueSorted(values);
  }, [data]);

  const categoryOptions = useMemo(() => {
    const values = [];
    for (const row of data) {
      const category = row["General category"]?.trim();
      if (category) values.push(category);
    }
    return uniqueSorted(values);
  }, [data]);

  const usedKeywordList = useMemo(() => {
    const used = new Set();
    for (const row of data) {
      for (const keyword of splitKeywords(row.Keywords)) {
        used.add(keyword.toLowerCase());
      }
    }
    return keywordList.filter(({ keyword }) => used.has(keyword.toLowerCase()));
  }, [data, keywordList]);

  useEffect(() => {
    const used = new Set(usedKeywordList.map(({ keyword }) => keyword));
    setSelectedKeywords((prev) => {
      const next = new Set([...prev].filter((keyword) => used.has(keyword)));
      return next.size === prev.size ? prev : next;
    });
  }, [usedKeywordList]);

  const filteredData = useMemo(() => {
    return data.filter((row) => {
      if (
        selectedCategories.size > 0 &&
        ![...selectedCategories].some((category) => rowHasCategory(row, category))
      ) {
        return false;
      }
      if (
        selectedKeywords.size > 0 &&
        ![...selectedKeywords].every((keyword) => rowHasKeyword(row, keyword))
      ) {
        return false;
      }
      if (
        selectedLanguages.size > 0 &&
        ![...selectedLanguages].every((language) => rowHasLanguage(row, language))
      ) {
        return false;
      }
      if (
        selectedModels.size > 0 &&
        ![...selectedModels].every((model) => rowHasModel(row, model))
      ) {
        return false;
      }
      if (
        selectedLicenses.size > 0 &&
        ![...selectedLicenses].some((license) => rowHasLicense(row, license))
      ) {
        return false;
      }
      return true;
    });
  }, [
    data,
    selectedCategories,
    selectedKeywords,
    selectedLanguages,
    selectedModels,
    selectedLicenses,
  ]);

  const columns = useMemo(
    () =>
      buildColumns(data[0] ? displayHeaders(Object.keys(data[0])) : [], {
        releaseDates,
        keywordCategories,
      }),
    [data, releaseDates, keywordCategories]
  );

  const toggleKeyword = (keyword) => {
    setSelectedKeywords((prev) => {
      const next = new Set(prev);
      if (next.has(keyword)) next.delete(keyword);
      else next.add(keyword);
      return next;
    });
  };

  const toggleCategory = (category) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const addToSet = (setter) => (value) => {
    setter((prev) => {
      if (isSelectedIgnoreCase(prev, value)) return prev;
      const next = new Set(prev);
      next.add(value);
      return next;
    });
  };

  const removeFromSet = (setter) => (value) => {
    setter((prev) => {
      const next = new Set(prev);
      for (const item of prev) {
        if (item.toLowerCase() === value.toLowerCase()) next.delete(item);
      }
      return next;
    });
  };

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const update = () => setPanelWidth(el.clientWidth);
    update();

    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [loading, error, data]);

  const table = useReactTable({
    data: filteredData,
    columns,
    state: { sorting, globalFilter, columnVisibility, expanded },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    onExpandedChange: setExpanded,
    getRowCanExpand: (row) => expandedFields(row.original).length > 0,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  });

  if (loading) {
    return <div className="px-4 py-6 sm:px-8 lg:px-12 text-xs text-gray-600 sm:text-sm">Loading data…</div>;
  }

  if (error) {
    return <div className="px-4 py-6 sm:px-8 lg:px-12 text-xs text-red-600 sm:text-sm">{error}</div>;
  }

  return (
    <div className="w-full px-4 py-6 sm:px-8 lg:px-12 text-xs text-left text-gray-800 sm:text-sm">
      <CategoryFilterBar
        categories={categoryOptions}
        selected={selectedCategories}
        onToggle={toggleCategory}
        onClear={() => setSelectedCategories(new Set())}
      />

      <KeywordFilterBar
        keywords={usedKeywordList}
        selected={selectedKeywords}
        onToggle={toggleKeyword}
        onClear={() => setSelectedKeywords(new Set())}
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <AutocompleteMultiFilter
          label="Languages"
          options={languageOptions}
          selected={selectedLanguages}
          onAdd={addToSet(setSelectedLanguages)}
          onRemove={removeFromSet(setSelectedLanguages)}
          onClear={() => setSelectedLanguages(new Set())}
          placeholder="Search languages…"
        />
        <AutocompleteMultiFilter
          label="Models"
          options={modelOptions}
          selected={selectedModels}
          onAdd={addToSet(setSelectedModels)}
          onRemove={removeFromSet(setSelectedModels)}
          onClear={() => setSelectedModels(new Set())}
          placeholder="Search models…"
        />
        <AutocompleteMultiFilter
          label="License"
          options={licenseOptions}
          selected={selectedLicenses}
          onAdd={addToSet(setSelectedLicenses)}
          onRemove={removeFromSet(setSelectedLicenses)}
          onClear={() => setSelectedLicenses(new Set())}
          placeholder="Search licenses…"
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <input
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder="Filter..."
          className="border border-slate-200 bg-white rounded px-3 py-1.5 text-sm shadow-sm"
        />
        <div className="flex flex-wrap gap-3">
          {table.getAllLeafColumns().map((col) => (
            <label key={col.id} className="flex items-center gap-1 text-gray-600">
              <input
                type="checkbox"
                checked={col.getIsVisible()}
                onChange={col.getToggleVisibilityHandler()}
              />
              {col.id.startsWith("Open-source")
                ? "Open-source"
                : col.id === "Year of publication"
                  ? "Year"
                  : col.id}
            </label>
          ))}
        </div>
      </div>

      <div
        ref={scrollRef}
        className="overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm resize max-w-full mb-4"
        style={{ width: "100%", height: "80vh", minWidth: "320px", minHeight: "200px" }}
      >
        <table className="w-full min-w-max border-separate border-spacing-0">
          <thead className="sticky top-0 z-20 bg-slate-100 shadow-[0_2px_4px_rgba(15,23,42,0.08)]">
            {table.getHeaderGroups().map((hg, groupIndex) => (
              <tr key={hg.id} className="bg-slate-100 last:border-b-2 last:border-slate-300">
                {hg.headers.map((header) => {
                  if (groupIndex > 0 && !header.column.parent) return null;

                  const isGroupedParent = header.column.id === "who-is-better";
                  const rowSpan = header.isPlaceholder
                    ? table.getHeaderGroups().length
                    : undefined;

                  return (
                    <th
                      key={header.id}
                      colSpan={header.colSpan}
                      rowSpan={rowSpan}
                      onClick={
                        header.column.getCanSort()
                          ? header.column.getToggleSortingHandler()
                          : undefined
                      }
                      className={`py-3 px-3 select-none text-gray-900 font-semibold align-middle bg-slate-100 ${
                        header.column.id === "Human benchmark?" ||
                        header.column.id === "Human comparison?"
                          ? "text-left"
                          : isGroupedParent || isWhoIsBetterColumn(header.column.id)
                            ? "text-center"
                            : "text-left whitespace-nowrap"
                      } ${header.column.getCanSort() ? "cursor-pointer" : ""} ${columnWidthClass(header.column.id)}`}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {{ asc: " ↑", desc: " ↓" }[header.column.getIsSorted()] ?? ""}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => {
              const canExpand = row.getCanExpand();
              const categoryColor =
                CATEGORY_ROW_COLORS[row.original["General category"]] ?? "#e2e8f0";
              const rowGradient = `linear-gradient(to right, ${categoryColor}, #ffffff)`;
              return (
                <Fragment key={row.id}>
                  <tr
                    onClick={canExpand ? row.getToggleExpandedHandler() : undefined}
                    style={{ backgroundImage: rowGradient }}
                    className={`category-row border-slate-100 ${
                      row.getIsExpanded() ? "border-b-0" : "border-b"
                    } ${canExpand ? "cursor-pointer" : ""}`}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className={`py-2.5 px-3 align-top whitespace-pre-wrap text-gray-700 bg-transparent ${columnWidthClass(cell.column.id)}`}
                        onClick={
                          cell.column.id === "Links"
                            ? (e) => e.stopPropagation()
                            : undefined
                        }
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                  {row.getIsExpanded() && (
                    <tr
                      className="category-detail border-b border-slate-100"
                      style={{ backgroundImage: rowGradient }}
                    >
                      <td colSpan={row.getVisibleCells().length} className="p-0 bg-transparent">
                        <div
                          className="sticky left-0 box-border px-4 py-3 space-y-3 text-gray-600"
                          style={{ width: panelWidth || "100%" }}
                        >
                          {expandedFields(row.original).map(([label, value, audioFiles = []]) => (
                            <div key={label}>
                              <div className="font-medium text-gray-700 mb-1">{label}</div>
                              {value?.trim() ? (
                                <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                                  {value}
                                </div>
                              ) : null}
                              {label === "Benchmark Example" ? (
                                <ExampleAudioPlayers files={audioFiles} />
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-0 mb-6 pt-2 text-xs text-gray-600 sm:text-sm">
        <sup>†</sup> Open-source models not explicitly tested, however we assume their performance to be less than or equal to closed and open-weight models.
      </p>
    </div>
  );
}
