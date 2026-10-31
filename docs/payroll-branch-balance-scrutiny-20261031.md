# Payroll branch balance scrutiny — 2026-10-31

## Intent and smaller alternative

Review the payroll/withdrawal branch balance end to end, preserving full operating cost and bank evidence. Reusing `time_payroll_branch_paid_amount` is smaller than a new ledger or allocation model. The existing summary fix is necessary (prior regression proves it). The compatibility overview route remains a public, tested endpoint, so removing it as dead code would break its contract.

## Findings fixed

1. **Overview route still subtracts bank-funded payroll (P1).** `src/app/api/lanflow/dashboard/route.ts` calls `public.get_dashboard_overview`, whose separate `financial_events` aggregation still used full payroll/withdrawal totals. For 15,000 split into 10,000 bank and 5,000 branch, its balance was -15,000 while the canonical summary was -5,000. Forward migration `20261031041000_payroll_overview_balance.sql` credits back full source amount minus the canonical branch portion for versioned approved sources. Original location/status/cancellation predicates, event rows, pagination, full operating costs and legacy behavior remain intact. This adds two location-filtered source aggregations only to the compatibility RPC, not the snapshot worker.
2. **Thrown RPC failures bypass JSON error handling (P2).** Both overview and snapshot GET routes handled returned `{error}` but rejected without a response when RPC transport threw. A narrow outer catch now returns the existing generic JSON message, status 500 and no-store; it logs no private diagnostic content. Authorization and existing success paths are unchanged.

## Trace and unused-code check

- Admin route → payment validators → canonical mutation RPC → source allocation → helper → summary → snapshot worker → Dashboard and branch summaries. No new dead import/function found in this path; targeted ESLint passed.
- Snapshot GET → auth/location guard → `get_dashboard_snapshot` → cached summary; overview GET → auth/location guard/cursor validation → `get_dashboard_overview` → independent live aggregation (the missed seam).
- New cash count → live canonical summary → frozen system balance. Existing regression checks this and preservation of historical count balances.
- The DB-lint warning for `get_payment_bundle_candidates.p_account_number` remains outside this task's changed path. It is an exposed named RPC argument supplied by `src/hooks/usePaymentBundles.ts`, so deleting the parameter as an unused local would break clients. No signature cleanup was performed.

## Debug ledger

No interactive PostgreSQL debugger is configured in this environment; used SQL source trace and deterministic pgTAP fixtures. Node route behavior is exercised through real source modules with only auth/RPC boundaries replaced.

| Run | Change / result | What it established |
| --- | --- | --- |
| 1 | Added overview assertions to real payroll fixture: split -15,000 vs expected -5,000 and full-transfer -15,000 vs zero; operating cost 15,000 passed | Reliable failing signal; discrepancy is specific to balance |
| 2 | Traced route and SQL: overview directly aggregates sources, with no snapshot read; original payroll test runs before bank slips exist | Disproved cache/stale snapshot and slip double-count hypotheses; ranked cause: old independent aggregation, then stale cache, then duplicate slips |
| 3 | Applied forward migration; expanded every balance scenario to assert overview and canonical result; all 116 assertions passed | Covers legacy, outside, zero, pending, cancelled, move, slip states and source deletion for both formulas |
| 4 | First route test failed on dynamic `next/server` module resolution; replaced with established static import | Test harness setup issue, not an application defect |
| 5 | Corrected route test rejects with private transport error before a response; both endpoints reproduce it | Narrowed fail path to RPC await outside a catch; alternative returned-error and authorization paths already have explicit handling |
| 6 | Added catch; focused route/payment tests 37 passed; DB suite 74 files / 1,831 assertions PASS | Both fixes hold against existing source-state and route behavior |
| 7 | Restored previous overview definition in a transaction, replayed 410, matched definition hash and rolled back | Forward patch matches applied Local object; initial harness lacked an SQL statement separator, corrected before successful replay |

## Verification and limits

- TypeScript and targeted ESLint PASS; Local DB lint has no errors, only the existing unrelated unused-argument warning.
- Schema overview object regenerated from Local dump, preserving other working-tree changes.
- All fixtures roll back; no Cloud apply, commit, push or deployment. Migration replay was focused, not a full fresh reset. No browser UI was changed or retested.

Verdict: Local fixes verified; no remaining blocker found in this reviewed flow. Cloud rollout is still pending separate authorization.
