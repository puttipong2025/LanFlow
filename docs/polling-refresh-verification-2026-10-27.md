# Polling and refresh verification — 2026-10-27

Scope: reduce idle requests in four client flows without changing server authorization, financial approval rules, database schema, or stored snapshots. This is local working-tree verification, not a deployment receipt or production cost measurement.

## Behavior

- Cash transfer pending queue: 60 seconds when empty or in error/no-data state; 15 seconds with confirmed pending work. Existing mutation invalidation remains immediate. Invalid summary payloads become errors rather than empty queues.
- Evidence history: no feed interval or focus refetch. Entering history, changing filters, explicit refresh, pagination, and existing mutation invalidation still load data. Pending feed and the separate direct-Supabase overview retain their existing polling.
- Browser approvals: 60 seconds idle; 15 seconds with requests or while the Admin employee section is open. Only LanFlowApp outside Admin or AdminContent inside Admin owns the timer. Errors back off to 60 seconds; hidden-tab interval suppression remains.
- Approval-group settings: no interval; always refresh on mount and browser-tab visibility return, including fresh cache. Saves refresh management state, including auto-reset and lock toggles. Existing drafts, confirmation revisions and approval snapshots remain unchanged.

The evidence filter toolbar was extracted to RubberEvidenceFilters because the existing module has a source-size ratchet. It uses the existing theme, native keyboard controls, visible focus, a labeled refresh button, busy/disabled states and adjacent errors. No new dependency, animation or global polling mechanism was added.

## Reproduction and experiment ledger

| Run | Observation | Conclusion/action |
| --- | --- | --- |
| Before changes | Empty cash queue made 3 interval requests in 46 virtual seconds | New test reliably exposed the 15-second idle timer |
| Before changes | Empty browser queue made 1 interval request in 46 virtual seconds | New test exposed the previous 30-second idle timer |
| Initial history test | Existing threshold alert intercepted clicks | Added test-only acknowledgment handler; did not weaken product alerts |
| First typecheck | Query callback inference made cash data unknown | Added explicit pending-result type; typecheck passed |
| First settings visibility test | Dispatching a non-bubbling event on document did not reach TanStack's window listener | Inspected installed focusManager, dispatched visibilitychange on window; production refetch options already worked |
| Runtime hook tests | VM promises were not recognized by matcher promise wrappers | Awaited production callback results before assertions; no product workaround |
| Existing cash regressions | Ambiguous column name, incorrectly sorted feed fixture, blocking unrelated alert | Corrected only test selector/order/acknowledgment |
| Existing cross-window polling test | Still assumed new work appears within 20 real seconds | Advanced destination virtual clock through 61 seconds; confirmed actual server-created transfer appears |

## Request results

Initial loads are excluded. API/RPC requests from other features are not included.

| Flow | Baseline | Verified after change |
| --- | --- | --- |
| Empty cash queue | 3 requests / 46 seconds, measured | 0 / 46 seconds; 1 by 61 seconds |
| Cash work/error transitions | Fixed 15-second interval in source | Work uses 15 seconds, cleared work uses 60, errors recover on slow interval; 21 total with 20 displayed rows tested |
| Idle browser approvals | 1 request / 46 seconds, measured | 0 / 46 seconds; 1 by 61 seconds |
| Managing browser approvals | Previous fixed 30-second interval in source | One request in 16 seconds and two in the next 30, with both observers mounted |
| Browser pending → empty | Previous fixed 30-second interval in source | Switches 15 → 60 seconds; no duplicate timer after leaving employee section |
| Evidence history | Previous 60-second feed interval in source | 0 periodic feed requests / 121 seconds; keyboard refresh works |
| Two history pages | Installed infinite-query implementation refetches loaded pages | 0 periodic requests / 121 seconds; one manual action refetches both pages exactly once and preserves page identity |
| Approval-group settings | Previous 60-second interval in source | 0 periodic requests / 121 seconds; one visibility refresh and one remount refresh; draft preserved |

Browser approvals intentionally increase request frequency while work is pending or management is open. The idle reduction does not establish a net CPU or billing percentage. Multiple browser tabs retain independent caches and timers; there is no cross-tab leader election.

