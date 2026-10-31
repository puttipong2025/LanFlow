# Payroll branch balance — Local verification 2026-10-31

## Result

Migration `20261031040000_payroll_branch_balance.sql` separates the existing dashboard financial rows into balance-only branch portions and operating-cost-only full totals. Both reuse the original source predicates and Bangkok approval dates. It uses the existing allocation helper, preserving legacy and outside-system behavior. No source rows, historical counts, reports, history events, permissions, or client behavior are rewritten.

For a net payroll of 15,000 with a bank allocation of 10,000: accumulated branch balance decreases by 5,000, today's expense increases by 5,000 on the approval day, and operating expense increases by 15,000. The same rule applies to withdrawals; payroll deduction calculation is unchanged. Existing outside-system rows have no assigned branch and remain excluded.

Affected allocated source locations are marked dirty through the existing dashboard worker. Telegram, cash threshold groups, branch statuses and allocation recommendations continue using the same snapshot value. New count sessions use the live summary; frozen count balances remain unchanged.

## Evidence

- Before applying the migration, regression showed split payroll balance -15,000 instead of -5,000 and full-transfer balance -15,000 instead of zero. Existing income/expense feed already returned the correct branch portion.
- Local migration up succeeded. Transactional replay restored the previous summary definition, reapplied this migration, and confirmed the resulting definition hash matched (`replay_matches = true`); rolled back afterward. This is a focused replay, not a full fresh database reset.
- `supabase/tests/payroll_branch_balance_test.sql`: 116 assertions pass. Covers legacy, transfer-only, branch-only, split, zero, pending, cancellation, approval business date, outside-system, moving branch, partial/paid/overpaid/removed slips, retained transfer history, source deletion, frozen count balance and operating ratio (15,000 / 100,000 = 15%). Fixtures roll back.
- Full Local pgTAP: 74 files / 1,831 assertions PASS, including existing payroll allocation permissions/Report Lock, dashboard scheduling, cash counts, threshold alerts and source-owned transfer tests.
- Local database lint: no errors; existing unrelated warning `public.get_payment_bundle_candidates`: unused `p_account_number`.
- Generated the summary object in `supabase-schema.sql` from the Local `public,private` dump, preserving other in-progress schema snapshot changes.
- Follow-up scrutiny fixed compatibility overview bank-funded balance via migration 20261031041000 and added redacted JSON catches to overview/snapshot routes. Focused route/payment checks 37 PASS, TypeScript/targeted ESLint/source-size/import-direction checks PASS; browser UI unchanged. Shared invalidation already covers old/new branch snapshots, branch summaries, income/expense and money history. See payroll-branch-balance-scrutiny-20261031.md for repro and experiment ledger.

## Scope

Local only. No Cloud migration, deployment, commit or push. Existing working-tree edits from other tasks are preserved. The repository and memory contract now explicitly distinguish full operating cost from branch-funded balance effects.
