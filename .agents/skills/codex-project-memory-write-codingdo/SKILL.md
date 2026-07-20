---
name: codex-project-memory-write-codingdo
description: "Write and maintain durable codingDO project memory for Codex coding work. Use after verified coding changes or explicit user requests to save, document, bootstrap, create, update, edit, remove, or audit-and-fix Obsidian project notes, AGENTS.md navigation contracts, architecture decisions, API/database contracts, known bugs, runbooks, or lessons learned. ภาษาไทย: ใช้เขียนหรือแก้ memory ใน vault codingDO หลังมีหลักฐานยืนยันแล้ว"
---

# Codex Project Memory Write

Write durable project memory to the `codingDO` Obsidian vault only when the knowledge is verified, reusable, and useful for future coding sessions.

## Coordinate companion skills

Use these skills together when changing vault content:

1. Invoke `$obsidian-cli` once per session for vault discovery, short searches, and backlink checks through the running Obsidian application.
2. Invoke `$obsidian-markdown` before creating or editing note content so frontmatter, wikilinks, embeds, callouts, tags, comments, and properties remain valid.
3. Use `scripts/vault_note.py` for exact note reads and every write. It streams content through standard input, uses atomic replacement, checks for conflicting changes, and verifies the saved bytes and SHA-256.
4. Use `$codex-project-memory-write-codingdo` for write-back policy, note taxonomy, metadata meaning, evidence requirements, and repository-to-memory contracts.

If the user only asks to load context or inspect memory without edits, use `$codex-project-memory-read-codingdo` instead.

## Resolve the vault

- Use the full Vault path supplied by the user when present.
- If no `PATH` is supplied, default to `C:\Users\Do\Documents\codingDO` and state the resolved path before operating.
- Verify that the resolved directory exists. If it does not exist, stop and ask for the correct path.
- Pass the full path to bundled scripts through `--vault`.
- Keep note paths relative to the Vault root. Reject absolute paths and paths that escape the vault.

## Vault note transport

Use a hybrid transport: Obsidian CLI for app-level discovery and graph checks; `vault_note.py` for note bodies and writes. Do not use Obsidian CLI's `read`, `create`, `append`, `prepend`, `property:set`, or `property:remove` commands in this skill. Its `content=` arguments can be truncated on Windows, and a blank command result is not a reliable write receipt.

At the start of a write session, when Obsidian is open, verify the app view once and use it for compact discovery:

```powershell
$obsidian = if (Get-Command obsidian -ErrorAction SilentlyContinue) {
  'obsidian'
} else {
  'C:\Users\Do\AppData\Local\Programs\Obsidian\Obsidian.com'
}
& $obsidian vault="codingDO" vault info=name
& $obsidian vault="codingDO" search query="<project or component>" limit=20
```

Use `& $obsidian vault="codingDO" backlinks path="<vault-relative-path>"` after a linked note is saved when graph verification matters.

### Recover from sandbox denial

Codex's sandbox may omit the executable from `PATH` or deny execution from `AppData`. Treat `Access is denied` as a sandbox policy failure, not proof that Obsidian CLI is missing or that Windows file permissions need repair.

1. Resolve the exact executable as `C:\Users\Do\AppData\Local\Programs\Obsidian\Obsidian.com`, verify it exists, and verify that the Obsidian process is running.
2. Attempt the compact discovery or backlink query once inside the sandbox.
3. If it fails with `Access is denied`, immediately rerun the same read-only app query outside the sandbox with `sandbox_permissions: "require_escalated"`. Use a read-only justification and request a reusable approval prefix scoped to exactly `C:\Users\Do\AppData\Local\Programs\Obsidian\Obsidian.com`; never request a broad PowerShell, `cmd.exe`, or Python prefix.
4. Do not repeat the unchanged sandbox command, edit NTFS permissions, run Obsidian as Administrator, move the executable, or disable the sandbox.

