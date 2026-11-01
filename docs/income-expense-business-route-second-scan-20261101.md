# Income/Expense business and route scrutiny, second pass — 2026-11-01

Scope: follow the remaining background-command acknowledgement and failed-discard paths after the first scan. Reuse the existing sync-result validator and conditional IndexedDB reconciliation. A new server queue, protocol version or database migration would not solve these client/route boundary gaps more simply.

## Fixed findings

### P1 — Incomplete or contradictory background acknowledgements retire work

`confirmedIncomeExpenseBackgroundOutcome` checked full successful result data only for numbered payloads. Legacy receipts with matching command identity but missing business status/revision passed the route as HTTP 200 and caused the actual background worker to delete its outbox command. Even numbered receipts could combine `outcome: synced` with a validated failure status, or `outcome: pending_approval` with a synced status.

The shared validator now checks successful result data for both legacy and numbered commands, and checks status/outcome consistency. Pending approval requires its valid request receipt. An approved replay deliberately retains the original `status: pending_approval` in the saved server result; that valid `outcome: synced` transition remains accepted. Bound rejected/deleted/revision-conflict outcomes keep their previous contract. No SQL function or stored receipt is changed.

### P1 — Legacy discard deletes a command another tab has just claimed

`discardFailedTransaction` read a failed command with `serverSubmissionAttempted: false`, then removed its queue ID unconditionally. A second tab could change the durable command to pending/attempted between those operations, after which the stale discard still removed the in-flight work.

All failed-discard paths now reconcile the complete exact record atomically before removal. If a sender has claimed or changed it, discard fails and preserves the current command. Ordinary valid discard still completes; the background path still preserves the authoritative server row in the feed.

## Dead code and smaller implementation

- Removed the unused `removeSyncEvents` import after replacing the legacy discard branch.
- Removed the duplicated background-only cleanup branch; both paths share one conditional reconciliation and one refresh.
- Strict TypeScript unused checks and an export-consumer scan of 25 scoped business/hook files found no further unused exports or locals to delete. Shared queue functions used by other modules were retained.

## Experiment ledger

1. Positive controls ran first: complete receipts, real pending-to-approved replay, bound terminal outcomes and ordinary legacy discard passed. This ruled out a general worker/storage failure and ruled out requiring `status: synced` for every completed approval.
2. RED: 10 failures / 5 passing controls across legacy/numbered receipt variants, the actual route, the actual worker/outbox and a deterministic competing-tab discard.
3. Node inspector reached the production background validator with a bound but incomplete receipt and returned `synced`. A breakpoint at legacy removal showed the stale failed snapshot alongside the durable pending/attempted command immediately before deletion.
4. GREEN: focused background/route/history/action suites **63 passed**; full isolated suite **1,277 passed / 2 existing skipped**. Strict unused/type checks, ESLint and source/import guards passed.
5. The existing worker tests had identity-only pseudo receipts and no expected revision in their command fixture. Those happy-path fixtures now model complete real receipts; malformed-result tests remain explicit and fail closed.
6. Local PostgreSQL background command suite: **15 assertions passed**, covering idempotent replay, changed payload/actor rejection, revision conflict and terminal approval history retention. No migration or reset was performed.

## Production verification

Build `vT8FQbGndDibsLg4sVGuT` passed lint/type/offline-assets checks. Service worker and bundle checks passed (298.5/320 kB initial load); the two changed product files match the tested copy by SHA-256. Both Income/Expense PWA journeys, the real HTTP invalid-date route journey, and all **19 Income/Expense offline regression journeys** passed on that build.

Verdict: **ship for Local review** — incomplete background receipts and stale legacy discards now preserve unresolved work, while valid acknowledgement and approval replay continue to finish. No further verified unused code or unresolved finding was identified in this pass.

Local changes only; no Cloud apply, commit, push or deployment.
