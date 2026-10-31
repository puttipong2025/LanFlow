# Withdrawal adjustment fourth scrutiny — 2026-10-31

Scope: latest-adjustment ordering, reversal, pending/report/slip/cash guards, actor scope and the employee/admin route callers. Unrelated working-tree changes are preserved.

## Intent and smaller alternative

The latest effective target and delete control must follow the actual serialized approval order, and a delete must remain authorized after every blocking fence. Reuse the existing timestamps, employee/branch locks and RPCs; do not introduce a new sequence, table, endpoint or permission. Forward migration360 changes only approval stamping and a missing post-branch permission check.

## Findings and proof

### Approval time can put the later correction behind an earlier correction

- Path: admin request/decision → employee fence → branch/source locks → decision UPDATE approved_at=now() → deduction rebuild/latest target → summary/latest-ID → latest-only deletion.
- PostgreSQL now() is the transaction start, so a transaction that began earlier but calls approval later can receive an earlier approved_at. latest_withdrawal_target and the delete helper sort by approved_at first. The first correction can remain effective despite the second approval recording its base from that first correction.
- Reproduction: one connection begins and sleeps; a second connection approves1000→1500; the earlier transaction then approves1500→1200. The second row correctly records base1500, but the effective target remains1500 instead of1200. Test fails before the fix in output/adjustment-fourth-order-repro.log. This disproves stale-base or rounding explanations.
- Fix: capture clock_timestamp() after the existing serialization locks and immediately before the decision UPDATE. Use that one value for approved_at and its Dashboard event fingerprint. Keep created_at, ordering tie-breakers, amounts and the deduction planner unchanged. Do not rewrite historic records or reports.
- Regression tests both outside-system and branch settlement. They assert target1200, latest identity, strictly later approval time, branch income300 where applicable, and deletion restoring target1500 and the preceding latest ID.

### Deletion can outlive permissions while waiting for a branch fence

- Path: admin DELETE_TRANSACTION → public permanent-delete RPC → private delete helper → employee/row fence and permission recheck → sorted branch fence → latest/report/slip/floor checks → delete/rebuild.
- The prior permission recheck precedes the branch wait. A different connection can hold only that branch, deactivate the waiting actor or revoke payroll/system scope, then commit. Both deletes incorrectly succeeded before the fix.
- Proof: the new tests require the actual waiting connection to show an advisory Lock wait after the employee fence; then they expect rejection with Authentication required or Forbidden and the adjustment/target retained. Both tests fail before the fix in output/adjustment-fourth-delete-repro.log.
- Fix: recheck active actor, employee scope and existing payer-branch scope immediately after the branch fence, before latest checks/mutation. Existing early checks and document/cash guards remain in place.

## Debug ledger and falsification

No PostgreSQL step debugger is available in this workflow. Read live function definitions, the actual latest-target/summary/delete consumers and their route callers. Enumerated transaction-start timing, approval execution timing, payer/null, active actor, employee/payer scope and employee-versus-branch wait as independent axes.

| Run | Observation | Conclusion |
| --- | --- | --- |
| F1 | Later row records base1500 but latest target remains1500 after approval1200 | Read of the prior target is fresh; persisted approval ordering is wrong |
| F2 | Latest-target, summary and deletion all use approved_at first; decision writes now() | Failure is shared database ordering, not UI history sorting |
| F3 | Actual branch wait observed; inactive and revoked actors still delete | Earlier employee-fence check does not cover the later branch wait |
| F4 | After migration360, old tests and permission cases pass; new summary assertions initially omitted their JWT identity | Corrected only the harness; do not weaken summary authorization |
| F5 | Snapshot comparison catches an overbroad body-replacement boundary at an inline function terminator | Restored exact function boundaries from the local dump; verified the complete normalized snapshot equals the dump before completion |
| F6 | Four new regressions pass with actual RPCs | Outside/branch ordering, reversal and both actor-state changes are covered |

Ranked hypotheses: (1) transaction-start approval stamp reverses effective order — confirmed by F1/F2; (2) second request used an obsolete base — disproved by base1500; (3) UI sorting alone causes the wrong target — disproved by direct SQL latest-target result; (4) deletion's employee-fence checks cover all later waits — disproved by F3. Valid existing approvals/deletes remain controls, and stale scope failures must roll back the whole operation.

## Verification

- Full database gate: 73 SQL files / 1,715 assertions and25 actual concurrency tests pass. The adjustment concurrency file now has10 tests; all4 added ordering/branch-wait cases pass in the full run.
- Full application gate: 1,089 isolated tests pass /2 existing live OCR skips; lint/type/source-size/import/auth-outage/production-build/service-worker/bundle checks pass. Time/Payroll remains119.4kB raw/27.8kB gzip within the existing budget.
- Actual adjustment API/RPC suite:4 passed including setup. Existing explicit-null settlement, exact latest-ID deletion, branch deletion history, zero target and closed-slip floor retain their behavior.
- Strict unused scan passes with zero diagnostics. Local ledger records360; the two fixed-ID fixture branches and temporary scheduling function/trigger are absent after the tests.
- Logs: output/adjustment-fourth-verify.log, output/adjustment-fourth-db.log, output/adjustment-fourth-api.log, output/adjustment-fourth-unused.log. Focused proof/fix logs are output/adjustment-fourth-order-repro.log, output/adjustment-fourth-delete-repro.log and output/adjustment-fourth-new-fixed.log.

 No unused TypeScript symbol has been proved in scope; the strict scan passes, and lazy/wrapper/error-mapper exports have real callers. No dead code removed. Source snapshot equals a fresh local public/private dump after normalizing whitespace. Migration20261031036000 is applied and recorded only locally. No commit, push, Cloud migration or deployment.


Verdict: fixes verified for local review; serialized approval order and post-branch authorization now pass their original reproductions. No Cloud release.
