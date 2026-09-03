export function parseCsv(text, delimiter = ",") {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || (char === "\r" && text[i + 1] === "\n")) {
      row.push(field);
      field = "";
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      if (char === "\r") i++;
    } else {
      field += char;
    }
  }

  row.push(field);
  if (row.some((cell) => cell !== "")) rows.push(row);

  const [headers, ...dataRows] = rows;
  return dataRows.map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]))
  );
}

const EXCLUDED_COLUMNS = new Set([
  "Comments?",
  "Subtopic/Keywords",
  "Paper Link",
  "Dataset Link",
  "Other Links",
  "Link",
  "Num chars in summary",
]);

const HIDDEN_COLUMNS = new Set([
  "ID",
  "Abstract",
  "Benchmark Example",
  "Benchmark Audio",
  "Human benchmark?",
  "Year of publication",
  "Model(s) tested",
]);

const AUDIO_TOKEN_RE = /\b([A-Za-z0-9][A-Za-z0-9._/-]*\.(?:mp3|wav))\b/gi;
const AUDIO_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*\.(mp3|wav)$/i;
const AUDIO_BELOW_RE = /\[audio\s+below\]/gi;

function isSafeAudioName(name) {
  return AUDIO_NAME_RE.test(name) && !name.includes("..");
}

function cleanupExampleText(text) {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[\s,;|/\-–—]+|[\s,;|/\-–—]+$/g, "")
    .trim();
}

function lineHasInlineAudio(line) {
  AUDIO_TOKEN_RE.lastIndex = 0;
  if (!AUDIO_TOKEN_RE.test(line)) return false;
  AUDIO_TOKEN_RE.lastIndex = 0;
  return line.replace(AUDIO_TOKEN_RE, "").trim().length > 0;
}

/**
 * Pull .mp3/.wav filenames out of a cell that may also contain accompanying text.
 * Filenames may be comma-separated or embedded in prose.
 * Audio players render above the text by default; use [audio below] to place them
 * after the text, or write a filename inline in a sentence to embed the player there.
 */
export function parseAudioCell(value) {
  if (!value?.trim()) {
    return { files: [], text: "", placement: "above", segments: null };
  }

  let raw = value;
  let placement = "above";
  if (AUDIO_BELOW_RE.test(raw)) {
    placement = "below";
    raw = raw.replace(AUDIO_BELOW_RE, "");
  }

  AUDIO_TOKEN_RE.lastIndex = 0;
  const files = [];
  const seen = new Set();
  const matches = [];

  for (const match of raw.matchAll(AUDIO_TOKEN_RE)) {
    const name = match[1].replace(/^\/+/, "");
    if (isSafeAudioName(name) && !seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      files.push(name);
      matches.push({ index: match.index, length: match[0].length, name });
    }
  }

  if (!files.length) {
    return { files: [], text: cleanupExampleText(raw), placement, segments: null };
  }

  const hasInline =
    placement !== "below" &&
    matches.some((match) => {
      const lineStart = raw.lastIndexOf("\n", match.index - 1) + 1;
      const lineEnd = raw.indexOf("\n", match.index);
      const line = raw.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
      return lineHasInlineAudio(line);
    });

  if (hasInline) {
    const segments = [];
    let last = 0;
    for (const match of matches) {
      const before = cleanupExampleText(raw.slice(last, match.index));
      if (before) segments.push({ type: "text", content: before });
      segments.push({ type: "audio", file: match.name });
      last = match.index + match.length;
    }
    const after = cleanupExampleText(raw.slice(last));
    if (after) segments.push({ type: "text", content: after });
    const text = segments
      .filter((segment) => segment.type === "text")
      .map((segment) => segment.content)
      .join("\n\n");
    return { files, text, placement: "inline", segments };
  }

  AUDIO_TOKEN_RE.lastIndex = 0;
  const text = cleanupExampleText(raw.replace(AUDIO_TOKEN_RE, " "));
  return { files, text, placement, segments: null };
}

/** @deprecated Prefer parseAudioCell */
export function splitAudioFiles(value) {
  return parseAudioCell(value).files;
}

export function audioMimeType(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  return "application/octet-stream";
}

/** Index of the real header line (supports legacy and ID-prefixed headers). */
export function findTableHeaderIndex(text) {
  const lines = text.split(/\r?\n/);
  return lines.findIndex(
    (line) =>
      line.startsWith("ID,General category,") || line.startsWith("General category,")
  );
}