If Obsidian is closed or scoped external execution remains unavailable, use `rg` against the vault for discovery and continue with `vault_note.py`. Do not block a safe, verified filesystem write merely because the optional app-level check is unavailable, and do not treat approval for these read-only CLI queries as approval for vault writes.

Use `<skill-directory>/scripts/vault_note.py` for the authoritative file operation. It edits vault files directly, so the writer does not require Obsidian to be open. The helper accepts Markdown only through UTF-8 standard input, never a command-line argument; writes a temporary file in the note's folder; atomically replaces the target; and prints JSON containing the saved byte count and SHA-256 after rereading the note.

Before updating an existing note, run `stat`, read the note, then send the unchanged `sha256` back as `--expect-sha256`. If the note changed concurrently, stop, reread it, and merge deliberately. Never infer success from blank output: `create`, `write`, and `append` must return a JSON receipt with nonzero `bytes` unless an empty note was explicitly intended.

For the default vault, preserve this layout:

- `00_Inbox/`: unprocessed captures; not durable project memory
- `10_Daily/`: dated work logs and session handoffs; not a project-memory target by default
- `20_Projects/<project>/`: active project hub, current goal, backlog, and session handoff
- `30_Areas/`: ongoing responsibilities such as security, infrastructure, database operations, and engineering standards
- `40_Brain/`: compact canonical maps that route Codex to deeper notes
- `50_Wiki/<project>/`: atomic, long-lived decisions, contracts, bugs, patterns, and runbooks
- `80_Templates/`: human-facing note templates
- `90_System/`: agent instructions, skills, and vault operating rules

Do not create a second PARA tree. Archive by setting `status: archived` and moving material only when the user asks or the vault already defines an archive location.

## codingDO routing and metadata compatibility

Read `references/codingdo-vault-map.md` before creating or changing project memory. It is the local routing contract and takes precedence over the generic layout above.

- For `lanflow`, use `40_Brain/LanFlow_Core_Brain.md` as the canonical hub and `50_Wiki/LanFlow/` for durable atomic project notes. Never create `20_Projects/lanflow/` merely because it is empty.
- Use `20_Projects/` only for a new, time-bounded delivery project that has no existing mapped hub. Use `40_Brain/` for long-lived architecture hubs and `50_Wiki/<topic>/` for atomic references.
- Do not create, append to, or triage `00_Inbox/` or `10_Daily/` automatically. Write there only on an explicit user request.
- Status values are path-aware: `40_Brain/` uses `seed`, `growing`, or `evergreen`; evidence-based project-memory notes use `draft`, `approved`, `resolved`, `superseded`, or `archived`.

## Daily implementation-plan checklist

When the user explicitly asks to maintain a Daily note that contains Phase/task checkboxes, treat that checklist as the progress source of truth:

1. After each verified implementation or verification result, update the matching existing `- [ ]` task to `- [x]` in its Phase; do not rely only on an appended work log.
2. Mark a task complete only when its stated result is implemented and verified. Leave dependent test, schema, documentation, or UI tasks unchecked when they remain incomplete.
3. Add a concise work-log entry with evidence and blockers only after synchronizing the Phase checkboxes.
4. Before handoff or final response, reread the Daily note and confirm that the checked tasks match the reported status.

## Write-back gate

Write to durable memory only when at least one is true:

- an architecture or product decision was made;
- a reusable convention or non-negotiable rule was established;
- an API or database contract changed;
- a difficult bug was reproduced, fixed, and verified;
- deployment, migration, recovery, or operational steps changed;
- a lesson will prevent repeated investigation.

Do not write speculation, transient debugging output, routine edits, unverified fixes, secrets, tokens, customer data, raw production rows, or full chat transcripts.

Set uncertain project-memory notes to `draft`; use `approved` or `resolved` only when evidence supports it. Use `evergreen` only for mature notes in `40_Brain/`.

## Bootstrap memory for a repository

