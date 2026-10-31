# Withdrawal adjustment business and route scrutiny — 2026-10-31

Scope: the current withdrawal-adjustment change and its actual callers, not the unrelated Rubber work already in the working tree. Goal: retain report/slip/cash invariants while deleting only the latest adjustment and settling the difference outside-system.

## Smaller implementation check

The existing request/decision/delete RPCs, payroll planner, route parser and error boundary patterns are sufficient. Fix the approval fence and employee POST exception boundary in place. No additional endpoint, table, permission or payment workflow is needed.

## Dead-code audit

`tsc --noEmit --noUnusedLocals --noUnusedParameters` completed without diagnostics. Traced both lazy interaction exports to EmployeeDialogs/EmployeeTransactionHistory, error mapper exports to admin route/tests, and private SQL helpers to the existing public RPC/wrapper/summary. No unused function, import or variable was proved in scope; none was removed. The compatibility rebuild wrapper is still called by approval and existing database tests and is not dead code.

## Reproducible findings and fixes

### Approval can outlive the manager's permissions

- Before fix: `decide_time_tracking_withdrawal_adjustment` checks manager scope before waiting for the employee advisory lock; after waiting it reacquires the adjustment but does not revalidate actor permissions. Outside-system approval has no paying-branch check to catch revocation.
- Reproduction: independent connection holds the employee fence, revokes a manager's system/payroll permissions and commits; the waiting manager's approval of an outside-system pending adjustment still succeeds. The regression failed with fulfilled where rejection was required.
- Fix: forward migration `20261031032000_withdrawal_adjustment_approval_fence.sql` rechecks row existence, active account and employee scope immediately after reacquiring the adjustment under the fence, before reading the source or deciding it.
- Verification: the same real concurrent test rejects the revoked manager and leaves the request PENDING. A second controlled race deactivates the actor while waiting and expects Authentication required. Existing authorized approval and deletion/report/new-request/repeat races remain covered.

### Employee POST lets unexpected RPC exceptions escape

- Before fix: employee POST validates input and handles returned `{ error }`, but unlike admin POST it has no exception boundary around the awaited RPC. A rejected RPC Promise rejects the handler instead of returning the established JSON error response.
- Reproduction: execute the actual user route with only the auth/RPC boundary replaced; throw a transport Error. The test fails before any HTTP Response is produced.
- Fix: wrap the existing action dispatch in the same generic JSON 500 boundary used by admin POST. Do not expose exception diagnostics or alter successful/expected business-error responses.
- Verification: all four employee actions are exercised with injected RPC exceptions. Control cases prove malformed input still stops before the RPC and a returned pending-adjustment business error remains a 409 with its Thai reason.

## Debug ledger

| Run | What changed | Observation and discrimination |
| --- | --- | --- |
| S1 | Strict unused scan and call graph | No unused diagnostics; wrapper/lazy exports have consumers |
| S2 | Throw RPC Error versus returned business error | Actual employee handler rejects only on thrown error; the existing returned-error path is a distinct working branch |
| S3 | Hold employee fence and revoke waiting approver | Approval incorrectly commits; proves the earlier delete-only permission fix does not protect decision RPC |
| S4 | Source trace | No PostgreSQL debugger is installed in this workflow; inspected the live function and route. Enumerated role/scope, active flag, branch/null, wait timing and returned-versus-thrown error as controls |
| S5 | Minimal boundary/fence fixes | Original reproductions pass; no changes to amount planner, report lock or user approval permissions |

Ranked hypotheses: (1) approval authorization is stale across the lock — confirmed by S3; (2) branch access alone prevents revocation — disproved by null-branch approval; (3) employee POST already contains a generic exception boundary — disproved by S2/live source; (4) the failure is malformed request validation — disproved with a valid UUID and finite target and a control case that stops before RPC for invalid input. Compared each result against the existing permission-fence/delete regression rather than attributing it to flaky timing.

Final check results are recorded below after completion. No Cloud changes, commit, push or deployment are part of this scan.

## Completed checks

- Strict unused scan: `tsc --noEmit --noUnusedLocals --noUnusedParameters --incremental false` passes with zero diagnostics; no dead code removed.
- Final `npm run verify`: 1,082 passed / 2 existing live OCR skips; lint/type/source-size/import/auth-outage/build/SW/bundle gates pass. UI text and bundle limits remain unchanged.
- Full DB final run: 73 files / 1,715 assertions and all 16 real concurrency tests pass. The expanded permissions test also proves a deactivated waiting approver is refused and the request stays pending.
- The first broad DB attempt stopped in the existing history-retention fixture with TEST_CLEANUP_DID_NOT_DRAIN. An instrumented rollback-only diagnostic of that fixture completed successfully (74-batch bound); the final full rerun passed. No history-retention product or fixture code was changed in this scope. Diagnostic: output/adjustment-scrutiny-retention-probe.log.
- Runtime results: output/adjustment-scrutiny-verify.log and output/adjustment-scrutiny-db-final.log. Forward migration 20261031032000 applied only in local and recorded in its ledger.

Verdict: fixes verified for local review; no remaining actionable finding in the traced scope. No Cloud deployment.
