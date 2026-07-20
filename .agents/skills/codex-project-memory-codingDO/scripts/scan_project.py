#!/usr/bin/env python3
"""Print a compact, read-only inventory of a web repository and its vault notes."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


MARKERS = {
    "nextjs": ["next.config.js", "next.config.mjs", "next.config.ts", "src/app", "app", "pages"],
    "prisma": ["prisma/schema.prisma"],
    "drizzle": ["drizzle.config.ts", "drizzle.config.js", "src/db/schema.ts"],
    "supabase": ["supabase/config.toml", "supabase/migrations"],
    "sql_migrations": ["migrations", "db/migrations"],
    "tests": ["playwright.config.ts", "vitest.config.ts", "jest.config.js", "jest.config.ts"],
}


def existing(root: Path, candidates: list[str]) -> list[str]:
    return [item for item in candidates if (root / item).exists()]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True, type=Path)
    parser.add_argument("--vault", required=True, type=Path)
    parser.add_argument("--project", default="")
    args = parser.parse_args()

    repo = args.repo.resolve()
    vault = args.vault.resolve()
    if not repo.is_dir() or not vault.is_dir():
        parser.error("--repo and --vault must be existing directories")

    agents = [str(p.relative_to(repo)) for p in repo.rglob("AGENTS.md") if ".git" not in p.parts and "node_modules" not in p.parts]
    package_files = [name for name in ("package.json", "pnpm-lock.yaml", "yarn.lock", "package-lock.json", "bun.lockb") if (repo / name).exists()]

    project_key = args.project.casefold()
    notes = []
    for path in vault.rglob("*.md"):
        if any(part in {".git", ".obsidian"} for part in path.parts):
            continue
        rel = str(path.relative_to(vault))
        if not project_key or project_key in rel.casefold():
            notes.append(rel)

    result = {
        "repo": str(repo),
        "vault": str(vault),
        "project": args.project or None,
        "agents_files": sorted(agents),
        "package_files": package_files,
        "detected": {name: existing(repo, paths) for name, paths in MARKERS.items() if existing(repo, paths)},
        "matching_notes": sorted(notes),
    }
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
