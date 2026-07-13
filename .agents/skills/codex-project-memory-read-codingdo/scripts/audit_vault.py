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
RECOMMENDED = ("tags", "created", "updated")
DURABLE_STATUSES = {"draft", "approved", "resolved", "superseded", "archived"}
BRAIN_STATUSES = {"seed", "growing", "evergreen"}
CONTRACT_TYPES = {"api-contract", "database-contract", "runbook", "known-bug"}


def clean_value(value: str) -> str:
    return value.strip().strip(' "\'')


def values(meta: dict[str, object], key: str) -> list[str]:
    value = meta.get(key, "")
    if isinstance(value, list):
        return [item for item in value if isinstance(item, str) and item]
    return [value] if isinstance(value, str) and value else []


def value(meta: dict[str, object], key: str) -> str:
    items = values(meta, key)
    return items[0] if items else ""


def frontmatter(text: str) -> dict[str, object]:
    if not text.startswith("---"):
        return {}
    lines = text.splitlines()
    try:
        end = lines.index("---", 1)
    except ValueError:
        return {}
    data: dict[str, object] = {}
    active_list = ""
    for line in lines[1:end]:
        match = SCALAR_RE.match(line)
        if match:
            key, raw_value = match.groups()
            cleaned = clean_value(raw_value)
            if cleaned:
                data[key] = cleaned
                active_list = ""
            else:
                data[key] = []
                active_list = key
        elif active_list and line.startswith(("  - ", "- ")):
            item = clean_value(line.split("- ", 1)[1])
            if item:
                data[active_list].append(item)
        elif line.strip():
            active_list = ""
    return data


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vault", required=True, type=Path)
    parser.add_argument("--project", default="")
    parser.add_argument("--repo", type=Path)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    vault = args.vault.resolve()
    if not vault.is_dir():
        parser.error("--vault must be an existing directory")
    repo = args.repo.resolve() if args.repo else None
    if repo and not repo.is_dir():
        parser.error("--repo must be an existing directory")

    all_records = []
    identifiers: dict[str, set[Path]] = defaultdict(set)
    project_key = args.project.casefold()
    for path in vault.rglob("*.md"):
        if any(part in {".git", ".obsidian"} for part in path.parts):
            continue
        rel = path.relative_to(vault)
        text = path.read_text(encoding="utf-8-sig", errors="replace")
        meta = frontmatter(text)
        links = [m.strip() for m in LINK_RE.findall(text)]
        all_records.append((rel, meta, links))
        identifiers[path.stem.casefold()].add(rel)
        for identifier in [value(meta, "title"), *values(meta, "aliases")]:
            if identifier:
                identifiers[identifier.casefold()].add(rel)

    records = [
        record
        for record in all_records
        if not project_key
        or project_key in str(record[0]).casefold()
        or project_key == value(record[1], "project").casefold()
    ]

    missing_metadata = []
    metadata_warnings = []
    broken_links = []
    ambiguous_links = []
    source_path_issues = []
    isolated = []
    incoming: dict[Path, int] = defaultdict(int)
    decision_groups = defaultdict(list)

    for rel, meta, links in records:
        if rel.parts and rel.parts[0] in MEMORY_ROOTS:
            missing = [key for key in REQUIRED if not value(meta, key)]
            if missing:
                missing_metadata.append({"path": str(rel), "missing": missing})
            warnings = [key for key in RECOMMENDED if not values(meta, key)]
            if value(meta, "project") and not value(meta, "component"):
                warnings.append("component")
            if warnings:
                metadata_warnings.append({"path": str(rel), "missing": warnings})
            status = value(meta, "status")
            expected_statuses = (
                BRAIN_STATUSES if rel.parts[0] == "40_Brain" else DURABLE_STATUSES
                if rel.parts[0] in {"20_Projects", "50_Wiki"} else set()
            )
            if expected_statuses and status and status not in expected_statuses:
                metadata_warnings.append({"path": str(rel), "unexpected_status": status, "allowed": sorted(expected_statuses)})
            if value(meta, "type") in CONTRACT_TYPES and not values(meta, "source_paths"):
                metadata_warnings.append({"path": str(rel), "missing": ["source_paths"]})
            if repo:
                for source_path in values(meta, "source_paths"):
                    if not (repo / source_path).exists():
                        source_path_issues.append({"path": str(rel), "source_path": source_path})
        for link in links:
            key = Path(link).stem.casefold()
            targets = identifiers.get(key, set())
            if not targets:
                broken_links.append({"path": str(rel), "target": link})
            else:
                if len(targets) > 1:
                    ambiguous_links.append({"path": str(rel), "target": link, "candidates": sorted(map(str, targets))})
                for target in targets:
                    incoming[target] += 1
        if value(meta, "type") == "architecture-decision" and value(meta, "status") == "approved":
            group = (value(meta, "project"), value(meta, "component"))
            decision_groups[group].append(str(rel))

    for rel, meta, links in records:
        if rel.parts and rel.parts[0] in MEMORY_ROOTS and not links and incoming[rel] == 0:
            isolated.append(str(rel))

    possible_conflicts = [
        {"project": key[0], "component": key[1], "notes": paths}
        for key, paths in decision_groups.items()
        if key[0] and key[1] and len(paths) > 1
    ]
    result = {
        "notes_scanned": len(records),
        "missing_metadata": missing_metadata,
        "metadata_warnings": metadata_warnings,
        "broken_links": broken_links,
        "ambiguous_links": ambiguous_links,
        "source_path_issues": source_path_issues,
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
