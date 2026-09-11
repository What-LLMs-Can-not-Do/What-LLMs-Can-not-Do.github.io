#!/usr/bin/env python3
"""Shared helpers for table contribution workflows."""

from __future__ import annotations

import base64
import csv
import io
import json
import os
import pathlib
import re
import sys
import textwrap
import urllib.error
import urllib.request

AUDIO_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/-]*\.(mp3|wav)$", re.I)
ATTACHMENT_LINK_RE = re.compile(
    r"\[([^\]]+\.(?:mp3|wav))\]\((https://github\.com/user-attachments/assets/[a-f0-9-]+)\)",
    re.I,
)
CONTRIBUTION_JSON_RE = re.compile(r"```json\s*(\{.*?\})\s*```", re.S)


def is_safe_audio_name(name: str) -> bool:
    name = name.strip().replace("\\", "/").lstrip("/")
    return bool(AUDIO_NAME_RE.match(name)) and ".." not in name


def normalize_audio_name(name: str) -> str:
    name = pathlib.Path(name.strip()).name
    if not is_safe_audio_name(name):
        raise ValueError(f"Invalid audio filename: {name!r}")
    return name


def parse_contribution_json(body: str) -> dict:
    match = CONTRIBUTION_JSON_RE.search(body or "")
    if not match:
        raise ValueError("Could not find contribution JSON in the issue body")
    return json.loads(match.group(1))


def find_header_index(lines: list[str]) -> int:
    for index, line in enumerate(lines):
        if line.startswith("ID,General category,") or line.startswith("General category,"):
            return index
    raise ValueError("Could not find header row in table CSV")


def next_row_id(header: list[str], lines: list[str], header_idx: int) -> str:
    if "ID" not in header:
        return ""
    max_id = 0
    reader = csv.DictReader(io.StringIO("\n".join(lines[header_idx:])))
    for existing in reader:
        raw = (existing.get("ID") or "").strip()
        if not raw:
            continue
        try:
            max_id = max(max_id, int(raw))
        except ValueError:
            pass
    return str(max_id + 1)


def field_map_from_data(data: dict, row_id: str = "") -> dict[str, str]:
    return {
        "ID": row_id,
        "General category": data.get("General category", ""),
        "Subtopic/Keywords": data.get("Subtopic/Keywords", ""),
        "Keywords": data.get("Keywords", ""),
        "Paper title": data.get("Paper title", ""),
        "License": data.get("License", ""),
        "Language(s)": data.get("Language(s)", "") or data.get("Language(s) tested", ""),
        "Model(s) tested": data.get("Model(s) tested", ""),
        "Year of publication": data.get("Year of publication", ""),
        "Paper Link": data.get("Paper Link", "") or data.get("Link", ""),
        "Dataset Link": data.get("Dataset Link", ""),
        "Other Links": data.get("Other Links", ""),
        "Link": data.get("Paper Link", "") or data.get("Link", ""),
        "Summary": data.get("Summary", ""),
        "Human benchmark?": data.get("Human benchmark?", ""),
        "Closed": data.get("Closed", ""),
        "Open-weight": data.get("Open-weight", ""),
        "Open-source (including open training data)": data.get("Open-source", "")
        or data.get("Open-source (including open training data)", ""),
        "Benchmark Example": data.get("Benchmark Example", ""),
        "Benchmark Audio": data.get("Benchmark Audio", ""),
        "Abstract": data.get("Abstract", ""),
        "Comments?": data.get("Comments", "") or data.get("Comments?", ""),
    }


