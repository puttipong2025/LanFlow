# ADR-0019: Rubber Export Uses Explicit Bill Selection

Status: Accepted

## Context

Rubber Export originally accepted one cutoff report item and implicitly reserved every eligible bill at or before that item's `eligibility_at`. The product owner instead needs to choose the exact bills included in each new export while preserving the existing report ownership, reservation, snapshot, verification, deletion, expense, and print rules.

The module has not entered production use. Local test data may be reset, so backward compatibility with cutoff-based exports is unnecessary.

## Decision

The create modal starts with no bills selected and offers per-bill checkboxes plus a select-all action. It lists only active, unreserved rubber bills held by active Report Batch items in the selected branch.

Preview and create receive the same explicit set of report-item IDs. The create RPC revalidates the entire set under the existing branch advisory lock and either snapshots and reserves every selected bill or rolls back the whole transaction. Item membership is immutable after draft creation; correcting membership requires deleting the draft and creating a new one.

`rubber_export_items` remains the canonical membership and snapshot table. `rubber_exports` no longer stores cutoff fields.

## Consequences

- Users control exact export membership without hidden time-based inclusion.
- Existing one-active-export-per-bill and Report Batch deletion locks remain unchanged.
- Empty, duplicate, stale, cross-branch, inactive, or reserved selections are rejected.
- The local database must be reset because the original migration and RPC signatures change in place.
- Rubber Export history from the test database is intentionally discarded; customer and transport master data are backed up and restored separately.

## Relationships

- ADR-0010 remains authoritative for source-owned expense and relation ownership.
- `docs/rubber-export-module-plan.md` defines the implementation and verification matrix.

## Verification

Verified on 2026-07-28 by full local migration replay, exact master-data restore comparison, TypeScript and production builds, explicit-selection/concurrency/print tests, and Reports, Income/Expense feed, and Rubber Bill print regressions.
