#!/usr/bin/env python3
"""Read and atomically update Markdown notes in an Obsidian vault.

Use stdin for note content so Windows command-line argument limits cannot truncate it.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def note_path(vault: Path, raw_path: str, parser: argparse.ArgumentParser) -> Path:
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
    return target


def result(operation: str, vault: Path, target: Path, data: bytes) -> None:
    print(
        json.dumps(
            {
                "operation": operation,
                "path": target.relative_to(vault.resolve()).as_posix(),
                "bytes": len(data),
                "sha256": digest(data),
            }
        )
    )


def read_stdin(parser: argparse.ArgumentParser, allow_empty: bool) -> bytes:
    data = sys.stdin.buffer.read()
    try:
        data.decode("utf-8")
    except UnicodeDecodeError:
        parser.error("stdin content must be UTF-8")
    if not data and not allow_empty:
        parser.error("refusing empty content; pass --allow-empty only when intended")
    return data


def atomic_replace(target: Path, data: bytes) -> None:
    if not target.parent.is_dir():
        raise FileNotFoundError(f"parent folder does not exist: {target.parent}")
    fd, temporary_name = tempfile.mkstemp(prefix=".vault-note-", suffix=".tmp", dir=target.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, target)
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise


def verify_expected(current: bytes, expected: str | None, parser: argparse.ArgumentParser) -> None:
    if expected and digest(current) != expected:
        parser.error("note changed since it was read; reread it before writing")


def add_note_arguments(command: argparse.ArgumentParser) -> None:
    command.add_argument("--vault", required=True, type=Path)
    command.add_argument("--path", required=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="operation", required=True)

    stat = commands.add_parser("stat", help="Print existence, size, and SHA-256 as JSON")
    add_note_arguments(stat)

    read = commands.add_parser("read", help="Write exact UTF-8 note content to stdout")
    add_note_arguments(read)

    for name in ("create", "write", "append"):
        command = commands.add_parser(name, help=f"Atomically {name} note content from stdin")
        add_note_arguments(command)
        command.add_argument("--stdin", action="store_true", required=True)
        command.add_argument("--expect-sha256", required=name in {"write", "append"})
        command.add_argument("--allow-empty", action="store_true")

    args = parser.parse_args()
    vault = args.vault.resolve()
    target = note_path(vault, args.path, parser)

    if args.operation == "stat":
        if not target.is_file():
            print(json.dumps({"operation": "stat", "path": target.relative_to(vault).as_posix(), "exists": False}))
            return 0
        data = target.read_bytes()
        print(
            json.dumps(
                {
                    "operation": "stat",
                    "path": target.relative_to(vault).as_posix(),
                    "exists": True,
                    "bytes": len(data),
                    "sha256": digest(data),
                }
            )
        )
        return 0

    if args.operation == "read":
        if not target.is_file():
            parser.error("note does not exist")
        data = target.read_bytes()
        try:
            data.decode("utf-8")
        except UnicodeDecodeError:
            parser.error("note is not UTF-8")
        sys.stdout.buffer.write(data)
        return 0

    exists = target.is_file()
    if args.operation == "create" and exists:
        parser.error("note already exists; use write or append after reading it")
    if args.operation in {"write", "append"} and not exists:
        parser.error("note does not exist; use create")

    current = target.read_bytes() if exists else b""
    verify_expected(current, args.expect_sha256, parser)
    incoming = read_stdin(parser, args.allow_empty)
    desired = incoming
    if args.operation == "append":
        desired = current + (b"" if not current or current.endswith(b"\n") else b"\n") + incoming

    atomic_replace(target, desired)
    saved = target.read_bytes()
    if saved != desired:
        raise RuntimeError("post-write verification failed; inspect the note before retrying")
    result(args.operation, vault, target, saved)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
