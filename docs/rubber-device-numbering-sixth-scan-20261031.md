# Rubber business/Route scan six — 2026-10-31

Intent: trace cancellation, confirmed sync results, legacy delete recovery, receipt storage and the related Route authorization boundaries from the current source.

## Simpler alternative

Reuse `completeRubberCommand`, the existing atomic queue/receipt/tombstone transaction. Confirmed deletion needs no new cleanup mechanism, persistence format, Route, RPC or schema change. Keep pending approval on the existing non-deletion path.

## Finding: confirmed legacy delete recovery leaves an offline receipt behind

- **Impact:** retrying a failed legacy delete can remove its queue command after confirmed server deletion while retaining the old receipt snapshot. `src/hooks/useRubberBillList.ts:136` reads stored snapshots into the offline list; a stale cache write can also restore the same snapshot when no tombstone was committed.
- **Reachable entry:** legacy failed delete → `src/lib/rubber-bills/local-feed.ts:94` exposes `canRestartDelete` → `src/components/rubber-bills/RubberBillsTable.tsx:219` → `src/components/rubber-bills/RubberBillsModule.tsx:688` → `restartRubberDelete`. The regression explicitly verifies that its persisted legacy event qualifies for this action.
- **Cause:** the replay success path removed the queue through `reconcileSyncEventsIfCurrent` alone. The new-command success path did the same for a non-background legacy command. Both bypassed the receipt/tombstone transaction despite receiving a verified `status="synced"` deletion result.
- **Minimal fix:** `src/lib/rubber-bills/restart-delete.ts:32` and `:51` route confirmed deletion through `completeRubberCommand(event, true)` / its new-command equivalent. The existing helper checks the current event, removes its receipt and commits a tombstone with queue removal. Pending approval retains the existing behavior; no server delete or number allocation logic changes.
- **Regression:** `tests/rubber-background.spec.ts:142` runs the production recovery path, real queue/receipt IndexedDB operations and result validator with transport/context responses controlled. It covers replay confirmation, discarded old command followed by newly confirmed deletion, and pending approval. Both deletion cases now remove the receipt and reject a later stale snapshot write. Pending approval keeps the snapshot.

## Debugger, hypotheses and controls

V8 inspector paused at the production confirmed-result branch with `operation=delete`, `status=synced` and the expected server ID on a legacy command. Before the fix, the real storage repro ends with queue=0, receipt=1, receipt after stale write=1. After the fix, all three counts are 0. No production instrumentation was added.

Ranked hypotheses after reproducing and narrowing the failure path:

1. Restart success bypasses the atomic receipt cleanup transaction.
2. IndexedDB receipt deletion or tombstone storage is generally failing.
3. A stale/wrong command acknowledgement is being accepted.
4. A later cache write recreates an otherwise correctly deleted snapshot.

Disproof ran before the production fix: the existing atomic cleanup test handles dependent work and rejects stale reinsertion; the changed-event acknowledgement test preserves its queue; the aborted transaction test retains queue and snapshot together; pending approval keeps its still-valid receipt. **Four controls passed.** These reject a general storage fault and demonstrate that only confirmed deletion should take the cleanup path. The debugger shows the bypass, while the existing helper already supplies the missing write fence.

## Experiment ledger

1. First deterministic legacy replay repro: queue removed but receipt count remained 1; **1 failed**.
2. Disposable debugger confirmed the verified delete-success branch and stale storage counts.
3. Four disproof controls passed before changing production code.
4. Expanded pre-fix cases: **2 failed / 1 passed** — replay and new-command deletion leave snapshots; pending approval behaves correctly.
5. Minimal recovery change reuses the atomic helper for confirmed deletion. Debugger storage counts become 0/0/0.
6. Targeted receipt/background/recovery/resume/readiness/queue/issuer Route tests: **199 passed**, exit 0.
7. Complete isolated suite: **1,075 passed / 2 existing skipped**, exit 0. Lint with zero warnings passed. Strict TypeScript with unused locals/parameters and incremental cache disabled passed, exit 0, no diagnostics.

## Dead code and boundaries

No additional dead function/import/variable was proven. `completeRubberCommand` and the legacy restart entry have live callers; Route exports remain framework entry points. Checked the issuer routes' authentication/manager and mutation-origin gates, queue command/actor binding, sync result identity/revision checks, and stale queue acknowledgement handling. No additional verified defect in those reviewed paths.

Source-size/import-direction and diff checks passed. Build/PWA/DB results from earlier scans remain prior evidence and were not rerun for this local recovery fix. No Route, SQL/schema, numbering format, counter or issued-number change; no Cloud mutation, commit/push or deployment.

Vault Printing note, Daily and hub were atomically saved with expected SHA-256 and exact read-back verification. The 99-note audit is unchanged (no new issues), and backlinks were verified. Daily remains 29/30 complete; conditional release 4.6 remains open.

Verdict: **ship at the separately agreed rollout step** — confirmed legacy deletion now uses the verified atomic cleanup path.
