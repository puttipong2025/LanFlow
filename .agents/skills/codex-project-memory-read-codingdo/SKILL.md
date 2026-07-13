---
name: codex-project-memory-read-codingdo
description: "Read-only codingDO project memory loader for Codex coding sessions. Use when starting or resuming work, onboarding a repository, checking existing project context, reading architecture/API/database contracts, finding known bugs/runbooks, auditing note consistency without edits, or comparing Obsidian memory against repository evidence. ภาษาไทย: ใช้อ่าน context จาก vault codingDO เท่านั้น ห้ามเขียนหรือแก้โน้ต"
---

# Codex Project Memory Read

Load only the task-relevant project memory from the `codingDO` Obsidian vault before coding. This skill is read-only: never create, append, overwrite, rename, move, delete, or update vault notes or repository docs.

## Coordinate companion skills

Use these skills together when reading vault context:

1. Invoke `$obsidian-cli` for vault discovery, search, reads, backlinks, properties, tasks, and read-only verification through the running Obsidian application.
2. Invoke `$obsidian-markdown` when interpreting Obsidian Markdown syntax, frontmatter, wikilinks, embeds, callouts, tags, comments, or properties.
3. Use `$codex-project-memory-read-codingdo` for memory-selection rules, evidence boundaries, and read-only session flow.

If the user asks to save, update, bootstrap, capture, create, remove, or edit memory, stop and use `$codex-project-memory-write-codingdo` instead.

## Resolve the vault

- Use the full Vault path supplied by the user when present.
- If no `PATH` is supplied, default to `C:\Users\Do\Documents\codingDO` and state the resolved path before operating.
- Verify that the resolved directory exists. If it does not exist, ask for the correct path.
- Pass the full path to bundled scripts through `--vault`.
- For Obsidian CLI commands, target `vault="codingDO"` and keep note paths relative to the Vault root.

For the default vault, expect this layout:

- `00_Inbox/`: unprocessed captures; not durable project memory
- `10_Daily/`: dated work logs and session handoffs; not a project-memory source by default
- `20_Projects/<project>/`: active project hub, current goal, backlog, and session handoff
- `30_Areas/`: ongoing responsibilities and engineering standards
- `40_Brain/`: compact canonical maps that route Codex to deeper notes
- `50_Wiki/<project>/`: durable decisions, contracts, bugs, patterns, and runbooks
- `80_Templates/`: human-facing note templates
- `90_System/`: agent instructions, skills, and vault operating rules

## codingDO routing and metadata compatibility

Read `references/codingdo-vault-map.md` before selecting a project hub or interpreting note status. It is the local routing contract and takes precedence over the generic layout above.

- For `lanflow`, the canonical hub is `40_Brain/LanFlow_Core_Brain.md`; its durable atomic notes live in `50_Wiki/LanFlow/`. Do not assume an empty `20_Projects/` means the project lacks memory.
- Treat `20_Projects/` as outcome-oriented, time-bounded delivery work. A long-lived architecture hub may live in `40_Brain/`.
- Read `10_Daily/` only when the task needs a recent handoff, work-log evidence, or a note explicitly linked from the project hub. Do not treat Daily notes as canonical architecture or contract evidence.
- Ignore `00_Inbox/` unless the user explicitly asks to inspect untriaged captures.
- Status values are path-aware: `40_Brain/` uses `seed`, `growing`, or `evergreen`; evidence-based project-memory notes use `draft`, `approved`, `resolved`, `superseded`, or `archived`.

## Read workflow

1. Locate the repository root and nearest applicable `AGENTS.md` files.
2. Run `<skill-directory>/scripts/scan_project.py --repo <repo> --vault <vault> [--project <slug>]` for a compact inventory; do not rely on the current working directory.
3. Read the vault map, then use `obsidian search`, `obsidian read`, and `obsidian backlinks` to resolve an existing hub by its `project` property, title, aliases, and configured path. Read only what the task needs.
4. Prefer this order:
   - applicable `AGENTS.md` instructions;
   - `package.json`, framework config, and environment examples without reading secret values;
   - project hub or core brain note;
   - approved notes matching the affected component;
   - current API/database contracts, known bugs, and relevant runbooks;
   - current source, tests, schema, and migrations.
5. State any material mismatch between notes and code. Never silently choose one.
6. Summarize the loaded context and cite exact vault-relative note paths or repository paths. State when a Daily note is only a handoff rather than a source of truth.

Read narrowly. Do not load the whole vault when a hub and two or three atomic notes answer the task.

## Read-only audit

Use this command to inspect note health without editing:

```powershell
python <skill-directory>/scripts/audit_vault.py --vault <vault> [--project <slug>] [--repo <repo>]
```

Review missing required metadata, metadata-quality warnings, broken or ambiguous wikilinks, isolated notes, source-path drift (when `--repo` is supplied), and multiple approved decisions for the same project/component. Semantic contradictions still require reading the flagged notes and comparing them with repository evidence.

## Evidence boundary

- Use the repository, tests, deployed configuration, and migration history to describe current behavior.
- Use approved decision notes to describe intent and constraints.
- Treat generated artifacts and cached schema output as secondary evidence.
- Never copy secrets, tokens, customer data, raw production rows, or full chat transcripts into memory summaries.
- For databases, inspect migrations before inferring schema.
- For Next.js, distinguish App Router from Pages Router, server-only code from client bundles, and API authorization from UI guards.

Read `references/nextjs-database-checklist.md` when the task touches routes, server actions, authentication, data models, migrations, or deployment behavior.

## Safe Obsidian commands

Prefer read-only CLI commands when Obsidian is open:

```powershell
obsidian vault="codingDO" search query="<project or component>" limit=20
obsidian vault="codingDO" read path="<vault-relative-path>"
obsidian vault="codingDO" backlinks path="<vault-relative-path>"
obsidian vault="codingDO" properties path="<vault-relative-path>"
obsidian vault="codingDO" tasks path="<vault-relative-path>"
```

Do not use `create`, `append`, `prepend`, `delete`, `move`, `rename`, `property:set`, `property:remove`, `daily:append`, or other write commands from this skill.
