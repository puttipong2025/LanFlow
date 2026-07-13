# Repository AGENTS.md contract

Keep `AGENTS.md` short enough to read at every session. Point to durable notes instead of duplicating them.

```markdown
# AGENTS.md

## Project

<One paragraph: product, users, and current architecture.>

## Required context

Before changing code, read:

- `<absolute-or-repo-relative-vault-path-to-project-hub>`
- `<architecture-note>` when changing boundaries or data flow
- `<database-contract>` before schema, migration, query, or authorization work

## Source map

- Next.js app: `<path>`
- Server/API boundary: `<path>`
- Database schema: `<path>`
- Migrations: `<path>`
- Tests: `<path>`

## Repository rules

- <Only non-negotiable, testable rules.>
- Never expose server secrets to client code.
- Verify authorization at the server/database boundary.
- Add migrations according to the repository's migration policy.

## Verification

- Run: `<lint/typecheck/test commands>`
- For database changes, also run: `<migration/schema checks>`

## Memory write-back

After a verified decision, contract change, difficult bug fix, or runbook change, update `<project hub>` and the relevant atomic note. Do not store secrets, raw customer data, transient logs, or unverified claims.
```

Place narrower `AGENTS.md` files in subdirectories only when their rules genuinely differ. The nearest file should add local constraints without contradicting its ancestors.
