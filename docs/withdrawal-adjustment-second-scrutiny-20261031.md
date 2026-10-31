# Withdrawal adjustment second scrutiny — 2026-10-31

Scope: the adjustment request/approval/deletion business logic and its employee/admin routes, including the existing report and cash guards. Unrelated Rubber changes in the working tree are outside this scan.

## Smallest change

Reuse the employee fence, sorted `private.lock_report_locations` helper and existing route error mapper. No new endpoint, table, permission or infrastructure is needed. Applied migrations remain unchanged; two forward fixes extend the existing RPCs.

## Reproduced findings

1. **Pending requests use stale account/report facts after waiting.** An employee request checks actor/source/report eligibility before waiting for the employee fence. It then reacquires the source but does not revalidate these facts. Two real-connection regressions hold that fence, deactivate the employee or delete the source report, then release the waiter. Before the fix, both requests incorrectly succeeded. Migration `20261031033000_withdrawal_adjustment_request_fence.sql` checks source existence/status/cancellation, active actor, current employee/branch scope and active source report again after waiting. No adjustment is inserted when a final check fails.
2. **Cross-branch creation and approval can deadlock.** The request initially fences its source branch; approval updates the payer branch before rebuilding balances of source/other open parents. Two employees with withdrawals in opposite branches and reciprocal payer branches acquire advisory locks in opposite orders. Both actual RPC paths reproduced PostgreSQL `deadlock detected`. Migration `20261031034000_withdrawal_adjustment_branch_lock_order.sql` collects the payer and all approved employee parent/adjustment branches and acquires them together in the existing sorted helper, before mutation. Approval's actor/scope checks remain after the new branch wait. This also keeps the final report check within the report fence.
3. **The employee route returns 400 for an authentication failure from an RPC.** A valid request can pass route authentication but receive `Authentication required` after a database wait. The employee error mapper treated this as generic 400. The actual route regression expected 401 and failed before the fix. `src/app/api/lanflow/time-tracking/user/route.ts` now returns 401 with the existing Thai sign-in instruction; business conflicts remain 409 and unexpected exceptions remain redacted JSON 500.

## Trace and falsification

No PostgreSQL step debugger is available in this workflow. Inspected live function definitions and followed request → employee advisory lock → source row → branch locks → final eligibility → insert/decision → cash movement trigger → deduction rebuild. For the route, exercised the actual exported POST with only the auth/RPC boundary substituted.

Ranked hypotheses and controls:

- Stale pre-wait eligibility permits an invalid request: confirmed by separate account-deactivation and report-unlock connections. Existing eligible employee requests and manager approvals still succeed.
- A manager decision's later checks protect employee pending requests: disproved because a non-manager returns PENDING without calling decision.
- A source-only branch fence is sufficient: disproved by reciprocal payer branches; direct approval also fails through the rebuild's cash guard.
- Each helper sorting its own input prevents all deadlocks: disproved because separate one-branch helper calls can still acquire the union in opposite orders. The fix acquires the union once.
- Authentication errors already map to 401: disproved by valid-payload route regression returning 400; unrelated pending conflicts and malformed-input controls retain their responses.

## Experiment ledger

| Run | Observation | Consequence |
| --- | --- | --- |
| R1 | `adjustment-second-request-repro`: both account/report races fulfilled instead of rejecting | Reproduced stale pending-request checks |
| R2 | `adjustment-second-auth-repro`: 400 instead of 401 | Reproduced employee route error semantics |
| R3 | After migration 330 and route mapping, both focused suites pass | Original reproductions fixed |
| R4 | Cross-branch fixture first hit duplicate branch name; corrected fixture and cleaned only its fixed test IDs | Harness failure, not product evidence |
| R5 | `output/adjustment-second-cross-repro.log`: request and direct approval each fail with advisory deadlock | Proved the branch-order failure in both entry paths |
| R6 | Migration 340 removes the product failure; initial cleanup failed because reciprocal adjustments still referenced the other fixture branch | Corrected test teardown to remove both employees' transactions before either branch; no production workaround |
| R7 | `output/adjustment-second-db-focused.log`: all 5 real-connection tests pass | Existing deletion/report/permission races and new request/cross-branch cases remain correct |

The scheduling trigger in the cross-branch regression is test-only, limited to its two employee IDs and removed in `finally`; no production trigger was changed. All fixture setup/cleanup targets fixed local test IDs. Schema snapshot was updated only for the two affected RPC bodies and compared with a local dump after normalizing whitespace.

## Final verification

- Strict unused TypeScript scan: zero diagnostics; no unused function, variable or import proved in scope, so no dead code removed. Existing lazy exports, route error helpers and SQL compatibility wrapper have actual callers.
- Full database gate: 73 SQL files / 1,715 assertions plus 20 real concurrency tests pass. The adjustment file includes 5 tests covering the prior boundaries and all new races.
- Full application gate: 1,083 isolated tests pass / 2 existing live OCR skips; lint, typecheck, source-size/import checks, auth outage, production build, service worker and bundle budgets pass. Time/Payroll remains 119.4 kB raw / 27.8 kB gzip.
- Local migration ledger includes 330 and 340; schema snapshot matches the local public/private dump after whitespace normalization. Temporary scheduling trigger/function and both fixed-ID fixture branches are absent after tests.

Runtime logs: `output/adjustment-second-verify.log`, `output/adjustment-second-db.log`, `output/adjustment-second-unused.log`. No Cloud migration, deployment, commit or push is part of this scan.

- Real adjustment API/RPC integration: 4 passed including setup; explicit-null settlement, exact latest-ID deletion, Dashboard deletion history and closed-slip floor retain their behavior. Log: output/adjustment-second-api.log.

Verdict: fixes verified for local review; no remaining actionable finding in the traced adjustment scope. No Cloud release.
