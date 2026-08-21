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
]);

const HIDDEN_COLUMNS = new Set([
  "Abstract",
  "Benchmark Example",
]);

export function parseTableCsv(text) {
  const start = text.indexOf("General category");
  if (start === -1) throw new Error("Could not find header row in table CSV");

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
  return Object.fromEntries(
    displayHeaders(headers).map((header) => [header, !HIDDEN_COLUMNS.has(header)])
  );
}

export function isWhoIsBetterColumn(header) {
  return (
    header === "Closed" ||
    header === "Open-weight" ||
    header === "Open-source" ||
    header.startsWith("Open-source")
  );
}
