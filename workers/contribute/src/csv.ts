/** Minimal RFC4180-ish CSV helpers for Workers (no Node deps). */

export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

export function serializeCsvRow(fields: string[]): string {
  return fields
    .map((value) => {
      const needsQuotes = /[",\n\r]/.test(value);
      if (needsQuotes) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    })
    .join(",");
}

/**
 * Parse a full CSV document into rows of fields.
 * Unlike line-splitting, this respects newlines inside quoted fields (RFC 4180).
 */
export function parseCsvRows(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      field = "";
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }

  row.push(field);
  if (row.some((cell) => cell !== "")) rows.push(row);
  return rows;
}

export function parseCsvRecords(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const table = parseCsvRows(text);
  if (!table.length) {
    return { headers: [], rows: [] };
  }
  const headers = table[0];
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < table.length; i++) {
    const values = table[i];
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? "";
    }
    rows.push(row);
  }
  return { headers, rows };
}

export function serializeCsv(headers: string[], rows: Record<string, string>[]): string {
  const lines = [serializeCsvRow(headers)];
  for (const row of rows) {
    lines.push(serializeCsvRow(headers.map((h) => row[h] ?? "")));
  }
  return `${lines.join("\n")}\n`;
}

/** Prefer the file's existing newline style so rewrites don't churn every line. */
export function detectEol(text: string): "\r\n" | "\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}

export type SpannedCsvRow = {
  /** Inclusive start offset in the original text. */
  start: number;
  /** Exclusive end offset (includes trailing newline when present). */
  end: number;
  fields: string[];
};

/**
 * Parse CSV into rows with original-text spans (RFC 4180 multiline quotes).
 * Empty records are skipped but still advance offsets.
 */
export function parseCsvSpannedRows(text: string): SpannedCsvRow[] {
  const input = text.replace(/^\uFEFF/, "");
  const rows: SpannedCsvRow[] = [];
  let rowStart = 0;
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const finishRow = (end: number) => {
    row.push(field);
    field = "";
    if (row.some((cell) => cell !== "")) {
      rows.push({ start: rowStart, end, fields: row });
    }
    row = [];
    rowStart = end;
  };

  while (i < input.length) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\r" && input[i + 1] === "\n") {
      finishRow(i + 2);
      i += 2;
      continue;
    }
    if (ch === "\n") {
      finishRow(i + 1);
      i++;
      continue;
    }
    field += ch;
    i++;
  }

  if (field !== "" || row.length > 0) {
    finishRow(input.length);
  }

  return rows;
}

function rowTerminator(text: string, end: number, fallback: "\r\n" | "\n"): string {
  if (end >= 2 && text.slice(end - 2, end) === "\r\n") return "\r\n";
  if (end >= 1 && text[end - 1] === "\n") return "\n";
  return fallback;
}

function recordToObject(headers: string[], fields: string[]): Record<string, string> {
  const row: Record<string, string> = {};
  for (let j = 0; j < headers.length; j++) {
    row[headers[j]] = fields[j] ?? "";
  }
  return row;
}

function isTableHeaderFields(fields: string[]): boolean {
  return (
    fields[0] === "General category" ||
    (fields[0] === "ID" && fields[1] === "General category")
  );
}

const AUDIO_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]*\.(mp3|wav)$/i;

export function isSafeAudioName(name: string): boolean {
  const normalized = name.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  return AUDIO_NAME_RE.test(normalized) && !normalized.includes("..");
}

export function normalizeAudioName(name: string): string {
  const base = name.trim().replace(/\\/g, "/").split("/").pop() ?? "";
  if (!isSafeAudioName(base)) {
    throw new Error(`Invalid audio filename: ${JSON.stringify(base)}`);
  }
  return base;
}

export function findHeaderIndex(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("ID,General category,") || lines[i].startsWith("General category,")) {
      return i;
    }
  }
  throw new Error("Could not find header row in table CSV");
}

function nextRowId(header: string[], rows: Record<string, string>[]): string {
  if (!header.includes("ID")) return "";
  let maxId = 0;
  for (const row of rows) {
    const raw = (row.ID || "").trim();
    if (!raw) continue;
    const n = Number.parseInt(raw, 10);
    if (!Number.isNaN(n)) maxId = Math.max(maxId, n);
  }
  return String(maxId + 1);
}

