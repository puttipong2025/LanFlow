# Payroll branch balance — third scrutiny 2026-10-31

## Result

No new actionable bug or unused declaration found in the reviewed payroll/withdrawal → Dashboard routes → summary/history flow. No production code, SQL or schema changed this pass. Added five focused security/compatibility tests; no cleanup was performed merely to create a diff.

## Intent and smaller alternative

Verify the previous fixes preserve branch-funded balance, full operating cost, access gates and PostgreSQL cursor compatibility. Retaining the existing allocation helper and strict shared timestamp validator is the smallest implementation. No additional ledger, validator, route abstraction or scheduler is justified by the evidence.

## Traced evidence

- `supabase/migrations/20261031040000_payroll_branch_balance.sql:13` and `:24`: canonical summary uses the existing branch-portion helper for balance rows and separate full-cost rows. `:50` marks affected snapshots dirty through the existing worker.
- `supabase/migrations/20261031041000_payroll_overview_balance.sql:10` and `:17`: compatibility overview restores only versioned bank portions after its original aggregation. Original full operating-cost rows and history pagination are preserved.
- `src/app/api/lanflow/dashboard/route.ts:41`, `feed/route.ts:51`, `snapshot/route.ts:25`: auth precedes reads; location membership is checked before RPC for ordinary callers. Added tests exercise anonymous401 and out-of-branch403, asserting zero RPC calls.
- `src/app/api/lanflow/dashboard/route.ts:21` and `feed/route.ts:30`: cursor validators use shared strict timestamps. Added positive checks prove PostgreSQL-style six-digit fractional seconds and explicit +07:00 offsets pass unchanged to RPC; this checks compatibility after prior hardening.
- `src/app/api/lanflow/dashboard/feed/route.ts:78`: every present date filter is validated. Existing empty/year0000/invalid-date tests, page validation, cursor/numbered forwarding and returned/thrown errors still pass.
- Source traces and targeted ESLint confirm all remaining changed helpers/imports have callers. No unused declaration was removed.

## Review ledger

1. Read latest route changes and both financial migrations cold; traced unchanged caller/validation/auth/RPC boundaries. No new discrepancy found.
2. Added three endpoint tests (overview/feed/snapshot) for anonymous and out-of-branch requests; all blocked before RPC.
3. Added two cursor compatibility tests (overview/feed) with microseconds and offset; both accepted without timestamp truncation.
4. Focused suite: 61 PASS (Dashboard routes, payroll allocation, payroll route failures, operator history). TypeScript, targeted ESLint, source-size/import-direction and whitespace checks PASS.

No newly failing reproduction was found, so no bug hypothesis or production fix was introduced. Existing DB suite evidence remains 74 files / 1,831 assertions from the prior SQL-changing pass; not rerun for unchanged SQL. No browser UI change or browser test. No Cloud write, commit, push or deployment.

Verdict: Local review passed in this scope; no new blocker found.
