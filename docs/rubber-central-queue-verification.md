# Rubber central queue verification ledger

## Additional retry/context scan — 2026-10-29

- No new confirmed defect or unused production function/import/variable found in this pass. Simpler-alternative decision: keep the existing command core, conditional reconciliation and bounded queue routes; no new processing layer or speculative cleanup.
- Traced command preparation/context → local persistence/coalescing → central/legacy transport → malformed/transient result retention → conditional acknowledgement; correction creates a fresh identity, legacy restart is fenced from central events, and origin printing serializes without business replay. Checked shared coalescing consumers before treating its returned removal list as dead data: `useIncomeExpense.normalizeQueue` uses it, so it was preserved.
- Verified 85 tests across central business/route, command-context route and sync recovery; scoped ESLint passed. This includes wrong-identity/malformed outcomes, lost admission response, account changes, cross-tab changes, correction identities, recent central-discard guards and transient retry cases. No production source, SQL, or Cloud changes in this pass; only this review ledger was updated. These are isolated tests, not a fresh full DB/build/browser gate.

## Follow-on recovery/discard review — 2026-10-29

- Intent: keep a centrally accepted correction recoverable until it is corrected or authoritatively retired. Smallest alternative selected: guard the existing local-discard path and expose that capability to the existing table; no new central cancellation action or business rule.
- Trace: central worker/admission returns `correction_required` → uploader persists local failed/400 with submission unlocked for correction → local feed enables correction → table also offered legacy local discard → `discardSyncProblem` deleted local queue and receipt without touching the outstanding central job. The server report blocker remains correct, but the origin loses its local reconciliation handle.
- Ranked hypotheses: (1) legacy discard incorrectly handles central correction events; (2) existing conditional reconciliation already prevents their removal; (3) the uploader never exposes a central correction to this path. Source trace confirms failed/400 is persisted by the central runner. Runnable differential using real fake-IndexedDB transactions: identical failed events with only `centralQueue` toggled. Legacy discard succeeds (disproves a generic broken setup); central discard also succeeded before the fix (disproves an existing central safeguard).
- Experiment ledger: first two-case run had one passing legacy control and a cross-VM promise matcher diagnostic; changed only observation to await the returned error message. Second run: legacy passed, central failed with null error because discard succeeded. Added central-event guard before mutation: both passed. Added local-feed capability and direct React table-tree assertions: all three passed. The UI test exercises actual generated button props, not a real browser session.
- Fix: `useRubberBills.discardSyncProblem` rejects central events without deleting their local queue or receipt. `rubberBillFromSyncEvent` and background overlays carry `canDiscardSyncFailure: false`; `RubberBillsTable` disables the discard action and directs the user to correct the central draft. Legacy discard behavior and labels remain compatible. A stale UI cannot bypass the mutation guard. No new unused function/import/variable was confirmed in the reviewed paths; no additional dead code removed.
- Final verification: 107 central-route, central-business, legacy-background, sync-recovery and receipt-IDB tests passed; scoped ESLint, TypeScript and source-size guard passed. Reviewed files include `src/hooks/useRubberBills.ts`, `src/lib/rubber-bills/local-feed.ts`, `src/components/rubber-bills/RubberBillsTable.tsx`, central runner/contracts, local comparison/reconciliation and report/legacy route seams. No SQL/Cloud writes, commit, push or deployment. Earlier full DB/build/browser results below are historical implementation evidence, not rerun for this review.

## Additional route and business review — 2026-10-29

