# Income/Expense business and route scrutiny, fourth pass — 2026-11-01

Later product decision: [ADR 0098](adr/0098-income-expense-fresh-create-forms.md) removes create-form recovery. The accepted-handoff replay fix remains active; the recovered-form hook and its browser cases below are historical evidence and have been replaced by fresh-form tests.

Scope: accepted-create replay after server handoff and recovery of a partially saved cash form after cancellation in another tab. Main/background routes and their result validators were traced alongside those client paths. Reuse the accepted-submission transaction and existing cancellation marker; no new queue, database store, migration or protocol is needed.

## Fixed findings

### P1 — A numbered retry requeues an already completed handoff

`src/hooks/useIncomeExpense.ts` returned the durable accepted create only when the retry lacked numbering metadata. After a valid synced/pending-approval acknowledgement removed the outbox entry, a retry carrying the accepted numbered object fell through to ordinary enqueue. It could publish changed draft values under an immutable create identity and display work that had already been handed off as pending again.

When an accepted create has no remaining queue entry, the hook now returns the original stored snapshot through `enqueueNumberedIncomeCreate`, regardless of whether the retry includes numbering metadata. The helper rechecks cancellation atomically. The existing rule that a numbered pending row cannot be edited remains: a full numbered request with a live outbox entry still fails the pending guard.

### P1 — A cancelled row prevents a recovered partial form from finishing

`useAcceptedIncomeLines` read a stored `cancelled: true` marker but exposed only the transaction. `IncomeExpenseModal` displayed it as accepted and submitted it again before the unfinished rows. The create hook correctly rejected the cancelled identity, so the remaining rows never reached persistence.

The recovery hook now exposes a scope-bound cancellation lookup alongside the accepted snapshots. The form shows “ยกเลิกแล้ว”, leaves the row read-only and excludes it from submissions. If every remaining form row is cancelled, saving clears the draft and closes the form without creating work. A blank/invalid unfinished row still receives the existing validation error; it is not silently discarded. Accepted dates and number reservations stay unchanged.

## Dead code and scope

No additional unused product function, variable or import was verified in this pass. Strict TypeScript unused checks and ESLint passed. Shared exports and Route handlers remain because they are actual integration entry points. The implementation changes only the existing hook, recovery state and cash-form filtering/status.

## Experiment ledger

1. Deterministic replay RED: **2 failures / 2 passing controls**, using the real accepted-submission store and acknowledgement helper. Synced and pending-approval handoffs failed only when the retried object retained numbering metadata. Unnumbered retries returned the stored snapshot and did not requeue.
2. Node inspector stopped at the production hook's enqueue call with an empty queue and a numbered accepted retry containing changed title/cost. The original accepted marker was present, but that branch still reached enqueue. Separate positive controls for unnumbered retries passed before the fix.
3. Browser RED on the previous production build: accept row one, fail row two with a one-time quota exception, cancel row one from another offline tab, reload and reopen the form. The row remained labelled accepted; saving kept the form open instead of persisting row two. Inspector at the recovery hook's state update showed the actual `cancelled: true` record being reduced to an accepted transaction without its terminal state.
4. Ranked alternatives: cancellation not saved, stale/wrong row identity, all partial-form recovery broken, and the recovered view dropping the cancellation marker. Queue removal plus the debugger's durable marker ruled out the first two. The browser control with no cancellation successfully resumed after reload, ruling out a general recovery failure.
5. Harness corrections: the no-cancellation control initially reloaded before the debounced form copy had committed. The test now polls the stored draft before reload. One branch-selector action was interrupted by a threshold alert; the test now uses the already-selected accessible branch. Two earlier multi-case runs also timed out during context cleanup; the harness now closes its own pages explicitly. These were not counted as product regressions or fixed by changing product rules.
6. GREEN: focused numbering/action/replay/race suites **42 passed**; full isolated suite **1,291 passed / 2 existing skipped**. Strict type/unused checks, ESLint, source-size and import-direction checks passed. The cash-form change stays within its existing size baseline.

## Production verification

Build `eeeECtNJwMEzCDXaxgkgS` passed lint/type/offline-asset generation, service-worker and bundle checks (298.5/320 kB initial load). All three changed product files match the tested snapshot by SHA-256.

The real browser suite passed **7 results including authentication setup**: three recovered-form journeys (ordinary accepted retry, partial cancellation, all rows cancelled), two existing Income/Expense PWA journeys and the real HTTP Route calendar-validation journey. The cancellation journeys use two actual offline tabs and inspect the final outbox/accepted markers after save. The remaining row alone is queued; the cancelled row stays cancelled. Mobile screenshots at 375 px retain the full reference and status.

Verdict: **ship for Local review** — completed handoffs stay out of the outbox, and terminal cancelled rows no longer prevent unfinished form rows from being saved.

Local changes only; no Cloud apply, commit, push or deployment in this scan.