def update_csv_row(csv_path: pathlib.Path, row_id: str, data: dict) -> str:
    row_id = str(row_id).strip()
    if not row_id:
        raise ValueError("Missing row ID for table change")

    text = csv_path.read_text(encoding="utf-8")
    lines = text.splitlines()
    header_idx = find_header_index(lines)
    header = next(csv.reader([lines[header_idx]]))
    prefix = lines[:header_idx]

    reader = csv.DictReader(io.StringIO("\n".join(lines[header_idx:])))
    rows = list(reader)
    found = False
    updated_rows: list[dict[str, str]] = []

    if "ID" not in header:
        # IDs are generated in the UI as 1-based file order; match that here.
        try:
            idx = int(row_id) - 1
        except ValueError as exc:
            raise ValueError(f"Invalid row ID {row_id}") from exc
        if idx < 0 or idx >= len(rows):
            raise ValueError(f"No row with ID {row_id}")
        field_map = field_map_from_data(data, "")
        for i, row in enumerate(rows):
            if i == idx:
                updated_rows.append({col: field_map.get(col, row.get(col, "")) for col in header})
            else:
                updated_rows.append(row)
        found = True
    else:
        for row in rows:
            if (row.get("ID") or "").strip() == row_id:
                field_map = field_map_from_data(data, row_id)
                updated_rows.append({col: field_map.get(col, row.get(col, "")) for col in header})
                found = True
            else:
                updated_rows.append(row)

    if not found:
        raise ValueError(f"No row with ID {row_id}")

    out_lines = list(prefix)
    out_lines.append(lines[header_idx])
    for row in updated_rows:
        row_buf = io.StringIO()
        writer = csv.writer(row_buf, lineterminator="\n")
        writer.writerow([row.get(col, "") for col in header])
        out_lines.append(row_buf.getvalue().rstrip("\n"))

    csv_path.write_text("\n".join(out_lines) + "\n", encoding="utf-8")
    return (data.get("Paper title") or "submission").strip() or "submission"


def append_csv_row(csv_path: pathlib.Path, data: dict) -> str:
    text = csv_path.read_text(encoding="utf-8")
    lines = text.splitlines()
    header_idx = find_header_index(lines)
    header = next(csv.reader([lines[header_idx]]))
    row_id = next_row_id(header, lines, header_idx)
    field_map = field_map_from_data(data, row_id)
    row = [field_map.get(col, "") for col in header]
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow(row)
    new_row = buf.getvalue()
    if text and not text.endswith("\n"):
        text += "\n"
    csv_path.write_text(text + new_row + "\n", encoding="utf-8")
    return (data.get("Paper title") or "submission").strip() or "submission"


def write_audio_files(
    audio_dir: pathlib.Path, files: list[dict], *, overwrite: bool = False
) -> list[str]:
    """Write {name, content_base64} dicts to audio_dir. Returns written names."""
    audio_dir.mkdir(parents=True, exist_ok=True)
    written: list[str] = []
    for item in files:
        name = normalize_audio_name(item.get("name", ""))
        raw = base64.b64decode(item.get("content_base64", ""))
        if not raw:
            raise ValueError(f"Empty audio payload for {name}")
        target = audio_dir / name
        if target.exists() and not overwrite:
            raise ValueError(f"Audio file already exists: {name}")
        target.write_bytes(raw)
        written.append(name)
    return written


def parse_attachment_links(body: str) -> list[tuple[str, str]]:
    return ATTACHMENT_LINK_RE.findall(body or "")


def download_attachment(url: str, token: str | None = None) -> bytes:
    headers = {"User-Agent": "wlcd-contribution-workflow"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"Failed to download {url}: HTTP {error.code}") from error


def download_issue_attachments(body: str, token: str | None = None) -> list[dict]:
    files: list[dict] = []
    for name, url in parse_attachment_links(body):
        content = download_attachment(url, token)
        files.append(
            {
                "name": normalize_audio_name(name),
                "content_base64": base64.b64encode(content).decode("ascii"),
            }
        )
    return files


def pr_body_from_issue(issue_url: str) -> str:
    return textwrap.dedent(
        f"""\
        ## Table contribution

        Automated PR from {issue_url}.

        Please review the new `public/data.csv` row before merging.
        """
    )


