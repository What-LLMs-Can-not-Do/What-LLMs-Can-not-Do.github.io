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


def summarize_row(row: Dict[str, str]) -> str:
    summary = (row.get("Summary") or "").strip()
    if summary:
        return summary if len(summary) <= 280 else summary[:277] + "..."
    return ""


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
                }
            )
            continue
        if before[title] != row:
            changes.append(
                {
                    "type": "changes",
                    "title": title,
                    "summary": summarize_row(row),
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
