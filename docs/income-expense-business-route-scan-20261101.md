# Income/Expense business and route scrutiny — 2026-11-01

Scope: the recent Income/Expense numbering, local cancellation, sync, history and operational-list changes, with main/background/approval/feed/detail routes and their unchanged business/auth boundaries. The simpler repair is to reuse the existing response validator and conditional outbox operations. Moving to Rubber's central server queue is a separate product change and is not part of this scan.

## Findings fixed

1. **Legacy queue loss on unconfirmed success responses.** Main sync and manual retry removed legacy commands after HTTP 200 without fully validating the business receipt. Empty objects, wrong revisions and failed status inside HTTP 200 all reproduced queue loss. Both paths now validate the existing receipt contract and require a successful business status before acknowledging; valid legacy and numbered controls continue to finish.
2. **Cross-tab resurrection and stale acknowledgement.** Queue normalization wrote its old keeper after cancellation, manual retry recreated a discarded snapshot, and a late legacy acknowledgement removed a newer command from the same slot. Normalization now reconciles the complete record atomically; manual retry claims the exact snapshot; legacy acknowledgement/error updates use conditional queue operations. No counter, reservation or cancelled identity is reset.
3. **Invalid dates reported as service failures.** `isCanonicalDate` called `toISOString` on an invalid Date, causing RangeError and HTTP 503 for malformed months/days. It also accepted year zero, which PostgreSQL cannot represent. The validator now rejects invalid time values and year zero before conversion, so main/background/approval input validation returns HTTP 400 before any RPC. Leap-day and valid-date controls remain accepted.
4. **Raw cancellation storage errors in the UI.** A synchronous quota failure during the cancelled-marker write escaped as the browser's technical message. The whole transaction now aborts and returns the existing Thai recovery message, keeping both queued command and acceptance unchanged.

## Dead-code result

- Removed the now-unused `updateSyncEvent` import from `usePerRecordSyncRetry.ts` after sharing the conditional claim path.
- Removed the duplicate receipt validation at final retry cleanup, since that branch is reached only after the checked acknowledgement.
- TypeScript strict unused-locals/parameters checks pass. An export-consumer scan across 25 scoped business/hook files found no additional unreferenced exports. No unrelated function or public route was removed.

## Repro and debugger ledger

- Initial permanent regression run: 12 failures / 2 valid-receipt controls passed. Calendar, invalid receipt and exact cancellation/manual-retry races fail deterministically against the original code.
- Node inspector reached the actual date validator: valid `2024-02-29` returns true; invalid month throws RangeError. A breakpoint on retry removal showed an empty response object immediately before queue deletion.
- Valid-receipt controls were rerun separately before repair and both passed, ruling out a general IndexedDB/query-client failure.
- Additional RED controls reproduced year-zero acceptance in all three routes, raw quota messaging, and an old acknowledgement deleting newer intent.
- Final focused route/queue/history/action cases: **60 passed**. Full isolated suite: **1,262 passed / 2 existing skipped**. Strict unused checks, ESLint, source-size/import checks passed.
- Two old fixtures required adaptation: the cash-lock success fixture omitted `operation`/`expectedRevisionNo`; the manual-retry fixture did not supply the conditional queue method. Source-contract assertions now require that method. Product validation was not loosened.
- The first final production build compiled but its native Windows type-check worker exited with `3221225477` without a TypeScript error. Independent strict TypeScript checks passed. The same source then passed a serial recovery build; no source/config weakening, cache deletion or service reset was used.

## Source and test map

- `src/lib/income-expense/feed-cursor.ts`: non-throwing calendar validation.
- `src/hooks/useIncomeExpense.ts`: full receipt validation, atomic normalization, conditional legacy cleanup.
- `src/hooks/usePerRecordSyncRetry.ts`: shared conditional claim, validated legacy acknowledgement.
- `src/lib/income-expense/cancel-local-create.ts`: cancellation rollback/error boundary.
- `tests/income-expense-scan.spec.ts`: real production modules/IndexedDB/QueryClient with controlled HTTP boundaries, calendar route controls and deterministic cross-tab races.
- `tests/income-expense-actions.spec.ts`: cancellation quota rollback and readable recovery message.
- `tests/income-expense-scan-browser.spec.ts`: authenticated real HTTP validation of invalid calendar values in main/background/approval routes.

## Final production evidence

Build `JUz1xi1xj0Et2urd1krMt` passed, including type/lint/offline assets/service-worker/bundle checks (298.6/320 kB initial load). Four affected core source hashes match the tested copy. Both existing PWA journeys and the new authenticated real-HTTP route journey passed; the latter verifies all 12 invalid-date submissions across main/background/approval endpoints return 400. All **19 Income/Expense offline regression journeys** passed on that same build, including failed-event retry, stale revision conflicts, account/branch isolation, no-op cancellation, controlled sending gates and soft deletion.

Verdict: **ship for Local review** — confirmed queue-loss/race and validation failures are fixed and regression-tested. No further verified dead code or unresolved finding was identified in this scan. Canonical Module, Feed and Core Brain notes were updated using atomic SHA-checked writes; before/after audit of 103 notes introduced no new issue.

Local changes only. No SQL migration, Cloud apply, commit, push or deployment is part of this scan.

The [second scan](income-expense-business-route-second-scan-20261101.md) extends this review to background receipt status/outcome consistency and a legacy discard race; its findings and regression evidence are recorded separately.