def append_models(models_csv_path: pathlib.Path, new_models: list) -> list[str]:
    """Append new model catalog rows. Returns model names that were added."""
    if not new_models:
        return []

    text = models_csv_path.read_text(encoding="utf-8") if models_csv_path.exists() else ""
    if text and not text.endswith("\n"):
        text += "\n"
    if not text.strip():
        text = "model,family,openness,release_date,link\n"

    reader = csv.DictReader(io.StringIO(text))
    fieldnames = reader.fieldnames or ["model", "family", "openness", "release_date", "link"]
    existing = {(row.get("model") or "").strip().lower() for row in reader if (row.get("model") or "").strip()}

    added: list[str] = []
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames, lineterminator="\n")
    for item in new_models:
        if not isinstance(item, dict):
            continue
        model = str(item.get("model") or "").strip()
        if not model or model.lower() in existing:
            continue
        row = {
            "model": model,
            "family": str(item.get("family") or "").strip(),
            "openness": str(item.get("openness") or "").strip(),
            "release_date": str(item.get("release_date") or "").strip(),
            "link": str(item.get("link") or "").strip(),
        }
        writer.writerow(row)
        existing.add(model.lower())
        added.append(model)

    if added:
        models_csv_path.write_text(text + buf.getvalue(), encoding="utf-8")
    return added


def append_keywords(keywords_csv_path: pathlib.Path, new_keywords: list) -> list[str]:
    """Append new keyword catalog rows. Returns keywords that were added."""
    if not new_keywords:
        return []

    text = keywords_csv_path.read_text(encoding="utf-8") if keywords_csv_path.exists() else ""
    if text and not text.endswith("\n"):
        text += "\n"
    if not text.strip():
        text = "Category,Keyword\n"

    reader = csv.DictReader(io.StringIO(text))
    fieldnames = reader.fieldnames or ["Category", "Keyword"]
    existing = {
        (row.get("Keyword") or "").strip().lower()
        for row in reader
        if (row.get("Keyword") or "").strip()
    }

    added: list[str] = []
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=fieldnames, lineterminator="\n")
    for item in new_keywords:
        if not isinstance(item, dict):
            continue
        keyword = str(item.get("keyword") or "").strip()
        category = str(item.get("category") or "").strip()
        if not keyword or not category or keyword.lower() in existing:
            continue
        writer.writerow({"Category": category, "Keyword": keyword})
        existing.add(keyword.lower())
        added.append(keyword)

    if added:
        keywords_csv_path.write_text(text + buf.getvalue(), encoding="utf-8")
    return added


def main() -> None:
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "append-row":
        csv_path = pathlib.Path(os.environ["CSV_PATH"])
        data = json.loads(os.environ["CONTRIBUTION_JSON"])
        paper = append_csv_row(csv_path, data)
        pathlib.Path("/tmp/paper_title.txt").write_text(paper, encoding="utf-8")
        return

    if command == "update-row":
        csv_path = pathlib.Path(os.environ["CSV_PATH"])
        data = json.loads(os.environ["CONTRIBUTION_JSON"])
        row_id = data.get("ID", "")
        paper = update_csv_row(csv_path, row_id, data)
        pathlib.Path("/tmp/paper_title.txt").write_text(paper, encoding="utf-8")
        pathlib.Path("/tmp/row_id.txt").write_text(str(row_id).strip(), encoding="utf-8")
        return

    if command == "append-models":
        models_path = pathlib.Path(os.environ.get("MODELS_CSV_PATH", "public/models.csv"))
        data = json.loads(os.environ["CONTRIBUTION_JSON"])
        added = append_models(models_path, data.get("new_models") or [])
        print(",".join(added))
        return

    if command == "append-keywords":
        keywords_path = pathlib.Path(os.environ.get("KEYWORDS_CSV_PATH", "public/keywords.csv"))
        data = json.loads(os.environ["CONTRIBUTION_JSON"])
        added = append_keywords(keywords_path, data.get("new_keywords") or [])
        print(",".join(added))
        return

    if command == "write-audio":
        audio_dir = pathlib.Path(os.environ["AUDIO_DIR"])
        files = json.loads(os.environ["AUDIO_FILES_JSON"])
        overwrite = os.environ.get("AUDIO_OVERWRITE", "").lower() in {"1", "true", "yes"}
        names = write_audio_files(audio_dir, files, overwrite=overwrite)
        print(",".join(names))
        return

    if command == "issue-attachments":
        body = os.environ.get("ISSUE_BODY", "")
        token = os.environ.get("GITHUB_TOKEN") or None
        files = download_issue_attachments(body, token)
        pathlib.Path("/tmp/audio_files.json").write_text(json.dumps(files), encoding="utf-8")
        print(len(files))
        return

    raise SystemExit(f"Unknown command: {command!r}")


if __name__ == "__main__":
    main()