- Scope: Rubber central submission/management/read routes, legacy submission seam, report preflight, local uploader/reconciliation and origin print handoff. Simpler-alternative pass: tighten the existing contract validators; no additional validation framework or business engine is needed.
- Ranked hypotheses: (1) string coercion in enum validation admits JSON arrays; (2) RPC error mapping alone produces the wrong response; (3) invalid test identity/receipt fixtures cause rejection. Differential controls: the same fixtures with literal string actions pass all 12 original route cases, ruling out a general fixture/authentication failure. Source trace: request JSON → `isRubberQueueSubmission` / PATCH action gate → RPC; shared RPC rows → `isRubberQueueRow` → response/UI. `String(["retry"])` and `String(["done"])` explain the incorrectly accepted types before RPC or terminal validation.
- Red run: original route cases 12 passed; three new regressions failed. POST array operation reached RPC and returned 503 instead of pre-RPC 400; PATCH array action returned 200; GET accepted a malformed feed row with 200. No real database mutation was used for these malformed-input reproductions; the route harness replaces the RPC boundary.
- Fix: require actual strings for submission operations, management actions, queue action/state and manager receipt operation; reject unknown or conflicting business `queueAction` before admission. Preserve matching explicit business actions and manager approve/cancel contracts. A malformed upstream receipt remains an uncertain failure, never a successful acknowledgement.
- Dead data: removed the unused stored `event` property from tab-local print intents. `rememberRubberQueuePrint` still uses the input event to bind identity/scope; serialization and scope checks remain covered by the print tests.
- First green run: all 50 central-route/central-business/legacy-background tests passed. Typecheck, targeted ESLint, source-size guard and whitespace check passed. Final run with the additional manager-receipt regression: 51 passed, distinguishing a valid string operation from an array operation. No SQL or production configuration changes in this review; the earlier full DB/build/browser results elsewhere in this ledger belong to the preceding implementation run, not a rerun of those gates for this narrow validation fix.

## Baseline

- 2026-10-28: HEAD `0344672f80a4bca51c54a2149c5550539d1fbf77`; existing uncommitted Income/Expense implementation preserved. Local Supabase database healthy; pg_cron 1.6.4 installed.
- `npx playwright test --config=playwright.isolated.config.ts tests/rubber-background.spec.ts tests/rubber-sync-recovery.spec.ts tests/rubber-approval-route-response.spec.ts`: 135 passed, 7.2s. These verify existing behavior, not the proposed central queue.
- Source trace confirms core command/approval/stock/OCR helpers use authenticated actor identity and branch guards. The new worker needs a protected explicit execution-actor boundary; forwarding an unrelated browser session is not sufficient.

## Runs

Each implementation result below must name the input, observable result and what it proves or rules out. Static contract work alone does not tick runtime acceptance.

- Initial new database test was excluded by the explicit Playwright testMatch. Added its exact filename; genuine red then confirmed the private worker was absent. This was test discovery, not a business failure.
- Applied only new Local migrations after confirming Income/Expense migrations through `20261028022000` were already installed. No reset or Cloud write.
- Legacy concurrency exposed an ambiguous `payload` identifier in the new wrapper. Qualified the argument; legacy and new capability tests then passed (2/2).
- Actual admission exposed an ambiguous `action` identifier during supersession. Qualified the target-row action; 24 database assertions passed including no-claims worker, revoked/restored assignment, manager approval and report handoff.
- Full database regression at that checkpoint: 63 files, 1,473 assertions passed. Later additions require a fresh full run before delivery.
- Added admitted-cap differential: first run failed four assertions. Direct protected-context diagnostic returned missing fixture `acid_pack_count`, disproving a price-policy regression. Added the required fixture value; all 28 assertions passed, including original price 40 and admitted cap 50 after current cap decreased to 10.
- Client trace found a new owner-index read was unnecessarily run on purely legacy queues. Existing isolated test reproduced missing-IDB-boundary failure. Gate the central runner on central work within legacy sync, keeping the coordinator's independent owner-level round. Focused central/legacy tests: 28 passed, including the formerly failing legacy branch-switch case.
- Central isolated tests verify durable acceptance before POST, owner-wide multi-branch progress, account change during upload, exact replay after lost response, conditional reconciliation of another tab's edit, invalid receipt retention and serialized origin printing with permanent branch-leave skip.
- Queue route tests: 12 passed. Admission returns 202, malformed/mismatched receipts return retryable errors, actor mismatch/oversized input are blocked before RPC, shared reads remain branch-scoped, row actions bind versions, no database detail is exposed.
- Typecheck and source-size ratchet passed after client integration checkpoint. Browser/complete regression gates are still pending.

