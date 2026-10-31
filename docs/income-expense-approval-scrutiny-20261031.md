# Income/expense approval scrutiny — 2026-10-31

Scope: current approval settings/read/decision flow, its three decision routes and approval submission route. Keep existing forms, permissions, SQL contracts and mobile table layout. Reuse a small response checker rather than introduce new endpoints or duplicate decision implementations.

## Experiment ledger

1. Read current call graph: modal → useIncomeExpenseApprovals → income/cash decision routes or branch helper/route → authenticated PostgreSQL RPC. Settings use partial compare-and-set REST updates protected by RLS; no settings API to add.
2. Strict TypeScript unused scan (`--noUnusedLocals --noUnusedParameters`) produced no diagnostics. Existing unused UI row was already removed during implementation; do not claim it as newly found.
3. Runnable reproduction `income-expense-approval-scrutiny.spec.ts`: 17 failed / 8 passed before edits. Opposite income decisions returned 200, upper-case request UUID returned 500 after a valid result, cash/branch auth failures escaped, branch RPC rejection escaped, cash RPC exception returned 500 without no-store, malformed 200 client acknowledgements produced success, and a malformed submission fell through to direct saving.
4. Debugger attempt initially failed in the standalone harness because its TypeScript helper needed esModuleInterop; fixed the harness only. Node inspector then paused inside the actual branch POST and at its rejected RPC; the rejection escaped the route (`approval-scrutiny-debug.log`). No production logging/instrumentation added.
5. Disproof controls before edits: matching route/client responses and income route thrown-auth/RPC containment all passed (8). This rules out an always-failing RPC mock or universally broken route harness. Case-only variation and expected-decision-only variation isolated the income response checks.

Ranked hypotheses after debugger/source trace:

- Missing outer route boundary explains cash auth and branch auth/RPC failures; disproved if the existing safe income route also escaped (it did not).
- Missing expected-decision comparison explains opposite income success; disproved by opposite status being rejected while matching status succeeds (opposite was accepted).
- Exact UUID string comparison explains upper-case path failure; disproved if lower-case matching control also failed (it passed).
- HTTP-status-only client handling explains false success and submission fallthrough; disproved if malformed acknowledgements rejected without success invalidations (they did not).

Before fixes, compare all hypotheses against entries 1–5. They fit every observation. Regression coverage uses actual production modules with only auth/network/query boundaries replaced.

6. Minimal fixes: share decision acknowledgement parsing, canonicalize the income request UUID and bind the result to its requested decision, contain cash/branch outer failures as private/no-store JSON503, and validate submission acknowledgements. Delete the two unreachable fallthroughs after exhaustive response validators and replace the duplicated branch matcher.
7. Initial new regressions: 25 passed. Added invalid-JSON, approved-transaction-ID and valid-submission controls; new scrutiny plus existing polling safety suite: 56 passed (31 new scrutiny cases). No automatic retry added.
8. First full verify reached isolated tests: 1,147 passed / 2 existing skips / 1 failed. The failure was the old cash RPC-throw expectation of 500; updated it to 503 while retaining opaque JSON and exactly-one-RPC checks, and added no-store assertion. This is an intentional response-status change, not a weakened no-retry test.
9. Local permission SQL: 1 file / 26 assertions passed. Read actual definitions of all three decision RPCs; their result shapes match the bound request/status checks (income approval also returns incomeExpenseId). No SQL/schema changes made by this scrutiny.
10. Browser run in the shared workspace was interrupted: an unrelated next build (PID25000) overwrote the dev server's .next manifest. Kept the other build running, stopped this run, and verified this run's server/runner had exited. Do not count this interrupted run as a complete browser pass.
11. First isolated snapshot: 16 browser cases passed / 1 failed / 11 serial cases did not run. The failure showed raw Tailwind directives and no utility CSS because the snapshot's first startup lacked postcss.config.js (the source repository uses .js, not .mjs). Adding that config without replacing its generated cache still reproduced the same unstyled snapshot. No UI code changed to hide this harness failure; create a fresh snapshot with every root config present before startup.
12. Fresh complete snapshot: the same targeted 375px draft/layout case passed. All ten reviewed product source files were SHA-256-identical between this workspace and the snapshot. The CSS failure was test setup, not a new product defect.
13. Complete isolated browser rerun: 28 passed (2.4m): settings12, branch workflow10, operation badges/read-retry2, real cash-transfer contract4. This includes actual approvals/rejections, stale concurrent decisions, denominations and DB restoration. The owned port3013 server exited afterward.
14. Repeated the same debugger harness after the fix: the injected RPC still rejected at the same call boundary, but POST returned JSON503 instead of letting the rejection escape (`approval-scrutiny-debug-fixed.log`). This confirms the handler, not the mock or transport, changed the outcome.
15. Final strict unused/typecheck in the original working copy passed with zero diagnostics. Full verification continues in the complete isolated snapshot so no build process overwrites another task's .next files.
16. Final full `npm run verify` in the complete isolated snapshot passed: ESLint/typecheck/source-size/import/auth-outage; isolated 1,154 passed / 2 existing skips; production build, Service Worker and bundle gates. First load294.8kB/320.0kB, route109.3kB. This snapshot includes other in-flight project changes; only the reviewed approval sources are claimed as this task's edits. No full DB suite rerun claimed (no SQL change); permission26, actual workflow28 and targeted31 regressions cover the affected contracts. Final verification completed after the session date rolled to 2026-11-01.

## Fixed findings

### Major — HTTP 200 could become false success or bypass the local approval decision

`src/hooks/useIncomeExpenseApprovals.ts:292` and `:312`, plus `src/lib/income-expense/branch-transfer-delete-approvals.ts:67`, previously accepted an empty, malformed, wrong-request or opposite-decision success body. The modal then displayed success and invalidated caches. The submission path at `useIncomeExpenseApprovals.ts:373` treated an unknown 200 body as no approval required. Deterministic regressions reproduced both paths. Shared `approval-decision-response.ts` now binds ID/status and checks approved incomeExpenseId; submissions reuse the existing approval result validator. Invalid results throw before success callbacks or direct-save fallthrough. No retry introduced.

### Major — outer cash/branch decision failures escaped the JSON route boundary

`src/app/api/lanflow/cash-branch-transfers/delete-requests/[id]/decide/route.ts:12` previously left auth/params outside the catch. `src/app/api/lanflow/money-transfers/delete-requests/[id]/decide/route.ts:7` did not catch rejected RPC promises. The debugger observed the latter escape. Outer boundaries now return generic JSON503/private/no-store, retaining explicit permission/input/conflict errors and one-RPC behavior.

### Major — income route could confirm a different decision or misreport UUID casing

`src/app/api/lanflow/income-expense/approval-requests/[id]/decide/route.ts:44` and `:68` now canonicalize UUIDs before the RPC and compare successful request/status with the intended decision. Previously a rejected response for an approval request was accepted, while a valid PostgreSQL lower-case result for an upper-case path returned 500 after commit. Opposite-decision and case-only controls reproduced the discrepancy and now pass.

### Dead code and duplication

Remove unreachable final 500 fallthroughs after exhaustive validators in `income-expense/approval-requests/route.ts:58` and `income-expense/approval-requests/[id]/decide/route.ts:86`. Replace the branch-local `isDeleteDecisionResult` and inline cash matcher with the shared checker. The strict unused scan found no additional unused variables/imports/functions; no speculative deletions or unrelated changes.

Verdict: ship. Reproduced failures are contained and acknowledgements are bound to their request/decision, with valid real workflows and the complete local build passing. No commit/push/Cloud migration/deployment in this task.
