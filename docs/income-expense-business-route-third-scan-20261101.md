# Income/Expense business and route scrutiny, third pass — 2026-11-01

Scope: remaining save/cancel/delete paths in `useIncomeExpense`, accepted-submission recovery, and the main/background API boundaries. Reuse the existing exact-record IndexedDB reconciliation and conditional enqueue instead of adding a lock, store or protocol. General numbered acceptance and sale approval/stock rules remain in their existing layers.

## Fixed findings

### P1 — A stale sale action overwrites or removes an in-flight command

The save/delete hook checked `serverSubmissionAttempted` after reading the queue, then changed it in separate unconditional storage calls. A competing tab could claim the command between the read and write. Save replaced the claimed payload and reset its attempted marker; cancelling a sale create removed the claimed command; replacing a sale update with a delete removed an update already being sent.

`src/hooks/useIncomeExpense.ts` now reconciles the complete exact record in one IndexedDB transaction for all three actions. The expected snapshot stays immutable while the replacement is constructed. Replacing a pending update with a delete uses the existing slot atomically, eliminating the enqueue-then-remove gap. If the queue changed, the hook returns a visible retry message and retains the current work.

The initially empty path also uses the existing conditional enqueue: if another tab has inserted work after the read, a stale save/delete cannot append conflicting intent.

## Dead code

Removed the `updateSyncEvent` and `removeSyncEvent` imports and their obsolete unconditional mutation loops from this hook. Shared queue APIs still used by other modules remain. Strict TypeScript unused checks and ESLint found no additional unused locals/imports requiring deletion.

## Experiment ledger

1. The first harness used mutation names not exposed by the hook. All six harness calls failed before entering product code; corrected it to the public `addTransaction`/`deleteTransaction` functions.
2. RED with real fake-indexeddb storage: three competing-tab cases failed, while all three no-concurrency controls passed. The only differential was claiming the stored command immediately after the hook took its snapshot.
3. Node inspector stopped at the actual hook's storage call. The durable command had `serverSubmissionAttempted: true`; the stale snapshot still had `false`. Save wrote `false` over `true`, and cancellation/deletion removed the claimed work. The first inspector loop hit an existing breakpoint on its second iteration; removing each owned breakpoint allowed all three paths to be inspected.
4. Ranked alternatives were a general storage/fixture failure, an incorrect action precondition, and stale storage mutation after a valid precondition. The three positive controls were run separately before the fix and passed; debugger state ruled out the first two and located the third. No Route or network failure is required for reproduction.
5. GREEN: the first three scan suites passed 36 tests. Added empty-snapshot competing-insert and ordinary-insert coverage; the full isolated suite passed **1,287 / 2 existing skipped**, including all ten new cases. Strict type/unused checks, ESLint, source-size and import-direction checks passed.

## Production verification

Build `JbblOC7dqJwGnWzVzz_Bj` passed lint/type/offline-asset generation. Service-worker and bundle checks passed (298.5/320 kB initial load). The changed product hook matches the tested production snapshot by SHA-256 (`BA02704F85EF693AB8F8188730B9DF4A18A04D64191DB17A2B2D1FE71AB96B1B`).

All **19 Income/Expense offline browser journeys** passed on this build (20 Playwright results including authentication setup), covering reconnect, bounded history, pending actions, retry, account/branch isolation and soft deletion.

Verdict: **ship for Local review** — stale sale actions preserve a command another tab has started sending, and the ordinary paths still complete.

This round changes client queue mutation only. No database migration, Cloud apply, commit, push or deployment.
