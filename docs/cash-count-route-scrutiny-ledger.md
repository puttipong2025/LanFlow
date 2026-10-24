# Cash-count route scrutiny — 2026-10-24

Scope: current independent cash-count/four-account business logic, API routes, OCR/Drive/retry, alert groups and consumers. No unrelated module cleanup or Cloud mutation.

Intent: preserve the approved simple count flow and make its API error/latency boundaries reliable. Smaller alternative selected: retain existing handlers and add a shared unavailable response with local error boundaries; reuse Next's post-response task mechanism rather than creating another worker/queue.

## Reproduce and trace

| Run | Exact experiment | Result / inference |
| --- | --- | --- |
| R1 | New route-failures tests inject RPC rejection in group GET/POST/DELETE, count POST and session GET; image query returns DB error with null data | Six failures: five uncaught transport exceptions; image incorrectly 404 instead of unavailable. |
| R2 | Trace handlers through auth → rpc/query → response | Returned RPC errors had handling; thrown exceptions had none. Image discarded count query error and combined evidence DB error with missing evidence. Ranked hypotheses: transport rejection outside returned-error branch, auth rejection, invalid request, missing record. Valid UUID/payload and successful auth falsify auth/input explanations; explicit query error falsifies missing-record explanation. |
| R3 | Add catch boundary with private no-store JSON503; image query error separate from absent row; same six tests | Six passed. No changes to domain calculations or DB permissions. |
| R4 | Successful submit RPC with cleanup promise which never resolves | Failure proves route starts/awaits remote cleanup after the business transaction, tying success response to unrelated external work. Alternatives: slow submit RPC, JSON parsing, cleanup wait. Immediate mock RPC and valid payload eliminate the first two. |
| R5 | Schedule unused-evidence cleanup with Next after(); run route failure + upload recovery tests | Success returns201 without starting cleanup inline; background task registered. 12 tests passed, including prior upload/retry semantics. |
| R6 | Genuine image-missing control and role/input control tests | Verifies 404/403/400 remain distinct from503; final results recorded after regression. |
| R7 | Route failures + OCR/denomination logic + upload retry suite | 18 passed, two opt-in live OCR fixtures skipped; same-photo/cash formulas unchanged. Lint/typecheck/source-size passed. |
| R8 | Live authenticated full count contract including four accounts, real private Drive and post-response cleanup | 7 passed including setup. Cleanup grace and eventual removal still work, and test-created Drive files were removed. |
| R9 | Final production build, lint/typecheck/source-size, full isolated regression, Service Worker/bundle guards | Passed. No SQL/schema mutation required for these fixes. |

## Dead code removal

Removed the OCR upsert's unused `data: evidence` binding and its `void evidence` statement. The upsert never requested returned row data; saved evidence is loaded by the following scoped query. Existing v2 RPC wrappers and no-position image defaults remain live compatibility paths covered by older one-bank callers/tests, so they are not dead code.

## Contract

- All count/session/detail/image and count-alert-group entry points handle unexpected failures as private no-store JSON503 without returning internal diagnostics.
- Missing count/evidence is404; returned DB error on the image route is unavailable503.
- Unused-image cleanup runs after success response on count submit/session read/cancel, with the same owner/terminal-session/grace-period/attached-evidence guards.
- Regression checks use the actual source modules, replacing only unavailable DB/remote boundaries. Live cleanup acceptance waits for eventual cleanup rather than assuming it completes inside the response.

Verdict: ship locally; reproduced failures corrected and regression checks passed. No production deployment is claimed.

## Second scan — OCR error boundary

- Intent: protect the OCR route without changing count totals, permissions, or unclear-balance rejection. Reuse the existing unavailable response rather than add another error wrapper.
- R10: injected a parser exception with a private diagnostic; expected safe503, actual422. Existing nine route regression tests passed. This isolates the gap to OCR.
- Trace: POST authenticated before try; its catch returned every Error.message. No attached debugger was available for the VM route harness; source tracing reaches both boundaries directly.
- Ranked hypotheses: (1) catch leaks unexpected diagnostics; (2) auth throws outside catch; (3) legitimate validation must remain422; (4) role denial must remain403. Controls disprove a blanket503 solution.
- R11: introduced a typed safe-input error for explicit OCR feedback, moved authentication inside try, reused private no-store503 for unexpected exceptions. Targeted tests:19 passed,2 live opt-in tests skipped.
- R12: added safe422/role403 controls;20 targeted tests passed,2 live opt-in tests skipped. Auth and parser failures now return safe503 without diagnostics. Count/upload recovery tests still pass. No additional dead bindings confirmed in this pass.