export type ContributionData = Record<string, unknown>;

function fieldMapFromData(data: ContributionData, rowId = ""): Record<string, string> {
  const str = (key: string, ...alts: string[]) => {
    for (const k of [key, ...alts]) {
      const v = data[k];
      if (v != null && String(v).trim() !== "") return String(v);
    }
    return "";
  };
  return {
    ID: rowId,
    "General category": str("General category"),
    "Subtopic/Keywords": str("Subtopic/Keywords"),
    Keywords: str("Keywords"),
    "Paper title": str("Paper title"),
    License: str("License"),
    "Language(s)": str("Language(s)", "Language(s) tested"),
    "Model(s) tested": str("Model(s) tested"),
    "Year of publication": str("Year of publication"),
    "Paper Link": str("Paper Link", "Link"),
    "Dataset Link": str("Dataset Link"),
    "Other Links": str("Other Links"),
    Link: str("Paper Link", "Link"),
    Summary: str("Summary"),
    "Human benchmark?": str("Human benchmark?"),
    Closed: str("Closed"),
    "Open-weight": str("Open-weight"),
    "Open-source (including open training data)": str(
      "Open-source",
      "Open-source (including open training data)"
    ),
    "Benchmark Example": str("Benchmark Example"),
    "Benchmark Audio": str("Benchmark Audio"),
    Abstract: str("Abstract"),
    "Comments?": str("Comments", "Comments?"),
  };
}

export function appendDataCsv(csvText: string, data: ContributionData): { text: string; paperTitle: string } {
  const text = csvText.replace(/^\uFEFF/, "");
  const eol = detectEol(text);
  const spanned = parseCsvSpannedRows(text);
  const headerRow = spanned.find((r) => isTableHeaderFields(r.fields));
  if (!headerRow) throw new Error("Could not find header row in table CSV");

  const headers = headerRow.fields;
  const fieldMap = fieldMapFromData(data, nextRowId(headers, []));
  // Prefer UI-assigned IDs: no ID column in current catalog.
  if (headers.includes("ID")) {
    const existing = spanned
      .filter((r) => r.start > headerRow.start)
      .map((r) => recordToObject(headers, r.fields));
    fieldMap.ID = nextRowId(headers, existing);
  }

  const newLine = serializeCsvRow(headers.map((h) => fieldMap[h] ?? ""));
  let out = text;
  if (out && !out.endsWith("\n")) out += eol;
  out += `${newLine}${eol}`;

  const paperTitle = String(data["Paper title"] || "submission").trim() || "submission";
  return { text: out, paperTitle };
}

export function updateDataCsv(
  csvText: string,
  rowIdRaw: string,
  data: ContributionData
): { text: string; paperTitle: string } {
  const rowId = String(rowIdRaw).trim();
  if (!rowId) throw new Error("Missing row ID for table change");

  const text = csvText.replace(/^\uFEFF/, "");
  const eol = detectEol(text);
  const spanned = parseCsvSpannedRows(text);
  const headerIdx = spanned.findIndex((r) => isTableHeaderFields(r.fields));
  if (headerIdx === -1) throw new Error("Could not find header row in table CSV");

  const headers = spanned[headerIdx].fields;
  const dataRows = spanned.slice(headerIdx + 1);

  let target: SpannedCsvRow | undefined;
  let existing: Record<string, string> | undefined;

  if (!headers.includes("ID")) {
    // Match the site UI: IDs are 1-based among rows that have a paper title.
    const titled = dataRows.filter((r) => (r.fields[headers.indexOf("Paper title")] || "").trim());
    const idx = Number.parseInt(rowId, 10) - 1;
    if (Number.isNaN(idx) || idx < 0 || idx >= titled.length) {
      throw new Error(`No row with ID ${rowId}`);
    }
    target = titled[idx];
    existing = recordToObject(headers, target.fields);
  } else {
    const idIdx = headers.indexOf("ID");
    target = dataRows.find((r) => (r.fields[idIdx] || "").trim() === rowId);
    if (!target) throw new Error(`No row with ID ${rowId}`);
    existing = recordToObject(headers, target.fields);
  }

  const fieldMap = fieldMapFromData(data, headers.includes("ID") ? rowId : "");
  /** Catalog fields the Contribute form does not edit — keep existing when blank. */
  const preserveIfBlank = new Set([
    "ID",
    "Num chars in summary",
    "Subtopic/Keywords",
    "Benchmark Audio",
    "Link",
  ]);
  const merged = Object.fromEntries(
    headers.map((h) => {
      if (!(h in fieldMap)) return [h, existing[h] ?? ""];
      const next = fieldMap[h];
      if (next === "" && preserveIfBlank.has(h)) return [h, existing[h] ?? ""];
      return [h, next];
    })
  );

  const rowChanged = headers.some((h) => (merged[h] ?? "") !== (existing[h] ?? ""));
  const paperTitle =
    (merged["Paper title"] || String(data["Paper title"] || "submission")).trim() || "submission";

  if (!rowChanged) {
    return { text: csvText, paperTitle, changed: false };
  }

  const term = rowTerminator(text, target.end, eol);
  const replacement = `${serializeCsvRow(headers.map((h) => merged[h] ?? ""))}${term}`;
  const out = `${text.slice(0, target.start)}${replacement}${text.slice(target.end)}`;

  return { text: out, paperTitle, changed: true };
}