## Follow-up verification — 2026-10-29

- Real pg_cron completed an admitted command without browser/HTTP/manual-worker traffic (observed 6.2–10.7 seconds in separate runs). Two concurrent workers plus a real report transaction produced one outcome per command, no report, eight continuing approval/zero-price blockers and no leaked execution context.
- Expanded DB tests cover accepted Bangkok date across midnight, an admitted edit window before delayed execution, cap reduction, invalid-create correction with a new identity, superseded offline replay, expired active cash sessions, branch independence, shared literal search, permanent-account retirement versus temporary inactivity, row-version conflicts, transaction-abort recovery, exact missing manager target, and OCR with/without source ownership.
- Browser red: a minimal pending delete made the existing approval feed return an incomplete proposal summary. Traced the SQL summary into route validation. The same minimal-delete DB case now reads authoritative bill fields; added `20261028040000` and regression assertion. A full-payload control had also hit a short loading wait; API and UI checks now distinguish transport validation from loading.
- Browser harness red: an existing global threshold notice closed the branch selector while Playwright held a detached option. Retry reopening only in the new test's setup; no unrelated alert behavior changed.
- Two real browser contexts passed shared refresh, origin branch leave, no off-branch PDF/dialog, manager durable confirmation before delayed POST, approved deletion and shared history/search. Expanded run passed two real PDF downloads in order while the observer downloaded none (2-minute scenario). Screenshot: `output/rubber-central-queue-shared.png`, visually inspected against existing primitives/spacing, then selected-state emphasis added.
- Review found the PDF busy predicate was inverted at the registration seam. Renamed the capability to `isBusy`, tested idle/busy transitions, serial receipts, cancellation/failure and permanent scope leave. Revalidate the actual owner/session before automatic PDF and again at the handoff; offline/manual PDF retains its existing route.
- Review found a manager target could disappear before admission, leaving local retry forever. Admission now writes an identity-bound `REQUEST_CHANGED` terminal receipt. A missing target cannot affect an unrelated queued command.
- Full DB gate initially stopped in the existing retention test: more than 21,000 old cron rows exceeded its fixed 20 × 1,000 cleanup budget. A transaction-local diagnostic showed no cleanup exception. Test bound now derives from previewed eligible volume. No production retention code changed. Rerun: 64 files / 1,521 assertions and all 7 concurrency tests passed.
- Legacy `rubber-bills-offline.spec.ts` exploratory subset (3 cases) stopped in pre-existing login/global-alert setup before reaching offline writes. A selector/handler experiment did not resolve all setup interference; those exploratory edits were removed. The new authenticated isolated-branch browser scenario exercises offline create/edit, reconnect, one central admission and offline guards directly. Keep the old suite's setup failure distinct from this feature's verification; do not claim that old suite passed.
- Added manager approve/cancel local-acceptance and duplicate-target tests, fair 20-slot owner rounds, and PDF-failure isolation. A VM matcher could not handle a cross-realm rejected Error; asserted its observed message instead. Focused central tests: 18 passed.

## Acceptance traceability

DB means actual Local PostgreSQL transactions/permissions, not a mocked database. Client tests replace the transport boundary while executing production IDB/reconciliation. Browser evidence uses the actual Local API/DB. This matrix does not assert every possible Cartesian combination or physical-printer output.

