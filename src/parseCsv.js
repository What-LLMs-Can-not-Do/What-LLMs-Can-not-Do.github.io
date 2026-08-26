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
]);

const HIDDEN_COLUMNS = new Set([
  "ID",
  "Abstract",
  "Benchmark Example",
  "Benchmark Audio",
]);

const AUDIO_TOKEN_RE = /\b([A-Za-z0-9][A-Za-z0-9._/-]*\.(?:mp3|wav))\b/gi;
const AUDIO_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*\.(mp3|wav)$/i;

function isSafeAudioName(name) {
  return AUDIO_NAME_RE.test(name) && !name.includes("..");
}

/**
 * Pull .mp3/.wav filenames out of a cell that may also contain accompanying text.
 * Filenames may be comma-separated or embedded in prose.
 */
export function parseAudioCell(value) {
  if (!value?.trim()) return { files: [], text: "" };

  const files = [];
  const seen = new Set();
  const text = value
    .replace(AUDIO_TOKEN_RE, (match) => {
      const name = match.replace(/^\/+/, "");
      if (isSafeAudioName(name) && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        files.push(name);
      }
      return " ";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[\s,;|/\-–—]+|[\s,;|/\-–—]+$/g, "")
    .trim();

  return { files, text };
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

  list.sort((a, b) =>
    a.category === b.category
      ? a.keyword.localeCompare(b.keyword)
      : a.category.localeCompare(b.category)
  );

  return { byKeyword, categories: [...categories].sort(), list };
}

export function splitModels(value) {
  if (!value?.trim()) return [];
  return value
    .split(",")
    .map((part) => part.trim().replace(/^and\s+/i, "").trim())
    .filter(Boolean);
}

export function splitKeywords(value) {
  if (!value?.trim()) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
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
