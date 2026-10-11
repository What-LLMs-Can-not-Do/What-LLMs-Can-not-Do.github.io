/**
 * Parse table-contribution PRs into Contribute-form payloads by diffing CSVs.
 */

import {
  parseCsvRecords,
  parseCsvSpannedRows,
  type ContributionData,
} from "./csv";

function isTableHeaderFields(fields: string[]): boolean {
  return (
    fields[0] === "General category" ||
    (fields[0] === "ID" && fields[1] === "General category")
  );
}

function recordToObject(headers: string[], fields: string[]): Record<string, string> {
  const row: Record<string, string> = {};
  for (let j = 0; j < headers.length; j++) {
    row[headers[j]] = fields[j] ?? "";
  }
  return row;
}

/** Find the UI-style 1-based ID of a titled row by paper title (case-insensitive). */
export function findTitledRowIdByPaperTitle(
  csvText: string,
  paperTitle: string
): string | null {
  const wanted = paperTitle.trim().toLowerCase();
  if (!wanted) return null;
  for (const entry of parseTitledTableRows(csvText)) {
    if ((entry.row["Paper title"] || "").trim().toLowerCase() === wanted) {
      return entry.id;
    }
  }
  return null;
}

/** Titled data rows with UI-style 1-based IDs (among titled rows). */
export function parseTitledTableRows(
  csvText: string
): { id: string; row: Record<string, string> }[] {
  const text = csvText.replace(/^\uFEFF/, "");
  const spanned = parseCsvSpannedRows(text);
  const headerIdx = spanned.findIndex((r) => isTableHeaderFields(r.fields));
  if (headerIdx === -1) throw new Error("Could not find header row in table CSV");

  const headers = spanned[headerIdx].fields;
  const titled = spanned
    .slice(headerIdx + 1)
    .map((r) => recordToObject(headers, r.fields))
    .filter((row) => (row["Paper title"] || "").trim());

  return titled.map((row, index) => {
    const { ID: _ignored, ...rest } = row;
    return { id: String(index + 1), row: { ID: String(index + 1), ...rest } };
  });
}

function rowFingerprint(row: Record<string, string>): string {
  const keys = Object.keys(row)
    .filter((k) => k !== "ID" && k !== "Num chars in summary")
    .sort();
  return keys.map((k) => `${k}=${(row[k] || "").trim()}`).join("\n");
}