1. Load `$obsidian-cli` and `$obsidian-markdown`; use CLI for discovery and `scripts/vault_note.py` for vault I/O.
2. Inspect the repository before writing notes. Detect Next.js router, package manager, database adapter, schema/migration locations, test stack, deployment config, and existing docs.
3. Read the vault map and search for an existing project hub by its `project` property, title, aliases, configured path, or earlier decisions before creating anything.
4. Reuse and update the resolved hub. Create `20_Projects/<project>/<Project> Hub.md` only when the work is a new time-bounded project and no mapped or discovered hub exists.
5. Create only atomic notes justified by evidence. Start with architecture, non-negotiables, database contract, and testing/deployment runbook when applicable.
6. Link each atomic note from the hub and explain the relationship in a short phrase. Verify the graph with CLI backlinks; fall back to `rg` searches or the read-only audit script when the app is unavailable.
7. Create or update repository `AGENTS.md` using `references/agents-contract.md` only when the navigation contract or mandatory pre-reading changes.
8. Record exact source paths and migration names so future sessions can verify drift.

## Capture durable knowledge

Create one note per decision, contract, bug, pattern, or lesson. Use the metadata and templates in `references/note-contract.md`.

Prefer updating an existing note when its identity is unchanged. For a reversed decision, create or update the successor, set the old note to `superseded`, and link both directions with the reason.

After write-back, update the resolved hub's `Last verified` section, or its existing review field/section when it is a `40_Brain/` hub. Update `AGENTS.md` only if repository navigation, mandatory pre-reading, or coding rules changed.

## Audit and fix memory

Run:

```powershell
python <skill-directory>/scripts/audit_vault.py --vault <vault> [--project <slug>] [--repo <repo>]
```

Fix missing metadata, metadata-quality warnings, broken or ambiguous wikilinks, isolated notes, source-path drift, or conflicting approved decisions only after reading the affected notes and comparing them with repository evidence.

## Source-of-truth boundary

- Use the repository, tests, deployed configuration, and migration history to describe current behavior.
- Use approved decision notes to describe intent and constraints.
- Treat generated artifacts and cached schema output as secondary evidence.
- For databases, inspect migrations before inferring schema. Preserve append-only migration history unless the repository explicitly permits rewriting it.
- For Next.js, distinguish App Router from Pages Router, server-only code from client bundles, and API authorization from UI guards.
- For database writes, capture transaction boundaries, authorization/RLS, idempotency, timezone, destructive behavior, and rollback expectations.

Read `references/nextjs-database-checklist.md` when the task changes routes, server actions, authentication, data models, migrations, or deployment behavior.

## Safe vault writes

Follow `$obsidian-markdown` for note syntax. Use CLI for discovery/backlinks only, then use these helper commands for note content, replacing `<skill-directory>`, `<vault>`, and `<vault-relative-path>`:

```powershell
# Inspect an existing note first. Copy its sha256 for --expect-sha256.
python <skill-directory>/scripts/vault_note.py stat --vault "<vault>" --path "<vault-relative-path>"
python <skill-directory>/scripts/vault_note.py read --vault "<vault>" --path "<vault-relative-path>"

# Start either command in an interactive terminal, then stream the complete UTF-8 Markdown through stdin.
python <skill-directory>/scripts/vault_note.py create --vault "<vault>" --path "<vault-relative-path>" --stdin
python <skill-directory>/scripts/vault_note.py write --vault "<vault>" --path "<vault-relative-path>" --expect-sha256 "<sha256>" --stdin
python <skill-directory>/scripts/vault_note.py append --vault "<vault>" --path "<vault-relative-path>" --expect-sha256 "<sha256>" --stdin
```

Do not put Markdown in `content=` or any other command-line argument. For `write`, always compose the complete replacement from the note just read. For `append`, use only a verified additive update. Inspect the JSON receipt and stop if its `bytes` or `sha256` is unexpected.

Do not reorganize folders, rename many notes, delete notes, or rewrite unrelated notes without explicit authorization.
