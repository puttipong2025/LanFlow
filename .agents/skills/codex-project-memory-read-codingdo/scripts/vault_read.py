#!/usr/bin/env python3
"""Read Markdown notes from an Obsidian vault without changing any files."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def resolve_note(vault: Path, raw_path: str, parser: argparse.ArgumentParser) -> tuple[Path, Path]:
    root = vault.resolve()
    if not root.is_dir():
        parser.error("--vault must be an existing directory")
    relative = Path(raw_path)
    if relative.is_absolute():
        parser.error("--path must be relative to --vault")
    target = (root / relative).resolve()
    try:
        target.relative_to(root)
    except ValueError:
        parser.error("--path must stay inside --vault")
    if target.suffix.lower() != ".md":
        parser.error("--path must name a Markdown (.md) note")
    return root, target


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="operation", required=True)
    for name, help_text in (
        ("stat", "Print existence, size, and SHA-256 as JSON"),
        ("read", "Write exact UTF-8 note content to stdout"),
    ):
        command = commands.add_parser(name, help=help_text)
        command.add_argument("--vault", required=True, type=Path)
        command.add_argument("--path", required=True)

    args = parser.parse_args()
    vault, target = resolve_note(args.vault, args.path, parser)
    relative = target.relative_to(vault).as_posix()

    if args.operation == "stat":
        if not target.is_file():
            print(json.dumps({"operation": "stat", "path": relative, "exists": False}))
            return 0
        data = target.read_bytes()
        print(json.dumps({"operation": "stat", "path": relative, "exists": True, "bytes": len(data), "sha256": digest(data)}))
        return 0

    if not target.is_file():
        parser.error("note does not exist")
    data = target.read_bytes()
    try:
        data.decode("utf-8")
    except UnicodeDecodeError:
        parser.error("note is not UTF-8")
    sys.stdout.buffer.write(data)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
