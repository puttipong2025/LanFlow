# codingDO vault map

This map resolves local conventions that are more specific than the generic project-memory taxonomy.

## Vault identity

- Vault name for Obsidian CLI: `codingDO`
- Vault root: `C:\Users\Do\Documents\codingDO`
- Repository evidence always outranks vault notes when describing current behavior.

## LanFlow

- Project slug: `lanflow`
- Repository: `C:\Users\Do\Documents\webapp_to_vercel_2\webapp`
- Canonical long-lived hub: `40_Brain/LanFlow_Core_Brain.md`
- Durable atomic notes: `50_Wiki/LanFlow/`
- Daily handoffs, when explicitly needed: `10_Daily/YYYY-MM-DD.md`

The LanFlow hub is intentionally in `40_Brain/`. Do not create `20_Projects/lanflow/` or a second LanFlow hub unless the user explicitly starts a separate, time-bounded delivery project.

## Routing and lifecycle

| Path | Intended content | Status lifecycle |
| --- | --- | --- |
| `00_Inbox/` | Raw, untriaged capture | No project-memory status required |
| `10_Daily/` | Dated log or handoff | Daily-template lifecycle; not canonical project evidence |
| `20_Projects/` | Time-bounded delivery projects | `draft`, `approved`, `resolved`, `superseded`, `archived` |
| `40_Brain/` | Curated architecture hubs and evergreen synthesis | `seed`, `growing`, `evergreen` |
| `50_Wiki/` | Atomic durable references, contracts, bugs, runbooks | `draft`, `approved`, `resolved`, `superseded`, `archived` |

Use `80_Templates/Tech Note Template.md` for human Brain/tech notes only. Use `note-contract.md` for evidence-based project-memory notes.
