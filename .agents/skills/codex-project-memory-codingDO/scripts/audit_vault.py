#!/usr/bin/env python3
"""Audit Obsidian project-memory notes without changing the vault."""

from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path


LINK_RE = re.compile(r"!?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]")
SCALAR_RE = re.compile(r"^([A-Za-z_][\w-]*):\s*(.*?)\s*$")
MEMORY_ROOTS = {"20_Projects", "30_Areas", "40_Brain", "50_Wiki"}
REQUIRED = ("title", "type", "status")


def frontmatter(text: str) -> dict[str, str]:
    if not text.startswith("---"):
        return {}
    lines = text.splitlines()
    try:
        end = lines.index("---", 1)
    except ValueError:
        return {}
    data: dict[str, str] = {}
    for line in lines[1:end]:
        match = SCALAR_RE.match(line)
        if match:
            data[match.group(1)] = match.group(2).strip(' "\'')
    return data


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vault", required=True, type=Path)
    parser.add_argument("--project", default="")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    vault = args.vault.resolve()
    if not vault.is_dir():
        parser.error("--vault must be an existing directory")

    all_records = []
    names: set[str] = set()
    aliases: set[str] = set()
    project_key = args.project.casefold()
    for path in vault.rglob("*.md"):
        if any(part in {".git", ".obsidian"} for part in path.parts):
            continue
        rel = path.relative_to(vault)
        text = path.read_text(encoding="utf-8-sig", errors="replace")
        meta = frontmatter(text)
        links = [m.strip() for m in LINK_RE.findall(text)]
        all_records.append((rel, meta, links))
        names.add(path.stem.casefold())
        title = meta.get("title")
        if title:
            aliases.add(title.casefold())

    records = [
        record
        for record in all_records
        if not project_key
        or project_key in str(record[0]).casefold()
        or project_key == record[1].get("project", "").casefold()
    ]

    missing_metadata = []
    broken_links = []
    isolated = []
    incoming = defaultdict(int)
    decision_groups = defaultdict(list)

    for rel, meta, links in records:
        if rel.parts and rel.parts[0] in MEMORY_ROOTS:
            missing = [key for key in REQUIRED if not meta.get(key)]
            if missing:
                missing_metadata.append({"path": str(rel), "missing": missing})
        for link in links:
            key = Path(link).name.casefold()
            if key not in names and key not in aliases:
                broken_links.append({"path": str(rel), "target": link})
            else:
                incoming[key] += 1
        if meta.get("type") == "architecture-decision" and meta.get("status") == "approved":
            group = (meta.get("project", ""), meta.get("component", ""))
            decision_groups[group].append(str(rel))

    for rel, meta, links in records:
        if rel.parts and rel.parts[0] in MEMORY_ROOTS and not links and incoming[rel.stem.casefold()] == 0:
            isolated.append(str(rel))

    possible_conflicts = [
        {"project": key[0], "component": key[1], "notes": paths}
        for key, paths in decision_groups.items()
        if key[0] and key[1] and len(paths) > 1
    ]
    result = {
        "notes_scanned": len(records),
        "missing_metadata": missing_metadata,
        "broken_links": broken_links,
        "isolated_notes": isolated,
        "possible_decision_conflicts": possible_conflicts,
    }
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(f"Notes scanned: {result['notes_scanned']}")
        for label, items in result.items():
            if label == "notes_scanned":
                continue
            print(f"\n{label.replace('_', ' ').title()} ({len(items)})")
            for item in items:
                print(f"- {item if isinstance(item, str) else json.dumps(item, ensure_ascii=False)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
