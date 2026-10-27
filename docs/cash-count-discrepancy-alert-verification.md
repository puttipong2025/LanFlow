# Cash-count discrepancy alert verification

## Intent and scope

Compare the latest active count's stored signed difference against one optional group threshold. Keep one count candidate per branch, the existing alert RPC/timer, group form and financial lock rules. No new alert kind, queue, cron or persistent alert state is needed. Work is local; Cloud migrations and push require a separate instruction.

## End-to-end trace

- Form empty/zero/positive → group Route validates finite nonnegative two-decimal bounds → eight-argument RPC uses an explicit update flag → existing six-argument save holds group/branch fences and auth → nullable threshold update in the same transaction. Three/six argument clients omit the new field and preserve it. New function revokes PUBLIC/anon execute.
- Alert RPC obtains existing money/weight response; joins eligible branch memberships; selects one active count ordered by created_at/id descending before filtering its stored difference. Count due dates continue using the separate cutoff-based rule. Threshold null disables, zero alerts nonzero differences, equality does not alert; checked status is irrelevant. Missing system balance is not converted to zero or rederived from current ledger.
- One count candidate includes overdue days and optional signed discrepancy/count time. Counts retain their old meaning; the parser remains compatible with old payloads. Group rows merge count and lock status by branch, preserving both reasons and existing authorized unlock action, with thresholds in the group header.
- Auth fetch already emits mutation invalidation. The existing alert hook now consumes the same event/storage key for silent refresh. Dirty in-flight reads are discarded and followed by another read. Open results update; acknowledged dialogs stay closed during silent refresh. Scheduled/manual behavior and polling interval remain shared with money/weight.

## Experiment ledger — 2026-10-27

| Run | Observation | Action/conclusion |
|---|---|---|
| DB1 | First12 assertions passed, then the test called nonexistent review_cash_count | Source trace identified the existing check_cash_count RPC; fixed test fixture, not production review behavior |
| DB2 |19 assertions passed | Expanded boundary/sign/combined/latest tests |
| DB3 | Disabling discrepancy still returned a valid overdue-only candidate | Corrected test to assert discrepancy=null while preserving overdue; disabling discrepancy must not disable the old due rule |
| DB4 | Tie test expected `none` although actual UUID ordering selected the older discrepancy | Probe printed fixture count IDs/timestamps only. PostgreSQL resolved unqualified ORDER BY id to the CASE output alias (text). Qualified c.id in the expected subquery; production lateral query already uses UUID ordering correctly |
| DB5 |24 feature assertions passed | Negative sign, precision, exact-cent boundary, tie ordering, latest deletion fallback, null/zero, review and permissions verified |
| Logic |14 tests passed across new and overdue logic suites | New parser/merge/route contract plus previous queue/permission behavior pass |
| UI1 | Initial three feature browser scenarios passed | Mobile group/row/header/unlock, open/acknowledged refresh and form zero/null paths verified |
| Harness collision | Concurrent full verify started a second Next dev sharing .next with browser tests; login timed out with zero upstream requests and browser hit missing generated route.js | Stopped this test run; no unrelated process or stateful service was reset. Run browser and full verify serially; do not diagnose business logic from the shared build artifact collision |
| UI serial |10 tests passed (setup,4 new scenarios,5 overdue regressions) | Latest response wins during invalidation; threshold/form/row/lock paths pass without shared build interference |
| Shared UI | Two old-suite startup budgets failed before completion (5-second initial shell wait and30-second whole integration budget) | Scratch config under ignored output kept identical tests/assertions and used20-second expectations/90-second test budget; all6 money/weight scenarios passed (8 including setup entries). No production behavior was changed to mask these timeouts |
| Real API | Authenticated local group POST → session → count submission → alert RPC → legacy edit/equality/zero/null/list passed |2 tests including setup; no RPC mocks in this test. Fixture rows cleaned by generated location ID. Windows Node emitted a shutdown assertion after the test, but the runner exited0 |
| Full database |59 files/1385 assertions and2 concurrency tests passed | Existing due/financial-fence/unlock/queue-related DB contracts retained |

## Query and UI inspection

- Local EXPLAIN for latest-active branch count uses a small scan/sort (estimated cost1.24) on the small local fixture dataset. No new index was justified by that evidence; this is not a production-scale performance measurement. The alert uses one SQL query, not a network request per branch.
- Mobile390px screenshot shows group thresholds in the header and overdue/discrepancy/lock inside one branch row, without horizontal overflow. Screenshot is a local automated fixture, not production acceptance.
- Removed the replaced count-filter/render branch from the old money/weight rendering path. Shared lock notice adds only an embedded presentation option; existing standalone notice behavior remains.

## Final gate