export function appendModelsCsv(
  csvText: string,
  newModels: unknown[]
): { text: string; added: string[] } {
  if (!newModels?.length) return { text: csvText, added: [] };

  let text = csvText || "";
  const eol = detectEol(text) || "\n";
  if (!text.trim()) text = `model,family,openness,release_date,link${eol}`;

  const { headers, rows } = parseCsvRecords(text);
  const fieldnames = headers.length
    ? headers
    : ["model", "family", "openness", "release_date", "link"];
  const existing = new Set(
    rows.map((r) => (r.model || "").trim().toLowerCase()).filter(Boolean)
  );

  const added: string[] = [];
  const extraLines: string[] = [];

  for (const item of newModels) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const model = String(rec.model || "").trim();
    if (!model || existing.has(model.toLowerCase())) continue;
    const row = {
      model,
      family: String(rec.family || "").trim(),
      openness: String(rec.openness || "").trim(),
      release_date: String(rec.release_date || "").trim(),
      link: String(rec.link || "").trim(),
    };
    extraLines.push(serializeCsvRow(fieldnames.map((h) => row[h as keyof typeof row] ?? "")));
    existing.add(model.toLowerCase());
    added.push(model);
  }

  if (!added.length) return { text: csvText, added: [] };

  let out = text;
  if (out && !out.endsWith("\n")) out += eol;
  out += extraLines.map((line) => `${line}${eol}`).join("");
  return { text: out, added };
}

export function appendKeywordsCsv(
  csvText: string,
  newKeywords: unknown[]
): { text: string; added: string[] } {
  if (!newKeywords?.length) return { text: csvText, added: [] };

  let text = csvText || "";
  const eol = detectEol(text) || "\n";
  if (!text.trim()) text = `Category,Keyword${eol}`;

  const { headers, rows } = parseCsvRecords(text);
  const fieldnames = headers.length ? headers : ["Category", "Keyword"];
  const existing = new Set(
    rows.map((r) => (r.Keyword || "").trim().toLowerCase()).filter(Boolean)
  );

  const added: string[] = [];
  const extraLines: string[] = [];

  for (const item of newKeywords) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const keyword = String(rec.keyword || "").trim();
    const category = String(rec.category || "").trim();
    if (!keyword || !category || existing.has(keyword.toLowerCase())) continue;
    const row = { Category: category, Keyword: keyword };
    extraLines.push(serializeCsvRow(fieldnames.map((h) => row[h as keyof typeof row] ?? "")));
    existing.add(keyword.toLowerCase());
    added.push(keyword);
  }

  if (!added.length) return { text: csvText, added: [] };

  let out = text;
  if (out && !out.endsWith("\n")) out += eol;
  out += extraLines.map((line) => `${line}${eol}`).join("");
  return { text: out, added };
}
