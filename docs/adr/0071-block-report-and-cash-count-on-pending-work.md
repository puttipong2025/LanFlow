---
status: accepted
date: 2026-09-28
---

# Block report and cash-count report creation on authoritative pending work

Report creation and Cash Count start previously checked only unfinished Rubber work. Other approval queues could remain pending while a report froze their source rows, and the navigation Badge could not safely act as a write guard because it is viewer-specific and cached.

## Decision

The database is the authority at the moment the user creates a Report or starts Cash Count. Report creation is blocked by unfinished Rubber Bills, pending Income/Expense approvals, pending cash-transfer delete approvals, and pending stock-entry delete approvals for the selected branch. Cash Count start uses the same four categories and additionally blocks when the selected branch is the target of a cash transfer that is still waiting for receipt confirmation.

Each check uses one server cutoff and returns only stable category keys with distinct counts. It never returns record IDs or business details. Time/Payroll, Rubber Evidence review, Stock Product approval, draft Rubber Export, bank Money Transfer, and pending cash receipt in ordinary Report creation are intentionally excluded. The existing on-device Rubber Bill and Income/Expense queue check remains a Cash Count-only client guard.

Report creation, Cash Count start and submit, and insertion of the affected pending approval requests share the same transaction-scoped advisory lock for each branch. Multi-branch requests deduplicate and acquire branch UUIDs in sorted order. The shared private Report-creation seam rechecks current pending approval work immediately before creating any Report, including the Report paired with a Cash Count result. A pending request that commits first therefore blocks that Report; a Report that commits first causes a new update/delete request for its locked source to fail. The request-side guard is centralized on pending inserts to Income/Expense approval, cash-transfer delete, and stock-entry delete tables. Rubber approval creation already holds the same branch lock in its existing workflow.

The database raises `PENDING_WORK_BLOCKED` and puts `{ blockers: [{ key, count }] }` in exception detail. The API accepts only known keys, exact fields, unique entries, and positive safe-integer counts. Valid details become HTTP 409 with Thai labels. Unknown or malformed details fail closed as HTTP 500, are logged only on the server, and are never echoed to the client.

The Reports and Cash Count buttons remain enabled except for their existing offline or in-progress states. A rejected action shows one compact toast listing every blocker category and count. Navigation Badge computation and presentation remain unchanged and are not used as a preflight decision.

## Considered options

- Disabling buttons from Badge counts was rejected because Badge data can be stale, is scoped to the current viewer, and does not close concurrent writes.
- Adding a preflight endpoint was rejected because it would duplicate the authoritative check and introduce a time-of-check/time-of-use gap.
- Rechecking only at the Cash Count session cutoff was rejected because a later approval request can target a source that is already eligible at that cutoff; creating the Report would lock the source while leaving its approval stranded. The submit path therefore rechecks pending approval work at the current server time, while ordinary business rows created after the fixed session cutoff still belong to the next operation.
- Adding Time/Payroll was rejected because pending rows do not yet identify one authoritative payer branch without changing that workflow and schema.
- Rewriting each long request-creation function was rejected in favor of one narrow trigger guard covering every insert path.

## Consequences

- Managers receive actionable blocker categories without row-level disclosure.
- Existing Badge numbers, report contents, and Cash Count calculations do not change. Cash Count navigation now follows the same Admin-or-system-manager permission as its RPC, and a submit blocked by newly pending approval work keeps the active session available for retry.
- New pending-work categories require an explicit database key, TypeScript label, validation test, and ordering decision.
- Concurrency verification must cover both winner orderings so a pending request and a Report cannot both commit for the same source and cutoff.