- `npm run verify` passed: lint, typecheck, source-size/import rules, login auth outage (19741ms, zero Supabase requests),615 isolated tests/2 opt-in live-OCR skips, production build, SW and bundle guards. Route first-load268.5kB/320kB; payroll chunk budget unchanged.
- `npm run test:db`:59 files/1385 assertions and2 real concurrency scenarios passed.
- Dedicated logic/overdue suite14 passed. Initial serial UI10 passed (4 new scenarios,5 overdue regressions,setup). Extended feature UI7 passed (6 scenarios,setup), adding cross-tab refresh, retained input on save failure/null reload and selected-branch change during a held read. Follow-up test-file lint/typecheck passed.
- All6 shared money/weight scenarios passed in the expanded cold-start scratch config (8 entries including setup). Actual new-feature API test passed (2 including setup), traversing real authenticated Route/RPC/database without RPC mocks.
- The existing alert scope is all accessible branches, not the currently selected branch. Verified that branch selection does not resurrect a dismissed alert; the existing abort/active guard remains keyed to user/role/access scope.
- Test scratch config initially had a TypeScript webServer spread error; replaced that ignored config's server declaration with explicit typed fields and reran full verify successfully. No production config was weakened.
- No unused production imports/functions were left by this change. The superseded count-specific rendering filter was removed, retaining the shared cash/weight renderer.

Scrutinize verdict: ship locally. Group setting → RPC/constraints → latest-count selection → one-candidate parser → merged group rows → mutation/race refresh all traced and verified, with no unresolved blocker in these paths.

Migration20261027010000 is local only. During a later authorized rollout, apply matching database/application changes and refresh clients before enabling thresholds; defaults remain null. No production-scale performance, external OCR, physical-device or hosting-deployment acceptance is claimed. No production data or secrets are included in this document.

## Compact presentation follow-up — 2026-10-27

User confirmed the exact compact format: group/due-days/threshold on one wrapping header; branch/overdue/lock on the first line; latest short Thai date/time and signed shortage/surplus on the next; unlock action below. Embedded lock notices omit the duplicate branch title and long locked explanation; standalone notices, contact guidance, temporary-grant countdown and permissions remain unchanged.

Updated existing UI assertions to target the approved combined heading and short lock status. An initial run still used old text expectations and was superseded; final serial run passed12 entries (setup,6 discrepancy scenarios,5 overdue regressions). Targeted lint and full typecheck passed. Mobile390px screenshot inspected: no horizontal overflow and all three compact lines plus unlock action visible. No database/business-rule change or additional migration was introduced by this UI follow-up. No push/Cloud action performed.

## Scrutiny follow-up: independent membership snapshots — 2026-10-27

- Repro: one branch had a count candidate from group A and a separately fetched lock state from group B. The real countAlertGroups helper placed the B lock/action under A's thresholds; the new test failed before the fix.
- Trace: LanFlowApp runs useRubberWeightAlert and useCashCountLocks independently. A membership move can land between responses; both snapshots are individually valid. The merge previously matched only locationId. Source trace was used for this pure helper, with no attached debugger.
- Ranked explanations: independent membership snapshots (confirmed), duplicate branch records (ruled out with a single candidate/single lock), corrupted permissions/time fields (ruled out with otherwise valid states). The four existing controls passed before the fix, including same-group merge and lock-only rendering.
- Minimal fix: merge a candidate and lock only when their group IDs match. On mismatch retain the candidate alone until refreshed snapshots agree; the separate selected-branch lock notice and server-side guard remain authoritative. No new fetcher, state table or timer was added.
- Focused logic/Route regression28 tests passed after the fix. No unused production function/import was confirmed in this scope. This follow-up remains local and is not pushed/deployed.

## Cloud migration and main release — 2026-10-27

- User explicitly authorized main push and Supabase db push after review. Final rescan passed616 isolated tests/2 live-OCR skips,1385 database assertions,2 concurrency scenarios, lint and typecheck. Compact UI12 passed in the preceding gate.
- Linked target `psxwhhwjmolqperxrlzj`; dry-run showed only20261027010000. Backed up affected RPC definitions and group configuration under ignored output/discrepancy-cloud-before.json; this additive migration does not delete/rewrite existing counts or ledger data.
- Cloud rehearsal inside BEGIN/ROLLBACK with bounded lock/statement timeouts returned new_rpc_ready=true. Actual linked db push then applied20261027010000 successfully.
- Independent catalog/history checks confirm nullable threshold/constraint, new authenticated RPC and anon denial, legacy3/6 signatures, updated alert RPC and preserved financial guard. Configured thresholds=0, preserving existing off-by-default behavior.
- Follow-up linked dry-run: Remote database is up to date. CLI emitted a nonfatal pg-delta cache certificate warning after application; no repair/reset was needed because catalog/history checks passed.
- Main commit/push includes the compact UI and independent-group snapshot guard. Hosting rollout completion and physical-device acceptance are not asserted by the database receipt. Earlier local-only notes above record the pre-release state.