export function parseTableCsv(text) {
  const lines = text.split(/\r?\n/);
  const headerIdx = findTableHeaderIndex(text);
  if (headerIdx === -1) throw new Error("Could not find header row in table CSV");

  // Reconstruct from the header line onward without breaking quoted newlines:
  // locate the character offset of that line start.
  let start = 0;
  for (let i = 0; i < headerIdx; i++) {
    start += lines[i].length;
    // account for the newline that split removed
    if (start < text.length && text[start] === "\r") start++;
    if (start < text.length && text[start] === "\n") start++;
  }

  return parseCsv(text.slice(start)).filter((row) => row["Paper title"]?.trim());
}

export function findTableRowById(rows, id) {
  const needle = String(id ?? "").trim();
  if (!needle) return null;
  return rows.find((row) => String(row.ID ?? "").trim() === needle) ?? null;
}

/** Map a table CSV row to contribute-form field names. */
export function tableRowToContributionForm(row) {
  if (!row) return null;
  return {
    "General category": row["General category"] ?? "",
    Keywords: row.Keywords ?? "",
    "Paper title": row["Paper title"] ?? "",
    License: row.License ?? "",
    "Language(s)": row["Language(s)"] ?? row["Language(s) tested"] ?? "",
    "Model(s) tested": row["Model(s) tested"] ?? "",
    "Year of publication": row["Year of publication"] ?? "",
    "Paper Link": row["Paper Link"] ?? row.Link ?? "",
    "Dataset Link": row["Dataset Link"] ?? "",
    "Other Links": row["Other Links"] ?? "",
    Summary: row.Summary ?? "",
    "Human benchmark?": row["Human benchmark?"] ?? "",
    Closed: row.Closed ?? "",
    "Open-weight": row["Open-weight"] ?? "",
    "Open-source":
      row["Open-source (including open training data)"] ?? row["Open-source"] ?? "",
    "Benchmark Example": row["Benchmark Example"] ?? "",
    Abstract: row.Abstract ?? "",
    Comments: row["Comments?"] ?? row.Comments ?? "",
  };
}

/** @deprecated Use parseTableCsv */
export const parseData2Csv = parseTableCsv;

export function parseReleaseDates(text) {
  const rows = parseCsv(text, "\t");
  const dates = new Map();
  for (const row of rows) {
    const model = row.model?.trim();
    const date = row.release_date?.trim();
    if (!model || !date) continue;
    dates.set(model, date);
    dates.set(model.toLowerCase(), date);
  }
  return dates;
}

/** Display / sort order for keyword categories (3-col grid: Domain starts row 2). */
export const KEYWORD_CATEGORY_ORDER = [
  "Modality",
  "Attribute",
  "Format",
  "Domain",
  "Language",
  "Task",
];

function keywordCategoryRank(category) {
  const index = KEYWORD_CATEGORY_ORDER.indexOf(category);
  return index === -1 ? KEYWORD_CATEGORY_ORDER.length : index;
}

export function parseKeywords(text) {
  const rows = parseCsv(text);
  const byKeyword = new Map();
  const categories = new Set();
  const list = [];

  for (const row of rows) {
    const category = row.Category?.trim();
    const keyword = row.Keyword?.trim();
    if (!category || !keyword) continue;
    if (byKeyword.has(keyword)) continue;
    categories.add(category);
    byKeyword.set(keyword, category);
    byKeyword.set(keyword.toLowerCase(), category);
    list.push({ keyword, category });
  }

  list.sort((a, b) => {
    if (a.category === b.category) return a.keyword.localeCompare(b.keyword);
    const byRank = keywordCategoryRank(a.category) - keywordCategoryRank(b.category);
    return byRank || a.category.localeCompare(b.category);
  });

  const orderedCategories = [...categories].sort(
    (a, b) => keywordCategoryRank(a) - keywordCategoryRank(b) || a.localeCompare(b)
  );

  return { byKeyword, categories: orderedCategories, list };
}

/** Group a keyword list into `{ category, keywords }[]`, preserving list order. */
export function groupKeywordsByCategory(list) {
  const groups = [];
  let current = null;
  for (const item of list) {
    if (!current || current.category !== item.category) {
      current = { category: item.category, keywords: [] };
      groups.push(current);
    }
    current.keywords.push(item);
  }
  return groups;
}

