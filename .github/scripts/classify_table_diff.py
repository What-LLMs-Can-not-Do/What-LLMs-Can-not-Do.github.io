#!/usr/bin/env python3
"""Classify public/data.csv diffs as table additions and/or changes.

Compares paper titles (and row payloads) between two git revisions of data.csv,
using the same titled-row notion as the site (rows with a non-empty Paper title).
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import subprocess
import sys
from typing import Dict, List, Tuple

# Fields to show for new-row addition emails (order preserved).
# CSV key → display label in email (Open-source drops the parenthetical).
ADDITION_HIGHLIGHT_FIELDS = [
    ("General category", "General category"),
    ("Keywords", "Keywords"),
    ("Summary", "Summary"),
    ("Closed", "Closed"),
    ("Open-weight", "Open-weight"),
    ("Open-source (including open training data)", "Open-source"),
]

# Fields compared / shown for change emails (order preserved).
CHANGE_HIGHLIGHT_FIELDS = [
    "General category",
    "Subtopic/Keywords",
    "Keywords",
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
    "Open-source (including open training data)",
    "Comments?",
]

LONG_FIELDS = {"Summary", "Abstract", "Benchmark Example", "Comments?", "Model(s) tested"}

# Extra fields compared for change emails when they differ.
EXPAND_FIELDS = ("Abstract", "Benchmark Example")

# Safety cap only — avoid multi-megabyte cells blowing up Resend payloads.
MAX_FIELD_CHARS = 20000

# Never include in change lists (noise / derived).
SKIP_FIELDS = {"Num chars in summary", "ID"}


def git_show(rev: str, path: str) -> str:
    try:
        return subprocess.check_output(
            ["git", "show", f"{rev}:{path}"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except subprocess.CalledProcessError:
        return ""


def find_header_index(lines: List[str]) -> int:
    for i, line in enumerate(lines):
        if line.startswith("ID,General category,") or line.startswith("General category,"):
            return i
    raise ValueError("Could not find header row in table CSV")


def parse_titled_rows(text: str) -> Dict[str, Dict[str, str]]:
    if not text.strip():
        return {}
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    header_idx = find_header_index(lines)
    table = "\n".join(lines[header_idx:])
    reader = csv.DictReader(io.StringIO(table))
    rows: Dict[str, Dict[str, str]] = {}
    for row in reader:
        title = (row.get("Paper title") or "").strip()
        if not title:
            continue
        # Keep last occurrence if duplicates exist.
        rows[title] = {k: (v or "") for k, v in row.items()}
    return rows


def clip(value: str, limit: int = MAX_FIELD_CHARS) -> str:
    text = " ".join((value or "").split())
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def summarize_row(row: Dict[str, str]) -> str:
    summary = (row.get("Summary") or "").strip()
    if summary:
        return clip(summary)
    return ""


def row_highlights(row: Dict[str, str]) -> List[dict]:
    highlights = []
    for csv_field, label in ADDITION_HIGHLIGHT_FIELDS:
        raw = (row.get(csv_field) or "").strip()
        if not raw:
            continue
        highlights.append({"field": label, "value": clip(raw)})
    return highlights


def field_changes(before: Dict[str, str], after: Dict[str, str]) -> List[dict]:
    keys = []
    for field in CHANGE_HIGHLIGHT_FIELDS:
        if field not in SKIP_FIELDS:
            keys.append(field)
    # Include any other keys that differ (except skip list / paper title).
    extra = sorted(
        set(before.keys()) | set(after.keys()) - set(keys) - SKIP_FIELDS - {"Paper title"}
    )
    # Prefer highlight order; append Abstract/Benchmark Example only if they changed.
    for field in EXPAND_FIELDS:
        if field not in keys:
            keys.append(field)

    changes = []
    seen = set()
    for field in keys + extra:
        if field in seen or field in SKIP_FIELDS or field == "Paper title":
            continue
        seen.add(field)
        old = (before.get(field) or "").strip()
        new = (after.get(field) or "").strip()
        if old == new:
            continue
        label = (
            "Open-source"
            if field.startswith("Open-source")
            else field
        )
        changes.append(
            {
                "field": label,
                "before": clip(old) if old else "(empty)",
                "after": clip(new) if new else "(empty)",
            }
        )
    return changes


def classify(before: Dict[str, Dict[str, str]], after: Dict[str, Dict[str, str]]) -> Tuple[List[dict], List[dict]]:
    additions = []
    changes = []
    for title, row in after.items():
        if title not in before:
            additions.append(
                {
                    "type": "additions",
                    "title": title,
                    "summary": summarize_row(row),
                    "highlights": row_highlights(row),
                }
            )
            continue
        if before[title] != row:
            diffs = field_changes(before[title], row)
            changes.append(
                {
                    "type": "changes",
                    "title": title,
                    "summary": summarize_row(row),
                    "field_changes": diffs,
                }
            )
    return additions, changes


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--before", required=True, help="Git revision before the change")
    parser.add_argument("--after", required=True, help="Git revision after the change")
    parser.add_argument("--path", default="public/data.csv")
    parser.add_argument("--pr-url", default="")
    args = parser.parse_args()

    before_rows = parse_titled_rows(git_show(args.before, args.path))
    after_rows = parse_titled_rows(git_show(args.after, args.path))
    additions, changes = classify(before_rows, after_rows)

    events = []
    for item in additions + changes:
        if args.pr_url:
            item["pr_url"] = args.pr_url
        events.append(item)

    json.dump({"events": events}, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