## Validation

- New UI behavior suite: 5 passed in the final run, including hidden-tab suppression and visible-tab recovery.
- Isolated suite: 621 passed, 2 existing live-OCR tests skipped (623 total).
- Cash UI/error and browser-badge regressions: 10 passed, including cross-window transfer discovery and mutation/error flows.
- Local pgTAP: 155 assertions passed across rubber_price_policy_without_quota_test.sql, rubber_price_allowance_auto_reset_test.sql and rubber_price_allowance_auto_reset_lock_test.sql.
- Lint, typecheck, source-size/import rules, login-outage check, production build, service-worker checks and bundle budgets passed. Initial-route budget: 268.7 kB / 320.0 kB.
- Mobile 390px evidence refresh layout inspected; no horizontal page overflow; keyboard activation tested.

## Boundaries and pre-existing observations

- A broader, unchanged Rubber Bill integration test, `approval route classifies a corrupted pending payload as an internal failure`, expected HTTP 500 but received 400. Its serial suite then skipped 19 later cases. This is not counted as a passing suite. That Rubber Bill approval route, its error mapping and migrations were left unchanged. The current isolated error-contract tests and focused database policy tests passed.
- Local dashboard branch-summary requests emitted `Dashboard branch summaries contract mismatch` (HTTP 500) during unrelated initial dashboard loading. That endpoint was not changed; the targeted cash, evidence and approval tests separately verified their own requests. No production diagnosis is claimed.
- No commit, push, Cloud migration or deployment was performed. Post-deployment CPU/cost tracking remains separate from implementation acceptance.

## Scoped scrutinize verdict

Ship for the local polling scope: traced both browser observers and their timer ownership, cash mutation invalidation through scoped query keys, history feed versus overview RPC, pagination refetches, and policy-save callbacks through the existing server/snapshot contract. No unresolved blocker was found in the changed flows. The two pre-existing observations above remain separate work; this verdict does not declare those endpoints fixed or constitute production acceptance.

## Follow-up business/route safety scan

Scope: the four refresh flows and their browser-approval, cash pending-summary and evidence-feed GET boundaries. Framework route exports were preserved. A TypeScript scan with noUnusedLocals/noUnusedParameters found no unused local functions, variables or imports. The unused `error` result from useRubberEvidenceFeed was removed after checking its only production consumer; `isError` and retry behavior remain.

Confirmed failures and fixes:

- Browser RPC data such as null, an object instead of users, or a missing pending array could be published as HTTP 200 and poison the hook cache, then break polling/badge reducers. A small shared contract now rejects these at the route (503) and client query boundaries. The public BrowserApprovalUser type import path is preserved through a type re-export.
- Cash RPC null/malformed summaries previously masqueraded as a successful empty queue. A shared predicate now verifies totals, the 20-row bound, usable row identities/names and finite nonnegative amounts on both server and client. Invalid results return an opaque JSON 500 rather than a false empty success.
- Evidence UUIDs and cursor positions now validate before RPC. Invalid caller values return 400 without a database call; owner/location/filter cursor scope checks remain.
- Evidence RPC responses now require bounded object rows with valid identities/revisions and coherent next-page metadata. A hasMore response without a usable cursor becomes an explicit error rather than silently hiding additional pages.
- Cash/evidence GET RPC exceptions now return opaque JSON errors. Authentication, branch access and valid empty results remain unchanged.

Experiment ledger:

1. Initial regression run: 6 failing cases and 6 passing controls confirmed the gaps. Valid empty and unauthorized cases disproved the alternative hypothesis that any empty queue/auth path was inherently broken.
2. After boundary fixes: 20 focused tests passed, including valid cursor round-trip with microseconds, foreign-owner rejection before RPC, and opaque error handling. Additional empty-row counterexamples initially failed, then passed after row validation.
3. Follow-up TypeScript inference failure was corrected by keeping the decoded users value unknown until validated, rather than restoring a type assertion.
4. Full isolated rescan: 629 passed, 2 existing live-OCR skips. UI/API checks: 6 refresh/live-route cases passed; existing badge test passed separately after its initial 5-second cold-start wait proved too short. Its wait was corrected without weakening badge assertions.