export function splitModels(value) {
  if (!value?.trim()) return [];
  return value
    .split(",")
    .map((part) => part.trim().replace(/^and\s+/i, "").trim())
    .filter(Boolean);
}

function compactModelKey(name) {
  return name
    .replace(/^[^/\s]+\/(?=[A-Za-z])/, "")
    .replace(/^[(\[]+|[)\]]+$/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/** Map a listed model name to its family (GPT-5, Claude, Llama 3.1, …). */
export function modelFamily(name) {
  const compact = compactModelKey(name);

  if (compact.includes("deepseek")) {
    if (compact.includes("r1")) return "DeepSeek R1";
    if (compact.includes("v3") || /^deepseek3/.test(compact)) return "DeepSeek V3";
    if (compact.includes("v2")) return "DeepSeek V2";
    if (/deepseek4/.test(compact)) return "DeepSeek 4";
    return "DeepSeek";
  }

  if (compact.includes("sealion") || compact.includes("seallm")) return "SEA-LION";

  if (compact.startsWith("claude") || compact.startsWith("sonnet") || compact.startsWith("opus") || compact.startsWith("haiku")) {
    return "Claude";
  }
  if (compact.startsWith("gptoss")) return "GPT-OSS";
  if (compact.startsWith("chatgpt")) return "ChatGPT";
  if (/^gpto[1-4]/.test(compact)) return `o${compact.match(/^gpto([1-4])/)[1]}`;
  if (compact.startsWith("gpt5")) return "GPT-5";
  if (compact.startsWith("gpt4o")) return "GPT-4o";
  if (compact.startsWith("gpt41")) return "GPT-4.1";
  if (compact.startsWith("gpt4")) return "GPT-4";
  if (compact.startsWith("gpt35")) return "GPT-3.5";
  if (compact.startsWith("gpt")) return "GPT";
  if (compact.startsWith("o1")) return "o1";
  if (compact.startsWith("o3")) return "o3";
  if (compact.startsWith("o4")) return "o4";

  if (compact.startsWith("gemini3")) return "Gemini 3";
  if (compact.startsWith("gemini25")) return "Gemini 2.5";
  if (compact.startsWith("gemini2")) return "Gemini 2";
  if (compact.startsWith("gemini1")) return "Gemini 1.5";
  if (compact.startsWith("learnlm")) return "LearnLM";
  if (compact.startsWith("gemini")) return "Gemini";
  if (compact.startsWith("gemma")) return "Gemma";

  if (compact.includes("tinyllama")) return "TinyLlama";
  if (
    compact.startsWith("llama") ||
    compact.includes("llama2") ||
    compact.includes("llama3") ||
    compact.includes("llama4") ||
    /^\d+bllama/.test(compact) ||
    compact.includes("maverick") ||
    compact.includes("scout")
  ) {
    if (compact.includes("llama4") || compact.includes("maverick") || compact.includes("scout")) return "Llama 4";
    if (compact.includes("llama33")) return "Llama 3.3";
    if (compact.includes("llama32")) return "Llama 3.2";
    if (compact.includes("llama31")) return "Llama 3.1";
    if (compact.includes("llama3")) return "Llama 3";
    if (compact.includes("llama2")) return "Llama 2";
    return "Llama";
  }

  if (compact.startsWith("qwen3") || compact.includes("qwen3")) return "Qwen3";
  if (compact.startsWith("qwen25")) return "Qwen2.5";
  if (compact.startsWith("qwen2")) return "Qwen2";
  if (compact.startsWith("qwen") || /(?:^|\d)qwen/.test(compact)) return "Qwen";
  if (compact.startsWith("qwq")) return "QwQ";
  if (compact.startsWith("qvq")) return "QVQ";

  if (compact.startsWith("grok4")) return "Grok 4";
  if (compact.startsWith("grok3")) return "Grok 3";
  if (compact.startsWith("grok")) return "Grok";

  if (compact.startsWith("kimi")) {
    if (compact.includes("k3")) return "Kimi K3";
    if (compact.includes("k2")) return "Kimi K2";
    return "Kimi";
  }

  if (compact.startsWith("glm")) {
    if (compact.startsWith("glm5")) return "GLM 5";
    if (compact.startsWith("glm4")) return "GLM 4";
    return "GLM";
  }

  if (compact.includes("mixtral")) return "Mixtral";
  if (compact.includes("mistral") || compact.includes("ministral")) return "Mistral";
  if (compact.includes("phi")) return "Phi";
  if (compact.startsWith("olmo")) return "OLMo";
  if (compact.includes("falcon")) return "Falcon";
  if (compact.includes("aya")) return "Aya";
  if (compact.includes("audioflamingo")) return "Audio Flamingo";
  if (compact.includes("smollm")) return "SmolLM";
  if (compact.includes("eurollm")) return "EuroLLM";
  if (compact.includes("sailor")) return "Sailor";
  if (compact.includes("salamandra")) return "Salamandra";
  if (compact.includes("babel")) return "Babel";
  if (compact.startsWith("dolly")) return "Dolly";
  if (compact.includes("internlm")) return "InternLM";
  if (compact.includes("vicuna")) return "Vicuna";
  if (compact.startsWith("bloomz")) return "BLOOMZ";
  if (compact.startsWith("ernie")) return "ERNIE";
  if (compact.includes("minimax")) return "MiniMax";
  if (compact.includes("stepaudio") || compact.startsWith("step")) return "Step-Audio";
  if (compact.startsWith("mimo")) return "MiMo";
  if (compact.includes("baichuan")) return "Baichuan";
  if (compact.startsWith("nova")) return "Nova";

  const stripped = name
    .replace(/^[^/\s]+\/(?=[A-Za-z])/, "")
    .replace(/^[(\[]+|[)\]]+$/g, "")
    .replace(/\b\d+(\.\d+)?\s*[Bb]\b/g, " ")
    .replace(/\b(instruct|chat|turbo|preview|thinking|think|base|it|hf)\b/gi, " ")
    .replace(/[-_.:/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = stripped.split(" ").filter(Boolean);
  if (tokens.length === 0) return name.trim() || "Other";
  if (tokens[1] && /^\d/.test(tokens[1])) return `${tokens[0]} ${tokens[1]}`;
  return tokens[0];
}

export function groupModelsByFamily(models, releaseDates) {
  const sorted = sortModelsByReleaseDate(models, releaseDates);
  const groups = [];
  const indexByFamily = new Map();

  for (const model of sorted) {
    const family = modelFamily(model);
    const existing = indexByFamily.get(family);
    if (existing === undefined) {
      indexByFamily.set(family, groups.length);
      groups.push({ family, variants: [model] });
    } else {
      groups[existing].variants.push(model);
    }
  }

  return groups;
}

export function splitKeywords(value) {
  if (!value?.trim()) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Sort keywords by KEYWORD_CATEGORY_ORDER, then alphabetically within category. */
export function sortKeywords(keywords, byKeyword) {
  return [...keywords].sort((a, b) => {
    const catA = byKeyword?.get(a) ?? byKeyword?.get(a.toLowerCase()) ?? "";
    const catB = byKeyword?.get(b) ?? byKeyword?.get(b.toLowerCase()) ?? "";
    const byRank = keywordCategoryRank(catA) - keywordCategoryRank(catB);
    if (byRank) return byRank;
    if (catA !== catB) return catA.localeCompare(catB);
    return a.localeCompare(b);
  });
}

export function sortModelsByReleaseDate(models, releaseDates) {
  return [...models].sort((a, b) => {
    const dateA = releaseDates.get(a) ?? releaseDates.get(a.toLowerCase()) ?? "";
    const dateB = releaseDates.get(b) ?? releaseDates.get(b.toLowerCase()) ?? "";
    if (dateA && dateB) return dateB.localeCompare(dateA);
    if (dateA) return -1;
    if (dateB) return 1;
    return a.localeCompare(b);
  });
}

export function displayHeaders(headers) {
  return headers.filter((header) => !EXCLUDED_COLUMNS.has(header));
}

export function defaultColumnVisibility(headers) {
  return {
    ...Object.fromEntries(
      displayHeaders(headers).map((header) => [header, !HIDDEN_COLUMNS.has(header)])
    ),
    Links: true,
  };
}

export function isWhoIsBetterColumn(header) {
  return (
    header === "Closed" ||
    header === "Open-weight" ||
    header === "Open-source" ||
    header.startsWith("Open-source")
  );
}
