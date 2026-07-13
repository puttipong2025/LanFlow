---
name: codex-project-memory-write-codingdo
description: "Write and maintain durable codingDO project memory for Codex coding work. Use after verified coding changes or explicit user requests to save, document, bootstrap, create, update, edit, remove, or audit-and-fix Obsidian project notes, AGENTS.md navigation contracts, architecture decisions, API/database contracts, known bugs, runbooks, or lessons learned. ภาษาไทย: ใช้เขียนหรือแก้ memory ใน vault codingDO หลังมีหลักฐานยืนยันแล้ว"
---

# Codex Project Memory Write

Write durable project memory to the `codingDO` Obsidian vault only when the knowledge is verified, reusable, and useful for future coding sessions.

## Coordinate companion skills

Use these skills together when changing vault content:

1. Invoke `$obsidian-cli` for search, reads, backlinks, property operations, note creation, app-level verification, and safe vault writes through Obsidian.
2. Invoke `$obsidian-markdown` before creating or editing note content so frontmatter, wikilinks, embeds, callouts, tags, comments, and properties remain valid.
3. Use `$codex-project-memory-write-codingdo` for write-back policy, note taxonomy, metadata meaning, evidence requirements, and repository-to-memory contracts.

If the user only asks to load context or inspect memory without edits, use `$codex-project-memory-read-codingdo` instead.

## Resolve the vault

- Use the full Vault path supplied by the user when present.
- If no `PATH` is supplied, default to `C:\Users\Do\Documents\codingDO` and state the resolved path before operating.
- Verify that the resolved directory exists. If it does not exist, stop and ask for the correct path.
- Pass the full path to bundled scripts through `--vault`.
- For Obsidian CLI commands, target `vault="codingDO"` and keep note paths relative to the Vault root.

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

1. Load `$obsidian-cli` and `$obsidian-markdown`.
2. Inspect the repository before writing notes. Detect Next.js router, package manager, database adapter, schema/migration locations, test stack, deployment config, and existing docs.
3. Read the vault map and search for an existing project hub by its `project` property, title, aliases, configured path, or earlier decisions before creating anything.
4. Reuse and update the resolved hub. Create `20_Projects/<project>/<Project> Hub.md` only when the work is a new time-bounded project and no mapped or discovered hub exists.
5. Create only atomic notes justified by evidence. Start with architecture, non-negotiables, database contract, and testing/deployment runbook when applicable.
6. Link each atomic note from the hub and explain the relationship in a short phrase. Use backlinks to verify the graph.
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

## Safe Obsidian writes

Follow `$obsidian-cli` for command syntax and `$obsidian-markdown` for note syntax. Prefer CLI writes when Obsidian is open:

```powershell
obsidian vault="codingDO" search query="<project or component>" limit=20
obsidian vault="codingDO" read path="<vault-relative-path>"
obsidian vault="codingDO" create path="<vault-relative-path>" content="<markdown>"
obsidian vault="codingDO" append path="<vault-relative-path>" content="<markdown>"
obsidian vault="codingDO" property:set path="<vault-relative-path>" name="status" value="approved"
obsidian vault="codingDO" backlinks path="<vault-relative-path>"
```

Do not reorganize folders, rename many notes, delete notes, or rewrite unrelated notes without explicit authorization.
