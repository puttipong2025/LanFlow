---
name: codex-project-memory-codingdo
description: Compatibility router for codingDO project memory. Use when the user explicitly invokes the old combined skill name, asks whether to read or write project memory, or requests both loading context and saving durable Obsidian notes. Route read-only work to $codex-project-memory-read-codingdo and write/update work to $codex-project-memory-write-codingdo.
---

# Codex Project Memory Router

This is the compatibility entry point for the older combined `codingDO` project-memory skill. Do not perform the full workflow here. Choose the narrower skill first, then follow that skill's instructions.

## Route by intent

Use `$codex-project-memory-read-codingdo` when the user asks to:

- start or resume coding with existing project context;
- inspect the vault, project hub, known bugs, runbooks, architecture, API contracts, or database contracts;
- compare notes with repository evidence;
- audit memory without changing files;
- answer “what context do we have?” or “what should I know before coding?”

Use `$codex-project-memory-write-codingdo` when the user asks to:

- save, document, capture, or write memory after coding;
- bootstrap project memory for a repository;
- create or update a project hub, decision note, contract note, bug note, runbook, or lesson learned;
- update repository `AGENTS.md`;
- fix audit findings in Obsidian notes;
- edit, remove, archive, or supersede memory.

If one request needs both, read first with `$codex-project-memory-read-codingdo`, implement or verify the work, then write only the durable result with `$codex-project-memory-write-codingdo`.

## Default vault

Both split skills use the same default vault behavior:

- Use a user-supplied full Vault `PATH` when present.
- If no `PATH` is supplied, use `C:\Users\Do\Documents\codingDO`.
- For Obsidian CLI, target `vault="codingDO"` and use vault-relative note paths.

## Thai summary

สกิลนี้เป็นตัวกลางสำหรับชื่อเดิมเท่านั้น:

- อ่าน context ใช้ `$codex-project-memory-read-codingdo`
- เขียนหรือแก้ memory ใช้ `$codex-project-memory-write-codingdo`

เมื่อไม่แน่ใจ ให้เริ่มจากอ่านก่อน แล้วค่อยเขียนเฉพาะข้อมูลที่ผ่านหลักฐานและมีประโยชน์ต่อ session ถัดไป.