This follow-up changes only the named GET boundary validation and failure handling; it does not claim to fix the two unrelated observations above. The final production build passed, as did lint, strict TypeScript/unused checks, service-worker checks and bundle budgets. Verification and scope are also recorded in the Daily note and Query Refresh Policy memory.

## Second scan: mutation acknowledgements and auth response parsing

- `POST /api/lanflow/cash-branch-transfers` now rejects null/malformed RPC acknowledgements and catches RPC exceptions with opaque JSON 500 errors. A valid result requires a UUID and `status: synced`.
- Idempotent replay can legitimately return a different canonical transfer ID; equality with the submitted ID is deliberately not required. No automatic write retry was added. An error response alone does not prove that the transaction rolled back.
- `src/lib/auth-fetch.ts` safely handles JSON null on 401/409 while preserving session-revocation redirects and cash-count lock events.
- No additional unused code was found by strict TypeScript unused-local/parameter checks in this scan.

Experiment ledger:

1. Initial mutation regression: four failures reproduced malformed-success, uncaught RPC exception, and null auth-response paths; three valid/auth controls passed.
2. Minimal route contract/catch and two null-safe reads fixed the cases. A test fixture initially used the wrong overdue code; it now imports the canonical constant. This was a test correction, not a product bug.
3. Clean full isolated run: **637 passed, 2 existing live-OCR skips**. Lint, strict TypeScript/unused checks and source-size checks passed.
4. Browser-approval UI: three passed. Cash UI creation and receive flows passed in one run, but the terminal approval flow timed out. Increasing the test limit did not establish a pass and was reverted. A subsequent trace failed earlier while opening transfer details: create returned 200, detail GET was unfinished at timeout, and the known dashboard summary route returned 500. The trace did not reach the decision POST, so it cannot identify the approval root cause. No speculative production change was made for this unstable UI path; it remains an open verification limitation.

Final serial production build passed (exit 0), followed by service-worker and bundle guards. First load remains 268.8/320.0 kB. One earlier build was invalidated by starting the login-outage dev check concurrently against the same output directory (`/_document` missing); the owned check processes were stopped and a fresh standalone build passed. The login probe printed a successful zero-upstream-request assertion, but its interrupted process is not counted as a clean test pass. Time/Payroll import-direction checks also passed. Do not infer a full UI-suite pass or production deployment from the isolated regression count.

## Third scan: terminal cash-delete decision contract

Intent: prevent a terminal approval UI from treating an invalid database acknowledgement as a successful decision. The smaller solution is validation/catch in the existing route, without a new abstraction or financial/schema changes.

Trace: `IncomeExpenseApprovalModal.runDecision` awaits the approval mutation, which POSTs to `cash-branch-transfers/delete-requests/[id]/decide`. Previously that route returned any RPC data as HTTP 200. SQL `20260727020000_cash_transfer_terminal_delete_approval.sql` returns exactly the request UUID and submitted decision. A null or mismatched acknowledgement therefore cannot establish success.

Ledger / competing hypotheses:

1. Invalid RPC data accepted as success: reproduced by null/empty/mismatched results; initial regression failed with 200 instead of 500.
2. Thrown RPC error escapes JSON handling: reproduced by injected exception; initial test rejected instead of producing JSON 500.
3. Broken authorization or input gate: disconfirmed by unauthorized/invalid controls returning 403/400 before any RPC, while valid approved/rejected controls returned 200.
4. Case-sensitive UUID comparison could reject valid PostgreSQL normalization: added a mixed-case request control and compare validated UUIDs case-insensitively.
5. These acknowledgement failures explain the earlier UI timeout: unproven; no claim is made that this patch fixes that timeout or awaited query invalidation.

Baseline: 2 failed, 10 passed. Fix: validate `requestId` and `status` against the submitted request and catch RPC exceptions through the existing opaque error helper. No automatic retries; response failure does not prove transaction rollback. Full isolated regression after the fix: **642 passed / 2 existing live-OCR skips**. Strict TypeScript/unused and source-size checks passed; no additional dead code was identified. This scan does not claim a new browser-suite or production-build pass. Earlier UI verification limitation remains open: **fix-then-ship** pending terminal-deletion UI verification.

