# Withdrawal adjustment sixth scrutiny — 2026-10-31

Scope: the current adjustment business logic and its employee/admin routes. This is a fresh verification of the traced feature, not a claim to have audited every module in the shared working tree.

## Intent and smaller alternative

Verify that only the actual latest authorized correction can be deleted, restoring the previous target atomically while preserving reports/slips and outside-system cash semantics. The current request/decision/delete RPCs, sorted fences, timestamp fixes, route parsers and error boundaries already provide this behavior. With no new reproducible failure, leave product code and migrations unchanged rather than add another abstraction or speculative guard.

## End-to-end trace

- Request/decision input: `src/app/api/lanflow/time-tracking/action-request.ts:10`, admin route actions at `admin/route.ts:238` and `:259`, employee POST at `user/route.ts:251`. Non-record/malformed JSON stops before mutation; manager outside-system settlement requires explicit null, not omitted/malformed branch. Finite numeric inputs are required at the route; amount precision/range and current scope are enforced in the RPC.
- Authorization: request/approval/withdrawal/delete RPCs revalidate active actor/owner/employee scope across their respective waits. Employee DELETE_TRANSACTION still cannot bypass the private manager-only approved-adjustment boundary. Authenticated table grants expose SELECT rather than direct financial mutation; the existing private helper grants remain restricted.
- Effective identity: `supabase-schema.sql:5935` latest target, `:23140` summary and `:4100` deletion share the approved-at/created-at/ID ordering. Approval captures its timestamp after serialization. Deletion consumes the exact requested ID, so a retry cannot delete the next correction.
- Reversal/documents: delete fences affected branches, checks latest/pending/report/slip/closed floor, then deletes and rebuilds through the surviving withdrawal source. Cash projection/event changes and balances roll back together on failure. Original-source report alone does not prevent unreported-adjustment deletion.
- Slip timing: `supabase-schema.sql:14428` creates new slips with a post-fence snapshot timestamp; `:11579` blocks adjustment deletion when a later active slip includes that source month. Historical as-of snapshots keep their previous behavior. Zero targets remain covered even when absent from printable transactions.
- Responses/UI callers: employee/admin catch blocks preserve recognized401/403 and redact unexpected500; document/pending/stale conflicts retain actionable reasons. EmployeeTransactionHistory uses the summary's latest ID for the delete control and invalidates owner/branch views through the existing interaction after success.

## Findings

**Dead code:** strict TypeScript noUnusedLocals/noUnusedParameters completes without diagnostics. Traced both lazy interaction exports, the SQL rebuild compatibility wrapper and route error-mapper exports to actual consumers. No function, variable or import was proved unused in this scope; none removed. Public/compatibility SQL signatures are not treated as dead merely because a new helper exists.

**Bugs:** no new actionable, reproducible defect found in these paths. No product source, migration, permission, amount formula or UI wording changed in this scan.

## Verification ledger

| Check | Evidence | Result |
| --- | --- | --- |
| Strict unused/type scan | output/adjustment-sixth-unused.log | Zero diagnostics |
| Actual exported GET/POST error/validation boundaries | tests/time-payroll-route-failures.spec.ts and tests/time-payroll-adjustment-errors.spec.ts; output/adjustment-sixth-route.log |14 passed |
| Deletion/outstanding SQL controls | time_payroll_adjustment_delete_test.sql and time_payroll_slip_outstanding_badge_test.sql; output/adjustment-sixth-sql.log |2 files/86 assertions passed |
| Real authenticated API/RPC integration | tests/time-payroll-withdrawal-adjustment.spec.ts; output/adjustment-sixth-api.log |4 passed including setup |
| Real concurrent report/permission/ordering/slip races | tests/time-payroll-adjustment-concurrency.spec.ts; output/adjustment-sixth-concurrency.log |12 passed |
| Schema/current implementation | Eight traced request/decision/withdrawal/delete/latest/summary/slip/blocker function definitions compared with output/adjustment-sixth-schema.sql |Match local database |

No new failure was available to debug, so no speculative fix was made. Existing repros exercise the timing/scope/input axes and distinguish normal business conflicts, late auth failures and unexpected exceptions. The full application build and full DB suite from the preceding verified scan are historical evidence, not rerun claims for this scan; focused checks cover the unchanged product paths here.

Verdict: ship for local review — no new actionable finding in the traced feature, and all focused checks pass. No Cloud apply, commit, push or deployment.