| Acceptance | Evidence |
| --- | --- |
| A01 | client create-before-POST/storage guards; two-device browser branch change; offline browser |
| A02 | DB revoke/restore, active/expired cash session and independent branch; owner-round fairness |
| A03 | client exact replay after lost response; cron-only completion; legacy terminal replay |
| A04 | client account change during upload; authenticated actor binding; print handoff revalidation |
| A05 | DB manager approval/deletion and receipt handoff; browser modal closes before POST; local approve/cancel acceptance tests |
| A06 | DB queue versions, stale generations, superseded replay and exact request fingerprint; legacy replacement concurrency |
| A07 | execution checks current revision/report/transfer and explicit business errors; durable discard with unchanged Server state |
| A08 | DB correction retains original/new UUID; client correction guards; offline browser create/edit/reconnect |
| A09 | route malformed/mismatched/oversized cases; client lost response and immutable payload; transaction rollback/recovery |
| A10 | real IDB conditional cleanup/abort/dependent-event controls in background/recovery suites |
| A11 | two-device off-branch browser asserts no dialog/PDF/download; background service-health suppression in upload and session probes |
| A12 | central minimal notices plus per-account/branch acknowledgement keys; existing durable scoped failure-notice tests |
| A13 | real browser leaves/returns without retrospective print; tab-scope serial print tests; account recheck |
| A14 | pending approval no-print gate; offline/manual receipt and calculation regressions; actual worker OCR ownership tests |
| A15 | source entry matrix; marked commands excluded from legacy engine; manual central retry uses same runner; separate Income regressions |
| A16 | actual two-context shared feed/history; local-only offline creates absent from Server until reconnect |
| A17 | actual cron-only completion and concurrent worker test; no client privilege on private worker/context |
| A18 | exact terminal receipt replay including later approved deletion; reconnect IDB reconciliation |
| A19 | actual branch/role grants and private-context access tests; worker requester preserved; foreign OCR rejected |
| A20 | runbook entry-point matrix and source trace of new/legacy/manual/manager/configuration/PDF paths |
| A21 | actual central blocker branch/cutoff; pending handoff count; existing report transactions recheck |
| A22 | actual concurrent workers vs report; legacy approve/replacement race; cash-count fence concurrency; transaction-only handoff |
| A23 | actual DB accepted-time fixtures across midnight/edit expiry and price-cap change; immutable retry acceptedAt |
| A24 | actual Auth-user removal versus inactive state, manager-only conditional retirement/audit, other blocker retained |
| A25 | terminal legacy replay, supersession and final approved-delete receipt; no runnable terminal payload |
| A26 | attempt rollback removes business/receipt together; next attempt succeeds once; simultaneous workers; fair due/owner ordering |
| A27 | two real PDF downloads; serial/busy/cancel/failure/scope-leave client tests; printing cannot mutate business queue |
| A28 | actual observing browser refresh after cron with no local sender; bounded search/page cursors and revision invalidation |
| A29 | append-only Local upgrade through `20261029015000`; private grant tests, preserved legacy receipts and IDB6; rollback runbook |
| A30 | observed cron latency; bounded batches, capped retry delay and scheduler timeout; shared age/attempt/error diagnostics and explicit retry |

Final build/route/browser gate totals are recorded below only after the commands finish.

- Final review also checked Auth account deletion independently of retained profile state (the project has no profile→Auth FK). Worker now pauses a deleted Auth actor even if the retained profile is active; realistic worker fixtures include Auth rows. One new actual DB assertion verifies that distinction.
- Reproduced timeout isolation with a transaction-local `57014` trigger: the first run aborted at the worker boundary, proving `OTHERS` excludes `query_canceled`. The forward fix catches cancellation per attempt, preserves its draft and backs it off, then respects a 7-second tick budget. The next DB command completes and no partial bill remains. Focused DB suite: 69 assertions passed.
- Shared branch badges now include central work through the existing aggregate RPC, retaining other module rules and deduplicating work already represented by zero-price/pending approval. No additional all-branch browser loop or notification was added.
- A run overlapped the DB suite with browser branch creation and temporarily broke a legacy dashboard fixed-branch-count assertion; a cold context check also exceeded the browser's former 5-second UI assertion. Separated the shared-DB suites and allowed the required context validation budget before asserting form close. The POST stays deliberately held, so the test still proves local acceptance does not wait for business submission. Rerun browser-only: all 3 cases including setup passed (4.0m), including the actual offline create/edit/reconnect and offline synced-action guards. An overloaded concurrency run exceeded an existing 20-second test budget; final concurrency is rerun after build rather than hiding that failure.

