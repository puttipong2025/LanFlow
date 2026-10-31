# Third scrutiny — Income/expense approval — 2026-11-01

Goal: verify approval settings/business logic/routes after previous fixes; focus on caller contracts, scope isolation, duplicate checks and malformed responses. Prefer aligning an existing condition with the database over adding APIs or new abstractions.

## Experiment ledger

1. Traced settings form → settings action → typed keyword insert → RLS/unique index → read acknowledgement; re-read submission/decision routes and cache. Found UI duplicate guard ignores appliesTo while the database unique key includes it.
2. Actual migration `20260707040000_income_expense_approval_workflow.sql:35` and read-only pg_indexes query agree: active key is `(lower(trim(keyword)), applies_to)` where active and deleted_at null.
3. Actual-browser repro first stopped at an exact select-label lookup (nested select label includes its option text). Changed only the test selector to the first combobox in the keyword section, then reproduced the product failure: same text expense→income remains one row, not two; duplicate error blocks the insert. Seeded fixture cleaned up in finally.
4. Actual production form unit matrix before edits: 6 failed / 4 controls passed. All six different-scope combinations were rejected, while three same-scope checks and a disabled same-scope replacement behaved correctly.
5. Node inspector attached to actual form onSubmit and observed writes:0 / duplicate issue for expense→income (`approval-third-debug.log`). No production probes added. Source trace narrows to the local some(...) predicate before candidateId creation and action.run.
6. Disproof controls rerun after debugger: four passed (three same scopes + disabled replacement). Two initial control invocations via npx.cmd had their pipe-containing regex interpreted by cmd; reran the same controls through Node's Playwright CLI, which preserves the regex. These shell failures were not product failures.
7. Minimal one-condition fix (`item.appliesTo === appliesTo`). The same debugger harness now reports writes:1 / issue:null for expense→income. Ten matrix/replacement tests pass; the full focused suite of approval settings, Route response contracts, cache/offline guards and polling safety passes115 (6.4s).
8. Targeted ESLint, original-workspace production-source TypeScript with noUnusedLocals/noUnusedParameters, whole coherent-snapshot TypeScript with the same unused checks, source-size ratchet and scoped diff check pass. Five reviewed product/test/config files match the isolated snapshot byte-for-byte. No code from unrelated ongoing payroll work changed here.
9. Actual browser/API settings suite14 passed (1.9m), including creating income rule with a distinct threshold beside its same-text expense rule, same-scope duplicate prevention before any write, keyword disable, cache quota failure, drafts, CAS conflicts, offline, read failure and all three approval/rejection endpoints. The new real DB fixture is deleted in finally. No full build/DB suite rerun for this one-condition UI business check; previous full verify counts are not claimed as this round's results.

Ranked hypotheses after debugger:

- UI duplicate predicate omits the scope; disproved if different scopes reached add despite the local duplicate issue (they did not).
- Database disallows different scopes; disproved by actual unique-index definition and later actual INSERT/DB result check.
- Disabled rules block replacement; disproved by disabled control passing.
- Scope selector didn't change state; disproved by the production form matrix setting state directly (all different-scope pairs still failed).

## Finding — Medium: independent income/expense keyword rules incorrectly blocked

`src/components/income-expense/IncomeExpenseApprovalSettings.tsx:113` rejected any same text even if its appliesTo differed. Users could not set a distinct income threshold/match mode while retaining the existing expense rule, despite the database's supported key. Add `item.appliesTo === appliesTo` to the existing duplicate predicate. Preserve text normalisation, active-only checks and database final uniqueness enforcement. No Route/SQL change required.

## Dead code

No new unused variable/import/function proven in the reviewed paths. Production-source strict TypeScript unused check is run separately from independently changing test files. Keep the shared acknowledgement and optional-cache helpers because current callers use them.

Verdict: ship for the scoped change. The keyword form now follows the existing active text-and-scope database uniqueness contract, and same-scope safety remains verified. No new Route/API/schema, commit/push or Cloud deployment.