## Third scan — submission preparation boundary

- Intent: verify submit/replay/upload paths and input handling; reuse the typed safe error and unavailable response already present, with no new upload mechanism.
- R13: injected a private Drive preparation diagnostic into the real multipart route. Expected503, actual400; the other11 route cases passed. This exposes the nested preparation catch missed by the outer unavailable guard.
- Trace: POST → prepareCashCountSubmission → Drive/DB or image checks → inner catch returned arbitrary Error.message. Source trace used because the VM harness has no attached debugger.
- Ranked hypotheses: (1) nested catch leaks unexpected transport errors; (2) expected image validation also passes through this catch; (3) malformed JSON requires a safe400; (4) retry state must remain reusable. Safe validation/malformed JSON controls rule out making every failure503; upload recovery exercises hypothesis4.
- R14: explicit preparation validation now uses CashCountInputError. JSON/form parsing has fixed safe validation messages. Unexpected preparation failures reuse private no-store503; known errors preserve existing status mapping.22 targeted tests passed,2 opt-in live OCR tests skipped, including failed fourth-upload retry, lost acknowledgement, swapped image, expired session, safe400 and unavailable503.
- Dead-code pass: no additional unused functions/imports confirmed; consolidated two imports from cash-count-response into one. No SQL/state-machine changes.

## Fourth scan — review, deletion and image authorization

- Intent: verify reviewer identity, repeated deletion, private evidence access and stale detail requests using existing guards. Simpler-alternative pass: retain existing role/RLS and atomic RPC boundaries; no additional service or duplicate permission layer is needed.
- Trace: detail/image GET uses requireSystemManager and an RLS-filtered active count before admin evidence access; evidence query is bound to count and position. PATCH uses check_cash_count's active/unchecked atomic update; DELETE checks branch then calls delete_cash_count, which serializes through the branch fence and retains evidence. Detail UI rejects superseded request IDs and branch changes; image component revokes blob URLs and aborts on unmount.
- Evidence: src/app/api/lanflow/cash-counts/[countId]/route.ts; src/app/api/lanflow/cash-counts/[countId]/image/route.ts; src/components/cash-counts/CashCountModule.tsx; src/components/cash-counts/CashCountBankImage.tsx; supabase/migrations/20261024010000_independent_cash_counts.sql; supabase-schema.sql cash counts manager select policy.
- R15: full isolated regression579 passed,2 opt-in live OCR tests skipped. Includes real concurrent review/delete, branch fence, route errors, upload recovery and PDF coverage.
- R16: local database suite57 files/1329 assertions passed. No newly reproduced business-logic/route bug or confirmed dead code in this pass. No production source or SQL changes were necessary.
- Verdict: ship for the reviewed local scope; no new actionable finding. Live external OCR/Drive calls and deployment were not rerun in this pass.

## Production cutover follow-up — web gate requires no Docker

- Repro: Vercel deployment dpl_DTPT4MrinUFxEEmV5ZTUevyLbYxr for5ded0e2 failed at cash-count-concurrency.spec.ts with spawnSync docker ENOENT. Production kept the previous application while all four Cloud migrations had applied. That application still requested the retired cash_counts/report_batches relationship.
- Trace: deploy:check → verify → test:isolated included a local Docker integration test. Local verification passed because Docker exists locally; Vercel has no local database runtime. This disproves a missing new relationship or a need to restore the old FK: current source no longer requests that join.
- Minimal fix: move the concurrency test to playwright.database.config.ts and run it as part of test:db. Both GitHub's database-gate and local database verification retain the check; the web gate remains independent of Docker. Do not skip the integration test globally or change production schema to accommodate obsolete application code.
- Verification: standalone database concurrency test passed. Isolated web regression, lint/typecheck and replacement production deployment are checked during recovery.