- The timed-out existing cash-count concurrency test left its fixed fixture because its initial INSERT precedes its cleanup `try`. The next run positively identified the same fixture UUID/name/code/actor phones and hit a duplicate-key setup error. Removed only those verified Local test rows using the test's cleanup sequence, then ran DB/concurrency separately: 64 files / 1,531 assertions and 7 concurrency tests passed. No cash-count business rule or unrelated dataset was changed.
- Final IDB review reproduced a crash window for manager-approved deletion: its local identity is a request ID, so a bill tombstone previously happened after queue acknowledgement. A new regression first exposed an undefined auto-key in the test fixture; after fixing that fixture it reproduced the actual stale receipt. `acknowledgeRubberCommand` now binds the exact manager command/target and atomically commits queue removal, actual-bill receipt removal and tombstone. Re-caching the old snapshot cannot resurrect it. Focused central/legacy tests: 35 passed.

## Review verdict

Use the existing business core with a private execution context and one central queue; a browser-only replay change cannot satisfy all-browsers-closed processing. A second calculation/approval engine would duplicate the authoritative rules. The final review traced form/manager admission → owner uploader → API/DB authorization → branch/job locks → core/OCR/stock → receipt/blocker transition → shared refresh/IDB/PDF, including legacy entry points and report preflight.

Fixed review findings: retained-profile Auth deletion, missing manager target, per-job query cancellation, minimal delete approval summary, legacy overtaking, asynchronous account handoff, inverted PDF busy capability, and manager-deletion atomic tombstones. Existing primitives, selected-state emphasis, inline errors, literal search, bounded pages, Thai labels and destructive confirmation were inspected; no animation or replacement component system was introduced.

Verdict: deliver the verified Local implementation with the rollout/runbook and documented test-harness limitation. Cloud publication and physical printing are separate evidence, not inferred from Local completion.

## Final Local gates — 2026-10-29

| Gate | Result |
| --- | --- |
| `npm run test:db` | PASS: 64 SQL files, 1,531 assertions; all 7 multi-connection concurrency tests |
| `npm run verify` | PASS: lint, typecheck, source-size, import direction, auth-outage check, 806 isolated tests, 2 existing skips, production build, service worker and bundle budgets |
| Actual browser feature scenarios | PASS: 2 feature scenarios + setup (3 total), two devices/branches, held POST, manager approval, two serial PDFs and offline create/edit/reconnect/guards |
| Route/middleware auth audit | 103 route/middleware cases passed in the combined run; its separate feature-browser failure was subsequently corrected and passed in the browser-only run |
| Focused IDB/central/legacy | 35 passed after the atomic approved-deletion fix; included in the full isolated gate |
| Source / artifacts | `git diff --check` clean; HEAD remains `0344672f80a4bca51c54a2149c5550539d1fbf77`; changes remain uncommitted |

Logs are in ignored `output/rubber-final-db.log`, `output/rubber-final-verify.log`, `output/rubber-final-browser-only.log` and `output/rubber-focused-final.log`. No Cloud migration, commit, push or hosting deployment was performed. The legacy exploratory offline-suite setup limitation above remains explicit; its three attempted cases are not included in passing totals.

Vault write-back completed with atomic helper receipts and exact byte/SHA-256 readback: new `LanFlow_Rubber_Central_Queue`, three related legacy notes, Core Brain and the requested Daily. Final Daily reread: 30 checked Phase tasks, zero unchecked, `execution_status: completed_local`. Filesystem link/metadata audit introduced no new findings; existing unrelated metadata/link/source-path findings stayed unchanged. Obsidian CLI returned no indexed backlinks at check time, so app-index refresh is not asserted as verified.
