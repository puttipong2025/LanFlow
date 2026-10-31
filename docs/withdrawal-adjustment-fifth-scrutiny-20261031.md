# Withdrawal adjustment fifth scrutiny — 2026-10-31

Scope: adjustment request/decision/delete callers, route input/error boundaries, payroll snapshot timing and the slip blocker used by latest-only deletion. Unrelated working-tree changes are preserved.

## Intent and smaller alternative

A slip created after an approved correction must snapshot that correction and block its deletion, even if the slip caller began its transaction earlier. Reuse the existing slip-created timestamp and as-of snapshot helper: stamp new RPC-created slips after the employee fence. Do not change historical snapshot semantics, rewrite existing slips, add a snapshot table or alter the deletion contract.

## Reproduced finding

**A newly generated slip can contain an obsolete outstanding balance and miss the adjustment-deletion blocker.**

- Trace: public create_time_tracking_payroll_slip → internal_20260901 → employee advisory fence → calculate deductions/transactions → INSERT payroll_slips with default created_at=now() → outstanding trigger passes created_at as p_as_of → snapshot filters approved_at<=p_as_of. Deletion's blocking-slip helper separately compares the same created_at with adjustment.approved_at.
- now() is the transaction-start time. If that transaction began before a correction but creates its slip after the correction, its timestamp excludes the correction from the immutable outstanding aggregate. The printable transactions use the current target, so the same slip can contain inconsistent balances. The deletion helper can also treat it as a pre-adjustment slip.
- Reproduction uses the actual public creation RPC from two connections: start a transaction and pause; approve1000→1500 from a different connection; let the old transaction create its slip. Before the fix, remainingAfterDeductions is1000 instead of1500. This reproduces using the real snapshot triggers and existing public API/RPC logic, not a manually inserted fake slip. Log: output/adjustment-fifth-slip-repro.log.
- Fix: forward migration20261031037000_payroll_slip_snapshot_creation_clock.sql captures clock_timestamp immediately before the internal slip INSERT, after employee serialization and calculation. Use that single value for created_at and slip_data.lockedAt. The unchanged outstanding trigger and blocker then use the correct as-of time. Existing imports/direct historical inserts retain their explicit created_at semantics; no past row is modified.
- Regression covers target0 and1500. It asserts the immutable outstanding aggregate, creation time after adjustment approval, a blocking slip, rejection of exact adjustment deletion with MONTH_CLOSED, and unchanged effective target.

## Trace, controls and experiment ledger

No PostgreSQL step debugger is available in this workflow. Inspected the live creation function, adjustment stamp, snapshot triggers/helper, blocking-slip helper, public deletion path and the corresponding route inputs/error handling. Varied transaction start versus actual slip creation, zero/nonzero target, historical versus new RPC snapshot and before/after correction timing.

| Run | Observation | Conclusion |
| --- | --- | --- |
| V1 | First assertion used a nonexistent remainingOutstanding key | Corrected the test to the actual remainingAfterDeductions contract; not product evidence |
| V2 | Real RPC slip stores1000 after correction1500 | Confirms stale snapshot cutoff with actual production helper/trigger path |
| V3 | Existing historical snapshot suite passes42 assertions before the fix | Explicit historical as-of behavior already works; avoid changing the helper to always use current targets |
| V4 | Migration370: zero and1500 tests both pass | New slips include the correction and block its deletion without changing target/planner rules |
| V5 | Full normalized schema comparison equals fresh local dump | Only intended creation-function change is represented in snapshot |
| V6 | Initial full DB run:74 SQL files/1,831 assertions pass;26/27 concurrency pass; Rubber cron deadline case takes5160ms against5000ms limit while verify/build also run | Record the actual failed run; no scope-product failure or timing-threshold change inferred; rerun after the other gates finish |

Ranked hypotheses: (1) created_at carries the pre-lock transaction timestamp — confirmed by V2/source trace; (2) latest target is wrong — disproved by completed approval and current target in the same fixture; (3) historical snapshot helper should ignore p_as_of — rejected by V3; (4) a closed-floor check alone protects the slip — disproved by zero-wage/outstanding-only examples, which require the existing blocker. The smallest fix aligns new-slip creation time with the existing as-of contract.

## Verification

- Full application gate passes:1,102 isolated tests /2 existing live OCR skips; lint/type/source-size/import/auth-outage/production-build/service-worker/bundle checks pass. Time/Payroll remains119.4kB raw/27.8kB gzip within its existing budget.
- Final full database gate passes:74 SQL files /1,831 assertions and27 real concurrency tests. The adjustment file has12 tests, including both new actual-slip cases. Counts reflect the current shared workspace, including unrelated changes preserved during this scan.
- Real adjustment API/RPC integration:4 passed including setup. Historical snapshot control:42 assertions pass. Strict unused scan completes without diagnostics; no unused symbol proved in scope, so no dead code removed.
- The initial full DB attempt had one Rubber cron deadline failure at5160ms versus5000ms; final rerun passes with that case at3518ms. No Rubber product/test code or threshold was changed in this scan. Logs retain both outcomes; do not describe the initial run as passing.
- Logs: output/adjustment-fifth-verify.log, output/adjustment-fifth-db.log, output/adjustment-fifth-db-final.log, output/adjustment-fifth-api.log, output/adjustment-fifth-historical-control.log, output/adjustment-fifth-unused.log. Reproduction/fix logs: output/adjustment-fifth-slip-repro.log and output/adjustment-fifth-slip-fixed.log.
- Local ledger records370. Fresh public/private schema dump matches the snapshot after whitespace normalization; fixed-ID fixtures and test scheduling trigger/function are absent after checks.

 Strict unused audit checks production TypeScript symbols and traces lazy/wrapper/error-mapper consumers; no proved dead code removed. Local migration370 only; no Cloud migration, commit, push or deployment.


Verdict: fixes verified for local review; actual slip creation now snapshots the serialized adjustment and protects it from deletion. No Cloud release.
