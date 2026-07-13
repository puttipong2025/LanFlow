# Project memory note contract

## Canonical metadata

Use YAML lists instead of comma-separated strings.

This contract applies to evidence-based notes in `20_Projects/` and `50_Wiki/`. It does not replace the `seed`/`growing`/`evergreen` lifecycle used by human Brain notes in `40_Brain/`; see `codingdo-vault-map.md`.

```yaml
---
title: JWT Authentication Design
type: architecture-decision
status: approved
project: example-app
component: auth
stack:
  - nextjs
  - postgresql
created: 2026-07-12
updated: 2026-07-12
tags:
  - project/example-app
  - architecture
related:
  - "[[OAuth Flow]]"
  - "[[Session Management]]"
source_paths:
  - src/lib/auth.ts
  - prisma/schema.prisma
---
```

Allowed `type` values:

- `project-hub`
- `architecture-decision`
- `coding-convention`
- `api-contract`
- `database-contract`
- `known-bug`
- `runbook`
- `lesson-learned`

Use `draft`, `approved`, `resolved`, `superseded`, or `archived` for project-memory `status`.

For a project-memory note, `title`, `type`, `status`, `tags`, `created`, and `updated` are the minimum metadata. Add `project` and `component` for project-specific notes, and add `source_paths` whenever a note states a repository contract or verified behavior.

Use a stable lowercase `project` slug. Use a domain or subsystem for `component`, such as `auth`, `billing`, `database`, or `deployment`.

## Project hub

```markdown
# <Project> Hub

> [!abstract] Purpose
> One paragraph describing the product, users, and current delivery goal.

## Session start

Read these notes before changing the project:

- [[<Project> Architecture]] — explains boundaries and data flow.
- [[<Project> Non-Negotiables]] — lists rules that must survive refactors.
- [[<Project> Database Contract]] — defines schema ownership and migration rules.

## Stack and source map

- Runtime:
- Next.js router:
- Database and adapter:
- Schema/migrations:
- Tests:
- Deployment:

## Current state

- Active goal:
- Known risks:
- Open decisions:

## Last verified

- Date: YYYY-MM-DD
- Commit or branch:
- Verified paths:
```

## Architecture decision

```markdown
# <Decision title>

## Context

What forced a choice?

## Decision

What was chosen?

## Consequences

- Benefit:
- Cost or constraint:

## Evidence

- Source paths, tests, issue, or migration:

## Relationships

- [[Related Note]] — related because ...
```

## Known bug

Include symptoms, reproduction, root cause, fix, regression test, affected versions or migrations, and prevention. Set `status: resolved` only after verification.

## Database contract

Include ownership, authoritative schema path, key entities and relations, invariants, RLS/authorization, transaction boundaries, idempotency, timezone, migration policy, rollback/forward-fix policy, and test evidence.

## Linking rule

Never add a bare link to a relationship section. Add a short explanation after an em dash so the next agent understands why the notes are connected.