function tableRowToForm(row: Record<string, string>): ContributionData {
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

function titleFromPrTitle(prTitle: string): string {
  const m = prTitle.match(
    /^(?:Table (?:addition|change)|Add table entry|Update table entry(?: #\d+)?):\s*(.+)$/i
  );
  return (m?.[1] || "").trim();
}

function inferContributionType(prTitle: string, isChange: boolean): "addition" | "change" {
  if (/Table change:|Update table entry/i.test(prTitle)) return "change";
  if (/Table addition:|Add table entry:/i.test(prTitle)) return "addition";
  return isChange ? "change" : "addition";
}

export type ParsedContribution = {
  contribution_type: "addition" | "change";
  ID?: string;
  form: ContributionData;
  /** Form values from the base branch row (change PRs only). */
  baseline: ContributionData | null;
  new_models: {
    model: string;
    family: string;
    openness: string;
    release_date: string;
    link: string;
  }[];
  new_keywords: { keyword: string; category: string }[];
  paper_title: string;
};

export function parseContributionFromCsvDiff(options: {
  baseDataCsv: string;
  headDataCsv: string;
  baseModelsCsv?: string;
  headModelsCsv?: string;
  baseKeywordsCsv?: string;
  headKeywordsCsv?: string;
  prTitle: string;
}): ParsedContribution {
  const baseRows = parseTitledTableRows(options.baseDataCsv);
  const headRows = parseTitledTableRows(options.headDataCsv);

  const baseByTitle = new Map(
    baseRows.map((r) => [(r.row["Paper title"] || "").trim().toLowerCase(), r])
  );
  const baseById = new Map(baseRows.map((r) => [r.id, r]));

  const added: typeof headRows = [];
  const changed: { baseId: string; head: (typeof headRows)[0]; base: (typeof headRows)[0] }[] =
    [];

  // Match by paper title (stable across other merges). ID position shifts when
  // rows are added above, so it must not be the primary key.
  for (const head of headRows) {
    const key = (head.row["Paper title"] || "").trim().toLowerCase();
    if (!key) continue;
    const byTitle = baseByTitle.get(key);
    if (!byTitle) {
      added.push(head);
      continue;
    }
    if (rowFingerprint(byTitle.row) !== rowFingerprint(head.row)) {
      changed.push({ baseId: byTitle.id, head, base: byTitle });
    }
  }

  // Prefer the row matching the PR title when multiple diffs exist.
  const wantedTitle = titleFromPrTitle(options.prTitle).toLowerCase();
  let target:
    | { kind: "addition"; entry: (typeof headRows)[0] }
    | {
        kind: "change";
        baseId: string;
        entry: (typeof headRows)[0];
        base: (typeof headRows)[0];
      }
    | null = null;

  if (wantedTitle) {
    const addMatch = added.find(
      (r) => (r.row["Paper title"] || "").trim().toLowerCase() === wantedTitle
    );
    if (addMatch) target = { kind: "addition", entry: addMatch };
    if (!target) {
      const changeMatch = changed.find(
        (c) =>
          (c.head.row["Paper title"] || "").trim().toLowerCase() === wantedTitle ||
          (c.base.row["Paper title"] || "").trim().toLowerCase() === wantedTitle
      );
      if (changeMatch) {
        target = {
          kind: "change",
          baseId: changeMatch.baseId,
          entry: changeMatch.head,
          base: changeMatch.base,
        };
      }
    }
  }

  if (!target && added.length === 1 && changed.length === 0) {
    target = { kind: "addition", entry: added[0] };
  } else if (!target && changed.length === 1 && added.length === 0) {
    target = {
      kind: "change",
      baseId: changed[0].baseId,
      entry: changed[0].head,
      base: changed[0].base,
    };
  } else if (!target && changed.length >= 1) {
    target = {
      kind: "change",
      baseId: changed[0].baseId,
      entry: changed[0].head,
      base: changed[0].base,
    };
  } else if (!target && added.length >= 1) {
    target = { kind: "addition", entry: added[added.length - 1] };
  }

  if (!target) {
    // Fallback: last titled head row (empty / malformed PR).
    const last = headRows[headRows.length - 1];
    if (!last) throw new Error("No titled rows found in PR data.csv");
    const base = baseById.get(last.id) || baseByTitle.get((last.row["Paper title"] || "").trim().toLowerCase());
    target = base
      ? { kind: "change", baseId: base.id, entry: last, base }
      : { kind: "addition", entry: last };
  }

  const contribution_type = inferContributionType(
    options.prTitle,
    target.kind === "change"
  );

  const form = tableRowToForm(target.entry.row);
  const paper_title = String(form["Paper title"] || "submission").trim() || "submission";

  const new_models = diffNewModels(options.baseModelsCsv || "", options.headModelsCsv || "");
  const new_keywords = diffNewKeywords(
    options.baseKeywordsCsv || "",
    options.headKeywordsCsv || ""
  );

  let baseline: ContributionData | null = null;
  if (contribution_type === "change") {
    if (target.kind === "change") {
      baseline = tableRowToForm(target.base.row);
    } else {
      const byId = baseById.get(target.entry.id);
      if (byId) baseline = tableRowToForm(byId.row);
    }
  }

  const result: ParsedContribution = {
    contribution_type,
    form,
    baseline,
    new_models,
    new_keywords,
    paper_title,
  };
  if (contribution_type === "change") {
    result.ID = target.kind === "change" ? target.baseId : target.entry.id;
  }

  return result;
}

function diffNewModels(
  baseCsv: string,
  headCsv: string
): ParsedContribution["new_models"] {
  if (!headCsv.trim()) return [];
  const base = parseCsvRecords(baseCsv);
  const head = parseCsvRecords(headCsv);
  const existing = new Set(
    base.rows.map((r) => (r.model || "").trim().toLowerCase()).filter(Boolean)
  );
  const out: ParsedContribution["new_models"] = [];
  for (const row of head.rows) {
    const model = (row.model || "").trim();
    if (!model || existing.has(model.toLowerCase())) continue;
    out.push({
      model,
      family: (row.family || "").trim(),
      openness: (row.openness || "").trim(),
      release_date: (row.release_date || "").trim(),
      link: (row.link || "").trim(),
    });
  }
  return out;
}

function diffNewKeywords(
  baseCsv: string,
  headCsv: string
): ParsedContribution["new_keywords"] {
  if (!headCsv.trim()) return [];
  const base = parseCsvRecords(baseCsv);
  const head = parseCsvRecords(headCsv);
  const existing = new Set(
    base.rows.map((r) => (r.Keyword || "").trim().toLowerCase()).filter(Boolean)
  );
  const out: ParsedContribution["new_keywords"] = [];
  for (const row of head.rows) {
    const keyword = (row.Keyword || "").trim();
    const category = (row.Category || "").trim();
    if (!keyword || !category || existing.has(keyword.toLowerCase())) continue;
    out.push({ keyword, category });
  }
  return out;
}
