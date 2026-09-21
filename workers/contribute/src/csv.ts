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
  const lines = csvText.replace(/\r\n/g, "\n").split("\n");
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  const headerIdx = findHeaderIndex(lines);
  const prefix = lines.slice(0, headerIdx);
  const tableText = lines.slice(headerIdx).join("\n");
  const { headers, rows } = parseCsvRecords(tableText);
  const rowId = nextRowId(headers, rows);
  const fieldMap = fieldMapFromData(data, rowId);
  rows.push(Object.fromEntries(headers.map((h) => [h, fieldMap[h] ?? ""])));

  const out = [...prefix, serializeCsvRow(headers), ...rows.map((r) => serializeCsvRow(headers.map((h) => r[h] ?? "")))];
  const paperTitle = (String(data["Paper title"] || "submission").trim() || "submission");
  return { text: `${out.join("\n")}\n`, paperTitle };
}

export function updateDataCsv(
  csvText: string,
  rowIdRaw: string,
  data: ContributionData
): { text: string; paperTitle: string } {
  const rowId = String(rowIdRaw).trim();
  if (!rowId) throw new Error("Missing row ID for table change");

  const lines = csvText.replace(/\r\n/g, "\n").split("\n");
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  const headerIdx = findHeaderIndex(lines);
  const prefix = lines.slice(0, headerIdx);
  const tableText = lines.slice(headerIdx).join("\n");
  const { headers, rows } = parseCsvRecords(tableText);

  let found = false;
  let updated: Record<string, string>[];

  if (!headers.includes("ID")) {
    const idx = Number.parseInt(rowId, 10) - 1;
    if (Number.isNaN(idx) || idx < 0 || idx >= rows.length) {
      throw new Error(`No row with ID ${rowId}`);
    }
    const fieldMap = fieldMapFromData(data, "");
    updated = rows.map((row, i) =>
      i === idx ? Object.fromEntries(headers.map((h) => [h, fieldMap[h] ?? row[h] ?? ""])) : row
    );
    found = true;
  } else {
    updated = rows.map((row) => {
      if ((row.ID || "").trim() === rowId) {
        found = true;
        const fieldMap = fieldMapFromData(data, rowId);
        return Object.fromEntries(headers.map((h) => [h, fieldMap[h] ?? row[h] ?? ""]));
      }
      return row;
    });
  }

  if (!found) throw new Error(`No row with ID ${rowId}`);

  const out = [
    ...prefix,
    serializeCsvRow(headers),
    ...updated.map((r) => serializeCsvRow(headers.map((h) => r[h] ?? ""))),
  ];
  const paperTitle = (String(data["Paper title"] || "submission").trim() || "submission");
  return { text: `${out.join("\n")}\n`, paperTitle };
}

export function appendModelsCsv(
  csvText: string,
  newModels: unknown[]
): { text: string; added: string[] } {
  if (!newModels?.length) return { text: csvText, added: [] };

  let text = csvText || "";
  if (text && !text.endsWith("\n")) text += "\n";
  if (!text.trim()) text = "model,family,openness,release_date,link\n";

  const { headers, rows } = parseCsvRecords(text);
  const fieldnames = headers.length
    ? headers
    : ["model", "family", "openness", "release_date", "link"];
  const existing = new Set(
    rows.map((r) => (r.model || "").trim().toLowerCase()).filter(Boolean)
  );

  const added: string[] = [];
  const extraRows: Record<string, string>[] = [];

  for (const item of newModels) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const model = String(rec.model || "").trim();
    if (!model || existing.has(model.toLowerCase())) continue;
    extraRows.push({
      model,
      family: String(rec.family || "").trim(),
      openness: String(rec.openness || "").trim(),
      release_date: String(rec.release_date || "").trim(),
      link: String(rec.link || "").trim(),
    });
    existing.add(model.toLowerCase());
    added.push(model);
  }

  if (!added.length) return { text: csvText, added: [] };

  const allRows = [...rows, ...extraRows];
  return { text: serializeCsv(fieldnames, allRows), added };
}

export function appendKeywordsCsv(
  csvText: string,
  newKeywords: unknown[]
): { text: string; added: string[] } {
  if (!newKeywords?.length) return { text: csvText, added: [] };

  let text = csvText || "";
  if (text && !text.endsWith("\n")) text += "\n";
  if (!text.trim()) text = "Category,Keyword\n";

  const { headers, rows } = parseCsvRecords(text);
  const fieldnames = headers.length ? headers : ["Category", "Keyword"];
  const existing = new Set(
    rows.map((r) => (r.Keyword || "").trim().toLowerCase()).filter(Boolean)
  );

  const added: string[] = [];
  const extraRows: Record<string, string>[] = [];

  for (const item of newKeywords) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const keyword = String(rec.keyword || "").trim();
    const category = String(rec.category || "").trim();
    if (!keyword || !category || existing.has(keyword.toLowerCase())) continue;
    extraRows.push({ Category: category, Keyword: keyword });
    existing.add(keyword.toLowerCase());
    added.push(keyword);
  }

  if (!added.length) return { text: csvText, added: [] };

  const allRows = [...rows, ...extraRows];
  return { text: serializeCsv(fieldnames, allRows), added };
}
