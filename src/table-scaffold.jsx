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
  defaultColumnVisibility,
  displayHeaders,
  isWhoIsBetterColumn,
  parseKeywords,
  parseReleaseDates,
  parseTableCsv,
  sortModelsByReleaseDate,
  splitKeywords,
  splitModels,
} from "./parseCsv.js";

const PREVIEW_COUNT = 3;

const CATEGORY_STYLES = {
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
  "Tasks with reasoning": "#ddd6fe",
  "Cross-lingual tasks": "#fbcfe8",
};

const NARROW_COLUMNS = new Set([
  "Language(s) tested",
  "Model(s) tested",
]);

const WHO_IS_BETTER_LEAF_COLUMNS = new Set([
  "Closed",
  "Open-weight",
  "Open-source",
]);

const MEDIUM_NARROW_COLUMNS = new Set(["Keywords"]);

const REDUCED_COLUMNS = new Set(["Paper title", "Summary"]);

function columnWidthClass(columnId) {
  if (WHO_IS_BETTER_LEAF_COLUMNS.has(columnId) || columnId.startsWith("Open-source")) {
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
    return <span className="text-lg text-green-600 font-medium">✔</span>;
  }
  if (normalized === "no") {
    return <span className="text-lg text-red-600 font-medium">✘</span>;
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
  if (!q) return [];

  const scored = [];
  for (const option of options) {
    if (isSelectedIgnoreCase(selected, option)) continue;
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
            {query.trim() === "" ? (
              <div className="px-3 py-2 text-xs text-slate-500">Type to search…</div>
            ) : suggestions.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-500">No matches</div>
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

function rowHasLanguage(row, language) {
  return splitKeywords(row["Language(s) tested"]).some(
    (item) => item.toLowerCase() === language.toLowerCase()
  );
}

function rowHasModel(row, model) {
  return splitModels(row["Model(s) tested"]).some(
    (item) => item.toLowerCase() === model.toLowerCase()
  );
}

function leafColumn(header, { releaseDates, keywordCategories }) {
  let displayHeader = header.startsWith("Open-source") ? "Open-source" : header;
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
      if (header === "Link") {
        return value ? (
          <a
            href={value}
            target="_blank"
            rel="noreferrer"
            className="inline-block text-lg leading-none no-underline"
            title={value}
            aria-label={value}
          >
            🔗
          </a>
        ) : null;
      }
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

function buildColumns(headers, ctx) {
  const whoIsBetterHeaders = headers.filter(isWhoIsBetterColumn);
  const withoutLink = headers.filter((header) => header !== "Link");
  const paperIndex = withoutLink.indexOf("Paper title");
  const ordered =
    paperIndex === -1
      ? headers
      : [
          ...withoutLink.slice(0, paperIndex + 1),
          "Link",
          ...withoutLink.slice(paperIndex + 1),
        ];
  const columns = [];
  let grouped = false;

  for (const header of ordered) {
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
  return [
    ["Benchmark Example", row["Benchmark Example"]],
    ["Abstract", row.Abstract],
  ].filter(([, value]) => value?.trim());
}

export default function Table() {
  const [data, setData] = useState([]);
  const [releaseDates, setReleaseDates] = useState(() => new Map());
  const [keywordCategories, setKeywordCategories] = useState(() => new Map());
  const [keywordList, setKeywordList] = useState([]);
  const [selectedKeywords, setSelectedKeywords] = useState(() => new Set());
  const [selectedLanguages, setSelectedLanguages] = useState(() => new Set());
  const [selectedModels, setSelectedModels] = useState(() => new Set());
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
      fetch(asset("data3.csv")).then((response) => {
        if (!response.ok) throw new Error(`Failed to load data3.csv (${response.status})`);
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
    const values = [];
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

  const filteredData = useMemo(() => {
    return data.filter((row) => {
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
      return true;
    });
  }, [data, selectedKeywords, selectedLanguages, selectedModels]);

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
    return <div className="px-4 py-6 sm:px-8 lg:px-12 text-sm text-gray-600">Loading data…</div>;
  }

  if (error) {
    return <div className="px-4 py-6 sm:px-8 lg:px-12 text-sm text-red-600">{error}</div>;
  }

  return (
    <div className="w-full px-4 py-6 sm:px-8 lg:px-12 text-sm text-left text-gray-800">
      <KeywordFilterBar
        keywords={keywordList}
        selected={selectedKeywords}
        onToggle={toggleKeyword}
        onClear={() => setSelectedKeywords(new Set())}
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2">
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
              {col.id.startsWith("Open-source") ? "Open-source" : col.id}
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
                          cell.column.id === "Link"
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
                          {expandedFields(row.original).map(([label, value]) => (
                            <div key={label}>
                              <div className="font-medium text-gray-700 mb-1">{label}</div>
                              <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                                {value}
                              </div>
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

      <p className="mt-0 mb-6 pt-2 text-sm text-gray-600">
        <sup>†</sup> Open-source models not explicitly tested, however we assume their performance to be less than or equal to closed and open-weight models.
      </p>
    </div>
  );
}