## Fourth scan: cash receipt boundary

Intent/simplification: validate the receipt acknowledgement inside the existing route; no new helper/module, retries or financial/schema changes.

Trace: `useCashBranchTransfers.receive` accepts successful HTTP responses and refreshes money-flow views. The receive route previously published arbitrary RPC data with HTTP 200 and left thrown exceptions uncaught. The current SQL contract in `20260727020000_cash_transfer_terminal_delete_approval.sql` returns `id`, `status: synced`, and numeric `difference`.

Ledger:

1. Hypothesis: invalid acknowledgement can claim receipt success. Null/empty/wrong-identity/wrong-status/wrong-difference tests reproduce the problem independently of input validation.
2. Hypothesis: a thrown transport/RPC exception escapes the route contract. Injected throw reproduces rejection instead of opaque JSON 500.
3. Alternative: valid discrepancy handling or UUID normalization is broken. Controls for zero/negative/positive differences and uppercase UUIDs passed before the fix, disproving this alternative; malformed input also returns 400 before RPC.
4. Baseline: 2 failed / 15 passed. Minimal fix: validate identity case-insensitively, synced status and finite numeric difference, then catch RPC exceptions with the existing error helper. No write retry or rollback assertion. This does not establish the root cause of the earlier browser timeout.

Final verification: **646 isolated tests passed / 2 existing live-OCR skips**; lint, strict TypeScript/unused checks, source-size and diff whitespace checks passed. No additional proven dead code was removed. Browser tests and production build were not rerun for this small route-only patch. Existing terminal-deletion UI verification remains open; verdict remains **fix-then-ship** for the combined work.

## Fifth scan: cash edit and delete acknowledgements

Intent/simplification: finish the PATCH/DELETE mutation boundaries in the existing per-transfer route, using its existing authorization and public-error mapper rather than introducing a new layer.

Trace: `useCashBranchTransfers.update/remove` treat HTTP success as a committed update/delete (or pending approval) and refresh views. PATCH SQL `20260723010000_cash_branch_transfers.sql` acknowledges the transfer ID and synced status. DELETE SQL `20260727020000_cash_transfer_terminal_delete_approval.sql` acknowledges either deleted or pending_approval with a request UUID. The routes previously returned any RPC payload as 200 and let RPC throws escape.

Ledger and competing hypotheses:

1. Malformed success is a server-boundary issue: null/empty/foreign ID/wrong status and missing pending-request ID reproduce false HTTP 200 responses.
2. Transport throws bypass JSON failure handling: injected RPC exceptions reproduce rejected handler promises.
3. Authorization/input/conflict rules are responsible: disconfirmed by passing 401/400-before-RPC and public 409 controls, as well as normal update/direct-delete/pending-approval controls.
4. UUID normalization could break valid responses: uppercase UUID requests with normalized acknowledgements are covered as successful controls.
5. Relation to prior UI timeout: unproven; no timeout-fix claim.

Baseline: 4 failed / 21 passed. Fix: validate matching transfer identity/status and require the pending-approval request UUID; catch exceptions with opaque JSON 500 using the existing error mapper. Valid responses and public errors are preserved; no automatic write retry or database rollback assumption.

Final verification: **654 isolated passed / 2 existing live-OCR skips**; lint, strict TypeScript/unused, source-size and whitespace checks passed. No further proven unused code was found. No browser-suite, new production-build or deployment claim for this scan. Combined-work verdict: **fix-then-ship**, pending the previously recorded terminal-delete UI verification.

## Sixth scan: close the terminal-delete UI verification gap

Intent: distinguish dev compilation and browser-test timing failures from a business-route failure before adding more product code. Simpler outcome: correct the test timing and strengthen acknowledgement assertions, without changing business logic.

Ledger / differential:

1. Started one workspace-owned dev server after confirming port 3000 was free. Initial login compilation took about 20 seconds, authenticated root compilation another 18 seconds. The first traced UI run failed reading the create response through CDP (`Network.getResponseBody` unavailable), before terminal deletion; this does not establish a server-create failure.
2. Reused the same server. The next trace reached the transfer-detail assertion at about 39 seconds into a 45-second test. Detail route recompiled in 4.1 seconds and returned HTTP 200 in 5.332 seconds, beyond the default 5-second assertion. This disproves treating that observation as a permanently stuck detail route. No database blocking or production timeout cause is inferred.
3. Corrected only this long UI scenario: 120-second total allowance, 15-second detail/success waits, and explicit decision POST HTTP 200 plus approved acknowledgement checks. Original field, financial difference, offline, row and decider assertions remain. No production timeout/retry change.
4. Focused workflow passed in 37.3 seconds, including real create, receive, pending-delete request, terminal decision, success toast and populated decider cell.
5. Full related UI regression: **7 passed in 57.5 seconds** (browser approval 3, cash transfer 4). Terminal-delete workflow passed again in 20.5 seconds; cross-window queue refresh passed in 13.2 seconds. These successes close the earlier terminal-delete UI verification gap; they do not prove every historical timeout had one cause.

The dev server created for this check was stopped after proving listener PID 15256 belonged to workspace Next launcher PID 29544; port 3000 released. No further dead code was found by strict unused checks. Changed test passed lint and whitespace checks. The latest business-code isolated run remains 654 passes/2 existing skips (prior scan), not a newly rerun isolated suite. No new production build, Cloud change or deployment. The unrelated Dashboard branch-summary contract mismatch still appeared; no claim that it or the earlier Rubber Bill integration mismatch was fixed. Scoped verdict: **ship** for the UI timing/assertion correction; do not interpret it as an all-project deployment approval.

## Seventh scan: local Dashboard contract mismatch traced to partial test snapshots

Intent/simplification: determine whether Dashboard HTTP 500 comes from invalid read-model data before weakening the server's validation. The smaller correct fix is a complete typed test fixture and recalculation of the affected local derived snapshot; no production-route/schema change.

Trace: `get_dashboard_branch_summaries` projects the snapshot's cash, inventory and purchase fields; the route validates all required fields before UI consumers. A local test branch with code/name matching the cash-threshold test fixture held only `{netCashFlow}`. Four other saved snapshots had complete read-model keys. `branch-threshold-alert.spec.ts` wrote partial snapshots in both below-threshold and equality cases; `branch-selector-overview.spec.ts` also supplied incomplete purchase metrics. A past interruption or failed cleanup may explain persistence, but its exact mechanism is not proven.

Ledger / falsification:

1. Captured actual RPC output under the existing local manager identity, using a rollback-only read transaction, and executed the production route handler against that data: **5 rows, HTTP 500**. Database inspection exposed exactly one partial snapshot. This distinguishes persisted bad data from an invented transport-failure mock.
2. Alternative: production schema or all summary data is incompatible. The complete snapshots and existing valid/malformed route controls counter this; no validator change was needed.
3. Added a shared `DashboardSummary`-typed factory and used it in both real-database test fixtures. Added route regression for both threshold values (9999.99 and 10000) and a rejection control for the old partial shape. No missing financial fields are fabricated in production responses.
4. Backed up only the affected derived snapshot to ignored `output/dashboard-snapshot-before-repair.log`. With exact UUID/code/name/partial-shape guards and a 15-second statement timeout, used the existing local queue/claim/rebuild refresh functions in one transaction. Snapshot regenerated from source records, without deleting or changing financial transactions, test branches or groups.
5. Repeated the same actual-RPC/production-handler probe: **5 rows, HTTP 200**. Local snapshot repair is distinct from a production deployment or proof that interrupted tests can never leave fixtures behind.

Verification: **655 isolated passed / 2 existing live-OCR skips**, plus lint, strict TypeScript/unused, source-size and whitespace checks. No further unused code identified. Full cash-threshold/branch-selector browser integration and production build were not rerun this scan. Earlier terminal-delete UI 7-pass receipt remains from the previous scan. This closes the observed local Dashboard 500 issue; the earlier unrelated Rubber Bill integration 400/500 mismatch remains unresolved. Scoped verdict: **ship** for complete fixture generation and verified local read-model recovery; no Cloud changes or deployment.

## Eighth scan: corrupt persisted Rubber Bill approval payload classification

