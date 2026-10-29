# History retention safety audit — 2026-10-29

Use the existing global setting (1–365 Bangkok calendar days, default 15). Today plus N−1 preceding dates remain visible. Completed display history is disposable; unfinished work and business/replay dependencies survive.

| Data | Result |
| --- | --- |
| Central Rubber queue history and notices | Added to shared preview/worker and immediate expiry filtering. Proposal/policy/display details are cleared in place; command identity and terminal receipt stay for central and legacy replay. |
| Queue approval handoffs | Pending receipts protected. Server-stamped `rubber_command_receipts.resolved_at` records final resolution. Expiry uses the later of completion and resolution; unknown historical resolution times start a fresh window at migration. |
| Rubber/Income-Expense browser outbox | Excluded: `src/lib/idb-queue.ts` contains pending/failed/conflict work, not completed history. |
| Income/Expense background commands | Excluded: permanent minimal receipts prevent recreating approvals (`20261028020000_income_expense_background_commands.sql`). |
| Rubber command contexts/receipts and queue heads | Excluded: identity, fingerprint, generation and version protect old/offline retries. |
| Dashboard money events | Already temporary under ADR-0058/0059; original sources and projection baseline remain. |
| Time/Payroll audits | Already temporary; latest employment-END boundary remains durable business state (ADR-0058). |
| Admin-account audits | Already temporary after terminal result; existing 24-hour pending-to-unknown transition retained. |
| Income/Expense, Rubber, stock entry/product and branch-transfer delete approval history | Already temporary after decision; replay guards preserved. Branch-transfer cutover extends cleanup in `20261009021000_branch_transfer_receipt_cutover.sql`. |
| Scheduler run and cleanup-run history | Already temporary; running work and scheduler definitions protected (ADR-0059). |
| Document-deletion and retention-setting audits | Excluded: permanent accountability evidence (ADR-0058). |
| SMS security audits; browser/session approvals | Excluded: security evidence and live authorization state. SMS challenges/IP budgets already use separate short expiry (`20261025011000`–`20261025013000`); display-history days must not change security behavior. |
| Device-local weighing queues/customer cache | Excluded: per-device work/cache, not central history (`src/lib/rubber-bills/weighing-queue.ts`, ADR-0013). |
| Local receipt snapshots/tombstones | Snapshots already prune by count (default 100); tombstones prevent stale receipt resurrection (`src/lib/rubber-bill-receipts-idb.ts`). |
| Business rows and deleted tombstones; stock/report/cash-count sources; dashboard branch snapshots | Excluded: original or derived current state, unsafe to delete solely by age. |
| Managed Auth, Realtime and platform logs | Outside application-owned deletion scope (ADR-0058). |

## Review and verification

Use existing UI groups, preview, confirmation dialog and progress; no new setting or action. The worker compacts in its existing transaction/settings lock/rollback boundary, bounded per group with `FOR UPDATE SKIP LOCKED`. Retained rows stay `done`; changed retry payloads still fail fingerprint validation. New helpers are private. In-place compaction retains compatibility timestamps and result/error metadata; it is not deletion of command identities or a promise of immediate filesystem shrinkage.

Tests: `supabase/tests/sync_queue_history_retention_test.sql`, existing queue/retention SQL tests, `tests/history-retention-ui.spec.ts`, and database concurrency suites. They cover preview/worker, immediate expiry, unfinished work, final-resolution timing, central/legacy replay, changed-payload rejection, unchanged business state, cutoff and permissions.

Local-only implementation and verification. No Cloud deployment or production cleanup performed. Release must capture a fresh recoverable backup and apply this forward migration before verifying the shared worker. Increasing retention never recovers erased history.

### Verified results and experiment ledger

- Local migration applied transactionally; database function lint reports no public/private errors.
- Full database suite: 65 files / 1,549 assertions passed, followed by the expanded new retention suite: 25 assertions passed (the full run included its initial 18 assertions).
- Queue/command/Income-Expense database concurrency: 5 passed. Isolated central-sync/recovery/local-receipt/background-command tests: 80 passed.
- Browser/API retention tests: 14 passed including authentication setup, desktop/mobile confirmation, permission loss, stale policy, status-only polling and actual scheduled cleanup after closing its initiating context. Reviewed the generated desktop confirmation screenshot.
- TypeScript, ESLint and source-size checks passed. The first build/UI parallel run corrupted shared `.next` output; stopped that run and rebuilt successfully in isolation. Production-artifact checks must run after the final build, before starting another dev server.
- Final isolated production build passed (34 static pages); Service Worker and bundle-budget checks then passed against that build. Vault retention contract and core hub were updated with checksum-verified writes. Vault audit found no new warnings compared with the pre-write audit; existing unrelated metadata/link/source warnings remain outside this change.
- The API test exposed an existing missing branch-transfer group in the old expected count (10). There are now 12 groups: 11 existing plus sync history. Added the missing Thai UI label and updated the fixture/count.
- UI failure traces identified a separate threshold notification modal covering buttons; isolated that unrelated response in the retention UI fixture. All 14 tests passed on rerun; no notification business logic changed.

Scrutinize verdict: ready for a separately reviewed production release. Traced settings → preview → existing locked worker → compaction → central and legacy replay, and shared history/notices → expiry filtering. The simpler in-place receipt avoids a new archive or replay contract; unfinished states and durable business/security/replay sources remain outside cleanup.

### Follow-up Route review — 2026-10-29

- Reproduced unhandled rejected RPC promises across GET overview/status and POST preview/save/cleanup: all five tests failed with a thrown transport exception. Normal returned DB errors and denied authorization were already bounded, isolating the defect to thrown failures.
- Added a minimal exception boundary around each existing handler. Thrown database/auth transport errors now return private, non-cacheable JSON HTTP 503 without internal exception text. No automatic re-execution or new cleanup path was added; existing request identity still governs retry.
- `tests/history-retention-route-failures.spec.ts`: all 7 tests passed, including normal returned conflicts, denied authorization without RPC and thrown auth failures. TypeScript and targeted ESLint passed. Registered these tests in the isolated gate.
- No proven unused import, variable or function was found in the reviewed retention Route, UI integration and new SQL call graph; no speculative deletion was performed. Historical migration definitions are not dead code simply because current runtime paths use their successors.


## Authorized combined Cloud release —2026-10-29

The user subsequently authorized pushing this task together with Rubber sync. Migration20261029020000 applied on linked Cloud before210/220, after a fresh93-table/221703-row consistent backup and clean combined reset/1556 SQL assertions. Current deployment evidence is in `docs/rubber-sync-release.md`. The earlier Local-only verdict describes the original delivery boundary and is superseded for this authorized release. Pending approvals, replay identities and terminal outcomes retain their documented protections.
