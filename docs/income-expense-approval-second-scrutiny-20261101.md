# Second scrutiny — Income/expense approval — 2026-11-01

Goal: verify current approval settings, decision/submission business logic and routes again after the first fixes. Keep valid request handling, authorisation and mobile table behaviour; reuse the existing cache helper rather than introduce a new route or persistence system.

## Experiment ledger

1. Read the current guarded routes/response parser, settings mutations, setting action wrapper, offline date guard and callers. The surprising seam is settings query effect / acknowledged mutation → localStorage write: optional local persistence can throw after the database has already succeeded.
2. Strict TypeScript scan with noUnusedLocals/noUnusedParameters passed without diagnostics. No additional dead exports/call sites identified in the reviewed scope.
3. Initial runnable production-module repro `income-expense-approval-cache-scrutiny.spec.ts`: 5 failed / 3 passed. Blocked localStorage getter and quota failure escaped; failed replacement left the old policy; production post-commit callback rejected before refreshing.
4. Node inspector paused inside the actual save helper and throwing storage getter: browserStorage threw during default-argument evaluation, before the read helper's existing try/catch. Error escaped (`approval-second-debug.log`). No product instrumentation added.
5. Disproof controls after debugger: normal storage, SSR without storage and normal production post-commit callback all passed (3). Thus the auth/Route/RPC is not needed to reproduce this bug and the helper is not universally failing.
6. Split getter read/write and inspect stale state even when the old write throws. Both read and write fail with blocked access, and the old relaxed policy survives failed writes even when removal is possible. These deterministic inputs narrow the fix to optional storage access/write handling.
7. Expanded red run: 7 failed / 3 controls passed. After the helper-only fix, 105 focused tests passed, including all 10 cache regressions, 31 prior Route/acknowledgement regressions, settings mutations and offline-date guards. The exact debugger harness now observes the same accessor exception contained and reports completed:true (`approval-second-debug-fixed.log`).
8. Targeted ESLint passed. A later whole-workspace TypeScript run found five TS2339 errors in the independently changing payroll test `tests/time-payroll-slip-document.spec.ts` referring to deductionRows; no cache-scope diagnostics. Do not change unrelated payroll code or claim this original-workspace typecheck passed. Verify the reviewed cache code in the coherent isolated snapshot and check the original workspace again only after an evidence-bearing change.
9. Actual browser/API settings suite: 13 passed (1.3m). The added case throws QuotaExceededError only for the approval cache, toggles the real date rule, verifies success UI, queries the actual DB value, confirms stale cache removed and checks zero page errors; restores the original DB date rule in finally. Existing offline/conflict/lost-response/draft/manager/decision tests also passed. No SQL or Route implementation edits in this round.
10. Original workspace production-source-only TypeScript with strict unused checks passed with no diagnostics (`approval-second-source-types.log`). The two payroll files responsible for the five test type errors remain byte-identical to their failed-check versions; do not claim those errors resolved.
11. Full npm verify passed in the coherent isolated snapshot: lint/type/source-size/import/auth-outage, 1,164 isolated passed / 2 existing skips, production build/SW/bundle passed; first load294.8/320kB. Current cache source and three test/config files are byte-identical to the verified snapshot. This is a snapshot verification, not a claim that unrelated payroll test errors in the live workspace passed. No SQL/Cloud/commit/push/deploy; no full DB rerun.

Ranked hypotheses, checked against every run:

- Storage accessor outside the protected body explains blocked reads/writes; ruled out if a default-argument read remained safe (it threw).
- Uncaught setItem explains post-commit callback rejection; ruled out if normal callback also rejected (it passed and refreshed).
- Old persisted policy remains trusted after replacement failure; ruled out if the loader returned missing cache (it returned false policy).
- RPC/permission failure caused the reported save failure; ruled out because the direct acknowledged callback reproduces with no RPC/auth call.

## Minimal fix

Contain blocked storage access and optional writes in `src/lib/income-expense/approval-cache.ts`. On failed write, try to remove the old cache and mark that Storage object unusable for reads in this module session even if removal also fails. A later successful write restores trust. Keep the existing offline date guard: missing/untrusted cache blocks non-current dates, while today's date retains existing behaviour. No SQL/Route/UI changes required.

## Finding — Major: optional cache failure can report a successful server save as failed

`src/hooks/useIncomeExpenseApprovals.ts:181` writes the cache from an effect; `:279` writes it after the database acknowledgement in onSuccess. Previously `approval-cache.ts` let a blocked localStorage accessor or setItem throw. That rejected the acknowledgement callback before refresh or escaped the query effect. A prior relaxed date policy could remain persisted after a stricter replacement failed.

Evidence: production-module red tests, debugger paused at the accessor/default argument, normal controls and the actual browser/DB quota case. Fix: safe accessor at `approval-cache.ts:11`, contained write/invalidation at `:22`, untrusted-instance read guard at `:38`. Successful writes clear the in-memory invalidation; removal is best effort. If removal is denied, the guard applies to the current module session, not permanently across browser restarts.

## Dead code and Route review

No additional unused function/variable/import was established; no deletions made speculatively. Re-exercised the prior 31 decision/submission Route and client acknowledgement cases, settings mutation checks, date guards and polling/error-contract tests in the 105-case focused suite. The existing shared response parser and outer Route boundaries remained valid under these cases; no new Route change justified.

Verdict: fix-then-ship for the live workspace because five unrelated payroll test type errors remain. The approval cache change itself passes source types, focused regressions, real browser/DB workflow and the complete coherent-snapshot build.