Intent/simplification: preserve the existing distinction between expected approval rejections (P0001/HTTP 400) and internal stored-data failures (RB500/HTTP 500). Fix at the SQL approval boundary, without weakening HTTP validation, changing calculation rules, or classifying every business exception as internal.

Ledger and competing hypotheses:

1. Rollback-only local repro inserted the same empty persisted proposal as the failing integration case. Actual error: P0001 from `private.normalize_rubber_bill_calculation_payload`, called before the core sync returned a result. Therefore the existing RB500 conversion after the sync call could never run.
2. Alternative: old internal-error migration missing. Disproved by inspecting the installed approval body: its RB500 result-check branch was present. Alternative: HTTP mapping wrong for RB500. Existing isolated route tests confirmed RB500 maps to 500 and business P0001 to 400.
3. Added rollback-only `tests/sql/rubber_approval_corrupt_payload_contract.sql`: baseline failed, expected RB500 but got P0001. Added forward migration `20261027020000_classify_corrupt_rubber_approval_payload.sql`, prevalidating the stored proposal with the existing normalizer inside an RB500 error boundary. Existing permission, missing-request, report/transfer/OCR guards remain outside it. This adds a pure validation pass to the approval path; no claimed performance gain.
4. Rehearsed migration plus the contract in one transaction and rolled back successfully. Applied only this pending migration with `supabase migration up --local`. Contract then passed, retaining pending/unapproved state on corrupt failure and P0001 for a missing request. Function body in `supabase-schema.sql` matches the installed catalog; security-definer/search_path and anon/authenticated execute grants were retained.
5. Original real HTTP integration case now passes (1). Positive integration controls also pass (3): non-current create preserves billDate, manager approves exceptional price without retriggering, and approved delete remains a soft deletion. This closes the prior 400/500 observation without changing its expected status.

Verification: **655 isolated passed / 2 existing live-OCR skips**, **4 targeted live HTTP integration passes**, SQL rollback contract/rehearsal, strict TypeScript/unused, source-size and whitespace checks passed. Local public-schema DB lint reports no errors. Migration checker passed with 8 pre-existing warnings in historical files. No further unused code found. No production build or full 21-case Rubber Bill suite run claimed. Local migration applied; Cloud deployment remains pending. Scoped verdict: **ship** for this error-classification fix after normal migration deployment procedures.

## Ninth scan: isolate Rubber Bill report integration from shared pending work

Intent/simplification: run the previously interrupted full approval suite and distinguish real report guards from test contamination. Reuse the existing branch fixture with an optional assignment user, without weakening report pending-work checks.

Ledger:

1. Full suite baseline: 15 passed, 1 failed, 5 not run. The failed report workflow expected 201 after Rubber Bill approval but received 409 with `cash_transfer_delete_pending`, count 2. This is correct report behavior for a shared branch with unrelated pending work, not evidence that approval or report protection is broken.
2. Assigned a fresh per-test branch to the actual admin using the existing fixture helper; existing callers retain their default assignment. The test still asserts that pending Rubber Bills block report creation, approval enables inclusion, and report-linked mutation is rejected.
3. First isolated attempt reached successful report/approval processing but cleanup failed: approved request history is immutable, so its existing ignored deletion error left an FK blocking source/branch hard deletion. Reproduced the FK failure and immutable-history guard in rollback-only SQL probes. No guard/trigger was disabled.
4. Corrected test cleanup to delete only pending requests, remove its own approval group and assignment, and deactivate its own branch while preserving approved source/history. Removed the now-unused `billId` cleanup variable and assignment. The branch created by the failed cleanup attempt was also retired by exact UUID/name/code ownership checks. Shared pending cash-delete count stayed 2.
5. Focused workflow passed in 8.0 seconds; catalog check showed 0 active test branches under this unique label. Full approval-suite rerun follows below.

Only test/harness code changed this scan. No new production-route/schema changes or Cloud deployment. Initial TypeScript/unused and changed-file lint checks passed; source-size/whitespace checks passed. Previous isolated-suite count (655/2 skips) is not a newly rerun receipt.

Final verification: full Rubber Bill approval contract suite **21 passed in 1.3 minutes**, with no skipped cases. Final strict TypeScript/unused and changed-file lint passed. Local catalog verified shared cash-delete pending count remains 2 and active isolated test branches are 0. This supersedes earlier limited 4-case Rubber Bill integration coverage. The expected source/report guards remained enabled. Scoped verdict: **ship** for test isolation and audit-preserving cleanup; no new build or production deployment claim.

## Tenth scan: remove duplicate mutation refresh work

Intent/simplification: ensure a successful cash-transfer mutation refreshes each active badge/feed once. Reuse the existing money-flow invalidation coordinator instead of adding a second refresh mechanism.

Trace: `useCashBranchTransfers.refresh` invoked `invalidateMoneyFlowLocation`, which already refreshed badges and the current branch feed, then explicitly invalidated those keys again. With cached active queries, the second invalidation canceled/restarted the first query. Real installed QueryClient/QueryObserver probes measured **2 badge executions** and **2 current-branch feed executions** per mutation.

Ledger:

1. Badge regression failed (expected 1, observed 2). Removed the redundant explicit badge invalidation and its unused import. Real query execution count became 1. The initial test loop mistakenly assumed five mutation callbacks; corrected to the actual four (create/update/receive/delete), not a product change.
2. Broader feed regression likewise reproduced 2 current-branch executions while a different branch control fetched once. An intermediate `cancelRefetch: false` approach avoided duplicate work but failed a deliberately older in-flight other-branch response test (old version 0 instead of fresh version 1). That approach was discarded before final verification.
3. Final fix: optional `incomeExpenseScope: all` on the existing coordinator chooses a single root invalidation for cash mutations; other callers keep their current-branch default. Removed the explicit feed invalidation and its unused import from the hook. Default cancellation of older in-flight queries remains enabled.
4. Real QueryClient regressions cover all four cash mutations, badges/current feed/other-branch feed, and replacement of an older in-flight other-branch response. Focused suite: 10 passed. Final cash UI regression: **4 passed in 59.4 seconds**, including receipt/deletion and cross-window queue refresh. Final strict TypeScript/unused passed.
5. Earlier standard verification attempts were stopped during their owned build stages while the refresh fix evolved; those interrupted builds are not passes. A clean sequential standard verification of the final source follows below. No dev server was active when it started.

This reduces executions for these overlapping cached-active-query cases from 2 to 1; it does not establish an overall Vercel cost/CPU percentage. No financial rules, database schema or Cloud configuration changed in this scan.

Final receipt: clean sequential `npm run verify` completed with exit 0: lint, typecheck, source-size, Time/Payroll import-direction checks, login Auth-outage test (7.363 seconds, zero Supabase requests), **659 isolated passes / 2 existing live-OCR skips**, production build, service-worker and bundle guards. First load remains 268.8/320.0 kB; route 83.5 kB. The final cash UI suite passed 4 cases separately. Strict unused checks and whitespace checks passed. Removed imports `ACTIONABLE_BADGES_QUERY_KEY` and `INCOME_EXPENSE_FEED_QUERY_KEY` that became unnecessary after refresh consolidation. Scoped verdict: **ship**; no deployment and no claim of an exhaustive all-repository bug-free audit.

## Authorized Cloud database release — 2026-10-27

- User explicitly requested pushing main and `supabase db push`. Linked project verified as `psxwhhwjmolqperxrlzj`; deployment environment check passed without printing values.
- Dry-run showed only `20261027020000_classify_corrupt_rubber_approval_payload.sql`. Public-schema backup saved to ignored local output before applying; approval body matched the expected pre-migration source. No data reset or seed was performed.
- Linked `supabase db push --yes` applied that migration and exited 0. CLI then warned that its optional pg-delta catalog cache could not read a certificate file; this was after the successful migration.
- Independent follow-up dry-run: remote database up to date. Fresh Cloud schema export verified the approval body matches the tested local snapshot, contains the new validation block once, and retains owner/grants. This supersedes earlier statements that this migration was local-only/Cloud-pending.
- App Git release and hosting rollout are separate from this verified database release; pushing main does not itself prove a completed hosting deployment.
