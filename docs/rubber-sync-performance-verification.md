# Rubber sync Local verification — 2026-10-29

Current delivery: Local implementation plus a reviewable release package. Cloud rollout/post-release measurement is deferred by the user. Daily checklist: codingDO `10_Daily/2026-10-29 2.md`. The historical ledger below is superseded by this current section; its failed/partial states are retained as experiment evidence.

Follow-up completion: all 37 Local checklist tasks are verified; overall 37/38, with only the explicitly deferred Cloud post-release observation unchecked. Detailed timing was closed using test-only probes, without changing product source or database contracts. Final diagnostic run: 4 passed (setup + 3 commands); fresh build/service-worker/bundle checks passed again in `output/rubber-timing-build.log` (155 assets, 280.5/320.0kB first load). Cron was restored active on its 2-second schedule and all synthetic timing branches were cleaned up.

## Outcome and root cause

The dominant measured delay was waiting for scheduled execution and client receipt reconciliation. It was not the normal business calculation: full-real-data-background ten-job workers took roughly60–314ms per batch in the latest baseline. Keeping the existing queue, reducing local wait and separately committing bounded one-job attempts removed these waits without weakening business locks. A4s injected job originally held an independent bill for4416ms; the new manual path completed the independent bill in2361ms and actual cron in2887ms, recording ATTEMPT_TIMEOUT/backoff for the slow job.

The server may now run one attempt immediately after authenticated durable admission, then reread the exact submitted receipt. Busy/missing/failed acceleration retains admission for cron. Only verified business results acknowledge commands. Original auth/revision/generation/idempotency/replacement/accepted-time/policy/stock/money/report/transfer/cash guards and branch/resource locks are retained. Uploader rounds are bounded and single-flight; active polling stops when idle. Unchanged pending polls do not invalidate business queries. UI locks only the pending row, keeps its data and main dialog, and distinguishes accepted/confirmed/rejected/unknown results.

## Comparable measurements

Baseline source is `0cd3024a9f5981d590ff99b2c7cc3077a8268bde` in a separate worktree. All UI stages use the same real Local Supabase database with synthetic branches. Local includes unrelated retention20261029020000; the queue kernel through20261029015000 is unchanged. Baseline and Phase2 use the old10s/batch scheduler. Phase2 uses current client changes with immediate processing disabled; scheduler stage adds committed attempts; final stage enables immediate server processing. Stages were measured sequentially, not randomized.

UI click-to-all-confirmed acknowledgement, including automation filling each following form;3 batches per size (48 commands per stage). Values are seconds; nearest-rank p95 equals max for these3 samples and is descriptive only. The gates were fixed after baseline while some candidate measurements already existed; they are not preregistered Cloud SLAs.

| Bills | Baseline median / p95=max | Phase2 median | Scheduler median | Final median / p95=max | Final request count / baseline |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 29.348 / 29.379 | 6.716 | 4.669 | 1.341 / 2.853 | 143 / 183 |
| 5 | 30.796 / 30.889 | 16.011 | 14.879 | 11.094 / 11.328 | 362 / 433 |
| 10 | 59.925 / 60.615 | 35.324 | 27.188 | 23.655 / 23.823 | 633 / 768 |

Final warm UI gates pass: median≤80% baseline, p95≤90%, requests≤2×baseline. Initial scheduler-stage cold1bill31363ms is preserved in `output/rubber-performance-candidate-cold-start.json`; prewarming was made explicit. Current final first1bill2853ms is retained. These measurements exclude OCR provider/upload and physical sharing; immediate PDF/offline/OCR behavior is regression-tested separately.

HTTP/auth/context through committed business result:8 scenarios×1/5/10×2 rounds=256 commands per stage;32 commands/scenario. Exact expected outcomes and attempts=1 checked; zero fixture errors/retries. Values below are milliseconds.

| Operation | Baseline median | Phase2 median | Scheduler median | Final median / p95 / max |
| --- | ---: | ---: | ---: | ---: |
| approve | 17116 | 15342 | 7308 | 124 / 158 / 996 |
| cancel | 25613 | 23635 | 7884 | 114 / 186 / 209 |
| delete | 24868 | 22791 | 9787 | 244 / 655 / 1105 |
| manual_approval | 32258 | 29547 | 10255 | 232 / 265 / 267 |
| manual_direct | 30798 | 27538 | 10030 | 238 / 270 / 291 |
| ocr_approval | 37912 | 34558 | 9652 | 227 / 262 / 267 |
| ocr_direct | 36190 | 32938 | 8184 | 242 / 270 / 274 |
| update | 43530 | 39391 | 7915 | 243 / 303 / 343 |

Total instrument runtime includes sequential request sending plus256 receipt reads; it is not pure worker throughput. Immediate processing lowers individual confirmed latency but can make this instrument run longer than the scheduler-only version. Mixed-burst ordering affects per-operation queue times, so use the rollback-only worker matrix to compare computation costs.

| Stage | Instrument seconds | Commands / instrument second | DB transaction delta | Buffer-hit delta | DB CPU seconds delta | Connections before→after |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| baseline | 153.730 | 1.67 | 3291 | 499985 | 18.789 | 20→20 |
| phase2 | 153.809 | 1.66 | 3310 | 474288 | 18.429 | 20→20 |
| candidate-scheduler | 82.670 | 3.10 | 3876 | 583809 | 17.369 | 20→20 |
| candidate | 89.249 | 2.87 | 4419 | 419510 | 16.911 | 20→21 |

Counters are whole-database/container observations including cron and measurement SQL, not attributed CPU/IO for an individual command. Raw CPU/IO snapshots, context/admission timings, command identities and request counts are retained in ignored JSON artifacts. Queue timestamps are inside transactions; the external receipt read proves commit. The original staged benchmarks did not separately instrument auth/lock/COMMIT or local PDF delivery; their acceptance interval is an upper bound. The diagnostic follow-up below now measures these stages with explicit precision limits and the same command identity. It does not retroactively change the original benchmark data or time physical printing/human sharing.

## Correctness and checks

- Isolated857 passed/2 skipped plus the later same-render guard regression1 passed: production handlers suppress duplicate approve/cancel before render while10 independent requests start.

- SQL65 files/1556 assertions passed. Rubber concurrency9 passed, including manual/actual-cron slow job, early/late backend kill for legacy and committed boundaries, exactly-once recovery, worker/report exclusion and cron without browser/HTTP/manual wake. The complete database concurrency suite also passed13 cases (`output/rubber-delivery-db-concurrency.log`), covering cash-count fences/unlock/submit/group disable and command replacement races. Its repeated actual-cron slow-job run took4402ms while the production build was running; it remained below the5s gate. This is retained alongside the isolated2887ms result.

- The worker/report race was then strengthened to issue immutable re-admission, version-bound retry and forbidden retirement concurrently with two workers and report creation. The focused rerun passed (`output/rubber-management-race.log`):8 effects/blockers,8 done receipts, no leaked execution context; stale management rejects QUEUE_CHANGED and retirement cannot discard a live actor's command. Final typecheck also passed after this test-only extension.

- Browser offline create/edit/reconnect passed; two-device/retained approval dialog/PDF flow rerun2 passed (including setup). The first attempt expected only202, but immediate verified completion correctly returned200; the updated assertion accepts200/202 and binds the command. Keyboard confirmation and pending-row disabled controls were verified; `output/rubber-central-queue-pending.png` and shared-queue screenshot were inspected.

- Typecheck/lint/source-size/import/auth-outage passed. Final production build, service-worker and bundle checks passed (`output/rubber-delivery-build.log`):155 offline assets,280.5/320.0kB first load,123.8/125.0kB raw Time/Payroll dynamic chunk. Both task-owned dev servers were stopped before this build; no later dev build replaced the production artifacts.

## Data, locks and release boundary

Read-only Cloud snapshot:93 public/private business tables/221703 rows, source migration20261029015000; excludes Auth passwords/tokens/sessions and storage file bytes. Dedicated offline container `lanflow-rubber-realdata-20261029`, cron off/network none; current verification confirms93 unchanged table fingerprints and zero FK violations.240 rollback-only mutation batch samples use synthetic commands on this complete real-data background. No actual customer bill was used for benchmark mutations. Backup hashes and restoration evidence are retained below; dumps/customer values never enter the release package or Vault notes.

Dependency audit covers70 reachable functions,15 with explicit locks. ADR0089 maps admission/management/worker/core/bill number/stock/money/report/transfer/cash paths and unchanged lock order. Implicit trigger/FK locks are checked by SQL/concurrency tests, not claimed exhaustively static. No concurrent lanes, narrower branch locks or batch admission were added: the smaller transaction/scheduler change satisfies the measured independent-job gate. Context/auth calls remain authoritative; no speculative caching.

Forward migrations20261029021000/20261029022000 and optional server-only RUBBER_QUEUE_DATABASE_URL are documented in `docs/rubber-sync-release.md`. Old payload/IDBv7/localContextPending/correction/replay contracts remain.2s attempt limits can defer a legitimate expensive command indefinitely, requiring observation and a forward limit adjustment. Per-instance connection cap does not promise a global connection count under horizontal hosting; hosted capacity/role/cron parity must be checked before deployment.

No commit, push or Cloud deployment. Unrelated retention and CONTEXT changes preserved and excluded from the review package. Hosted performance, hosted failover/role configuration, production-browser update and post-release observation are deferred. Local warm test evidence is not Cloud certification.

Scrutinize verdict: Local candidate is reviewable with verified transaction/recovery and warm latency gains; hosted shipping requires the documented rollout checks. The Local timing task is now closed by the diagnostic follow-up below. The remaining plan item is hosted post-release observation, explicitly deferred by the user; no hosted rollout is certified.

## Detailed timing closure — Local diagnostic

Three separate create commands bind every stage to the same immutable UUID in each trace. Values below are milliseconds. Round2 deliberately holds a row lock; PDF delivery is deliberately completed before admission. Existing unmodified HTTP benchmark results remain the speed evidence.

| Measured interval | Round1 | Round2, injected lock | Round3 |
| --- | ---: | ---: | ---: |
| Button lock after click | 0.80 | 1.00 | 1.40 |
| Native local durable commit after click | 42.30 | 67.70 | 37.10 |
| Context HTTP boundary | 105.80 | 48.10 | 37.60 |
| Context real auth guard | 75.39 | 26.14 | 23.56 |
| Context RPC | 19.73 | 16.37 | 8.57 |
| Admission real auth guard | 36.76 | 32.35 | 34.04 |
| Admission RPC through commit ACK | 23.39 | 32.51 | 18.03 |
| Admission ACK to worker dispatch | 29.41 | 56.60 | 30.05 |
| Worker statement, including locks | 92.89 | 200.69 | 77.20 |
| COMMIT dispatch to ACK | 15.13 | 22.36 | 11.80 |
| Authoritative receipt read | 11.45 | 24.88 | 12.33 |
| Receipt read end to native local acknowledgement | 118.40 | 126.03 | 94.22 |
| Local acknowledgement to confirmed DOM observation | 418.20 | 437.40 | 560.30 |
| Click to confirmed DOM observation | 1267.00 | 1515.90 | 1325.70 |
| Click to completed local PDF download | 496.98 | 349.87 | 331.00 |

Observed lock episode in round2: 70.77–103.65ms; edge-censored=false. Maximum lock sample gaps by round: 16.48/17.15/18.61ms. Other rounds observed no Lock event; this is not a zero-duration assertion.

Completed PDFs: 79510/79909/79297 bytes. All commands have exact synced outcomes/attempt1, authoritative committed receipt, native IDB acknowledgement and confirmed UI. No payloads, customer names, tokens or PDF contents are retained in timing artifacts.

- Test-only probes; actual browser/native IDB/PDF and production Route/auth/RPC/worker/driver execute against Local Supabase.
- Queue/context requests are intercepted and invoke source handlers in the test process with the same session bearer credential. This excludes Next middleware/cookie adaptation and is not an HTTP performance benchmark.
- Cron is temporarily paused and restored. PDF completion gates admission; round2 injects a locations-row FK lock released after an observed wait. These deliberate gates must not be interpreted as normal queue latency.
- Worker statement includes guards, receipt writes, network overhead and lock waits. COMMIT dispatch-to-ack includes protocol overhead; synchronous_commit=on was verified. Durations overlap and must not be summed.
- Lock polling brackets the observed episode; short waits can fall between samples. No observed wait is not zero lock time. The bounds are not a complete attribution of every PostgreSQL lock.
- UI DOM observation precedes a paint opportunity, not physical display/print completion. PDF is a completed, nonempty %PDF- browser download; no printer, human share sheet or external recipient is timed.

Reproduce: set `RUBBER_DETAILED_TIMING=1`, run `npx playwright test --config=playwright.rubber-performance.config.ts --grep "save 1 independent"`, then `node scripts/summarize-rubber-detailed-timing.mjs`. The probe code is test-only; no new product or database instrumentation is deployed.

Raw ignored evidence: `output/rubber-timing-browser.json`, `output/rubber-detailed-timing-summary.json`, `output/rubber-detailed-timing-final.log`. The first probe attempt used a Node performance alias inside page.evaluate and failed before recording samples; using window.performance corrected that harness error. The subsequent real-path trace passed before the stricter DOM/commit-mode assertions were added.

## Scrutinize follow-up — Business Logic and queue Routes

Scope: queue admission/read/management Route, command-context boundary, owner uploader/coordinator/notifications, private worker, unchanged execution guards, and their callers. Existing owner outbox and scheduler were reused. No new queue, worker lanes or public privileged endpoint was added. Unrelated retention source/migration200 remains excluded; Cloud deployment remains deferred.

### Findings fixed

- **[P1] Independent branches could starve under one-job execution.** Inherited candidate lookahead was four times p_limit, so four older locked branches filled every one-job search. Real DB reproduction first proves20-job processing can complete a free fifth branch, then1-job processing leaves a new free-branch command queued. Forward migration20261029022000 removes only that candidate limit; fair order, processed-job cap, seven-second scan budget, statement deadlines, exact actor/identity/resource guards and lock ordering remain. All-locked scan terminates, locked jobs keep attempts0 and execution contexts remain empty. Evidence: `supabase/migrations/20261029022000_rubber_queue_skip_locked_lookahead.sql:1`; `tests/rubber-central-queue-concurrency.spec.ts:10`.
- **[P2] A failed optional accelerator/read discarded the known HTTP admission acknowledgement.** After submit_rubber_queue commits and its receipt validates, a throw from acceleration or receipt refresh escaped to generic503. Catch only this optional step and return the original validated202 receipt. Business success still requires the exact validated terminal result; initial admission failure still returns failure/unknown. Evidence: `src/app/api/lanflow/rubber-bills/queue/route.ts:79`; regression injects exceptions at both optional boundaries.
- **[P2] Paused/retry jobs ignored server backoff.** Every pending response scheduled another check in2s even when nextAttemptAt was60s away. Honor server pause/retry delay within2–30s; queued jobs keep fast2s checks. Explicit reconnect/cash-unlock may force admitted receipt GETs, preserving single-flight and retaining a force request arriving during admission. Unknown admission commands retain their backoff and immutable UUID; a forced receipt check never bypasses it with a POST. Evidence: `src/lib/rubber-bills/central-sync.ts:79`, `src/lib/rubber-bills/central-sync.ts:162`, `src/hooks/useLanFlowOfflineSyncCoordinator.ts:68`.
- **[P2] Route input validation accepted inconsistent envelopes/cursors.** Require centralQueue=true, matching the documented v2 outbox contract. Reuse the existing ISO calendar timestamp validator so numeric/date-only/invalid-calendar cursors return400 before RPC; valid ISO cursors remain accepted. This is boundary validation, not a claim of an authorization bypass. Evidence: `src/lib/rubber-bills/central-queue-contract.ts:68`; `src/app/api/lanflow/rubber-bills/queue/route.ts:38`.

### Dead code and experiment ledger

- Deleted two obsolete `/wake` branches from uploader test doubles. Production browser wake had already been removed; source call-site search confirms no such request can reach these branches. The cleaned tests now expose an unexpected wake rather than silently accepting it. TypeScript noUnusedLocals/noUnusedParameters found no unused declarations/imports in the inspected product code; live RPC/framework exports and guarded branches were retained.
- Reproduce first: paused/retry scheduling, optional-step throws, central marker and timestamp regressions fail on old source. A first DB fixture hit unique location names; unique synthetic names fixed the fixture before the actual queued-vs-done starvation failure was recorded. The legacy20-job positive control disproves bad permissions/payload/data as the starvation cause. Initial force-recovery regression fails before the explicit recovery change; later tests cover unknown admission and a force request during an active upload.
- Native PL/pgSQL step debugging was not available in this test harness; traced the installed kernel and migration replacements, then compared real concurrent calls. Alternate timer/permission/invalid-command explanations were checked against the20-job positive control, same actor/branch and successful exact business outcomes. No temporary product debug probes remain.
- Red evidence: `output/rubber-scrutinize-red.log`, `rubber-scrutinize-db-red.log`, `rubber-scrutinize-cursor-red.log`, `rubber-scrutinize-wake-red.log`. Green evidence: focused63pass, recovery56pass, final full isolated866pass/2skip, main SQL65files/1556assertions, full DB concurrency14pass, browser3pass. Typecheck/lint/source-size/build/SW/bundle pass; final build155offline assets/280.6of320kB first load. Earlier speed tables predate this scrutiny fix and are retained as historical comparison, not a fresh throughput claim for migration220.
- Project rules require fresh migration replay and matching schema snapshot. Used an isolated Supabase project with empty business DB and no production seed; replayed all365 release migrations through220, excluding unrelated200. Reset passed. First clean SQL run exposed3 legacy tests expecting a seeded Super Admin Auth identity; created one synthetic Auth ID matching the migration-created profile, without password/session/token data or business seed, then unmodified tests passed64files/1531assertions. Main SQL65files/1556 includes the unrelated retention test separately. No real customer data or current app database was reset. Test cron disabled; temporary stack stopped after schema export.
- Refreshed supabase-schema.sql from public/private schemas of the clean release DB, excluding unrelated queue-retention additions. Installed worker definition hashes match between the main Local DB and clean replay (`b8b6d98e8b9bf655d4a3f8b6b22e0b42`). The standalone release snapshot is now consistent with the release migration set rather than the pre-queue cached snapshot. All schema-only artifacts exclude table data.

Verdict: **fixes verified for Local delivery**. The largest substantive defect was cross-branch starvation introduced by shrinking the candidate search with the transaction size. Hosted role/cron/load/parity and post-release observation remain the user's deferred rollout gate.

## Historical experiment ledger (superseded statuses)

The following text records earlier attempts. Its statements about missing baseline/wake Routes/no migration/no speed claim describe those earlier states, not the current implementation.
# Rubber sync performance investigation — 2026-10-29

Progress source of truth: codingDO `10_Daily/2026-10-29 2.md`. This file records evidence, not a replacement plan. Work is incomplete; no performance release is certified.

## Environment and ownership

Baseline source: `0cd3024a9f5981d590ff99b2c7cc3077a8268bde`. Initial working tree already contained experimental central uploader, coordinator, wake Route and approval feedback. History-retention changes are unrelated and preserved. No commits, pushes, migrations or Cloud mutations were performed in this investigation.

Local database container: `supabase_db_webapp`. Migration history ends at `20261029020000` (unrelated retention already applied); this is not a pristine database for the baseline revision. No Cloud function/history comparison or end-to-end timing baseline has been completed. No median/p95/throughput improvement is claimed.

## Experiment ledger

1. Typecheck passed. Initial central/route/immediate-state focused run: 59 passed, 1 failed. Admission test expected one HTTP request, experimental uploader issues a second, best-effort wake. Updated the test to explicitly inspect the wake payload, retaining immutable command and pending outcome assertions.
2. Added deterministic gated admission regression: enqueue a second bill while the first request is held; join the active flight; release the first response. Both commands upload in order without a recovery tick, maximum simultaneous admissions is one. Neither queue admission acknowledges business completion.
3. Coordinator trace found that interval cleanup cannot cancel an IndexedDB read already in progress. Added disposed check before starting follow-up and filter on nextAttemptAt. Regression holds the read across cleanup and verifies no old-scope upload starts. Follow-up replaced the fast idle interval with an owner activity subscription and one cancellable timeout. It stops when no pending work exists, schedules 2–30 seconds based on nextAttemptAt and retains an activity request arriving during a read. Existing 30-second recovery also discovers cross-tab activity. The uploader still checks sessions before reconciliation; cancelling local follow-up never cancels accepted server work.
4. Wake Route now bounds streamed JSON to 4096 bytes. Regression checks invalid/oversized input before RPC, auth denial, exact branch argument, DB authorization failure, opaque failure and no-store accepted response. Browser timeout does not guarantee cancellation of database processing. The Route is an accelerator, cron is the fallback.
5. Local database concurrency suite: 3 passed, including private-worker privilege, concurrent workers/report exclusion and actual scheduled execution with no browser/HTTP/manual worker invocation. This does not prove same-branch independence under a slow job.
6. Broad isolated suite before the final wake regression: 846 passed, 2 skipped, 1 failed. Failure at `tests/money-transfer-branch-invalidation.spec.ts:173` expects modal-wide single-flight in IncomeExpenseApprovalModal. HEAD already uses a Set of per-request locks, so this mismatch predates this work. Left unrelated files intact.
7. Browser initial run: 2 passed, 1 failed. Failure expected the approval modal to close after local acceptance; current requirement explicitly keeps it open. Updated this assertion to require the modal remains visible and both actions of the pending request are disabled; close explicitly with the existing close button before switching branch (Escape did not close this surface). Final rerun: **3 passed**, including setup, two-device processing/retained modal/serial PDFs and offline create/edit/reconnect. Log: `output/rubber-sync-browser-20261029.log`.
8. Final focused run: **64 passed**, including three-round cap under continuous arrivals. Final typecheck, changed-file lint and source-size passed. Import-direction and login outage checks passed. After browser completion, fresh production build passed (156 offline assets), then SW and bundle checks passed: first load 280.2/320.0 kB, Time/Payroll dynamic chunk 123.8/125.0 kB raw. Earlier SW/bundle checks failed after the browser dev server replaced `.next`; the fresh-build checks supersede those artifact-mismatch failures.

## Scrutinize findings and release verdict

Intent: lower confirmed completion latency while preserving immutable commands and authoritative business checks. Smallest justified change is to reuse the existing uploader and authenticated wake RPC; no second queue or broad parallel admission was introduced.

Trace: local outbox → central-sync owner flight → queue Route → submit_rubber_queue → worker → business core → result identity check → atomic acknowledgement → feed invalidation. Best-effort browser wake is separate from durable admission and must not supply completion semantics.

The actual Local `public.wake_rubber_queue(uuid)` checks `private.rubber_actor_location`, sets transaction-local lock_timeout=250ms and invokes a batch of five. Actual worker definition is captured in ignored `output/rubber-sync-worker-20261029.sql`: candidate loop lines 14–21, seven-second between-job budget line 22, location advisory transaction lock line 23, exception handler line 76, loop end line 120. Exceptions are subtransactions, not commits. Successful jobs earlier in a batch remain uncommitted until the outer RPC transaction commits; connection loss can roll them back. Admission/management/report use the same branch order (see migrations `20261028031000`, `20261028032000`, `20261028037000`, `20261028042000`). Full resource dependency map and early/late batch-kill proof remain outstanding.

Verdict: **do not ship as a completed performance change**. Missing comparable mutation baseline and same-branch slow-job proof prevent selecting transaction/lock changes or claiming the five phases complete. Current changes remain reviewable in the working tree.

Rollback constraint: preserve IDB v7, localContextPending resolver, durable outbox, queue identities and receipts. Disable the optional browser wake/active interval only while retaining the 30-second recovery and server cron; never clear storage or downgrade protocol. This is a fallback strategy, not a verified rollout.

## Follow-up measurements and gates

`node scripts/measure-rubber-queue-mutations.mjs` uses only the named Local Docker container and one rollback transaction. All fixture users/branches/OCR sources/settings/commands/business effects disappear on rollback. Eight scenarios × 1/5/10 commands × five rounds yield 120 batch samples; data preparation is outside the measured intervals. Unique synthetic OCR hashes avoid image deduplication. Exact business status is checked, rather than accepting any terminal receipt. Raw results: ignored `output/rubber-queue-mutation-baseline-first.json` and validated follow-up `output/rubber-queue-mutation-baseline.json`.

First run, warm ten-command batches (milliseconds):

| Scenario | Admission median | Worker median | Worker maximum |
| --- | ---: | ---: | ---: |
| Manual direct | 24.195 | 291.918 | 351.903 |
| Manual approval | 26.116 | 161.422 | 172.457 |
| OCR direct | 25.619 | 321.103 | 327.914 |
| OCR approval | 27.083 | 174.885 | 179.443 |
| Update | 30.800 | 329.301 | 386.595 |
| Delete | 30.475 | 253.914 | 269.278 |
| Approve | 27.676 | 198.776 | 201.996 |
| Cancel | 29.723 | 68.981 | 71.126 |

Five samples per group make nearest-rank p95 equal max; this is not a reliable tail estimate. Measurements exclude HTTP/auth/context, durable local commit, final outer DB commit, cron wait, OCR upload/recognition and UI refresh. Fixtures accumulate within the transaction, so comparisons are conditional on that warm fixture order. They are not before/after application performance or Cloud benchmarks. No speed target is inferred for unmeasured intervals.

Follow-up pending-query regression measures zero business query invalidations for an unchanged admitted pending outcome, while keeping the command. Initial admission/correction/confirmed completion still invalidate affected branch data. Focused central/route/immediate-state: **66 passed**. Actual database concurrency/recovery: **5 passed**, including dedicated connections terminated while waiting on the first and second bill in a batch; both receipts/effects roll back and retry produces exactly two approvals with no duplicates. SQL suite: **65 files / 1,556 assertions passed**. Browser suite after scheduler change: **3 passed**. Broad isolated: **850 passed, 2 skipped, 1 pre-existing IncomeExpense assertion failure**. Lint/typecheck/source-size passed. Fresh build/SW/bundle checks passed (280.4/320.0 kB first load).

## Rollout and rollback package (not deployed)

1. Preserve existing working-tree ownership. Release only reviewed Rubber paths/tests and this measurement tool. Do not include retention migration `20261029020000` or other retention files merely because they are present. This change introduces no SQL migration or IDB version change.
2. Existing IDB v7 and localContextPending resolver are mandatory in both forward and fallback builds. Existing clients can keep the slower uploader; backend command identity/auth/report rules remain unchanged. Refresh old tabs normally; never delete outboxes to force an upgrade.
3. Deploy only after comparable end-to-end timing and independent slow-bill requirements pass, and after resolving the isolated-suite gate explicitly. Record the chosen Cloud test project, migration/function/cron parity, deployed revision and synthetic branch. Git push alone is not deployment evidence.
4. To stop the accelerator, issue a forward client patch removing the best-effort `/queue/wake` call and activity subscription/fast timeout, leaving the owner uploader, staged command resolver, 30-second recovery, immutable commands, and server cron intact. The reviewed baseline commit already uses IDB v7, but do not roll back database protocol or unrelated changes. Keep the harmless authenticated wake Route until active clients have refreshed.
5. Compare confirmed completion, oldest pending age, attempts/error rates, cron run failures, lock waits and DB load against the still-required end-to-end baseline. Roll back the accelerator if these regress; never interpret an admitted command or local PDF as confirmed completion. Numeric thresholds await that baseline.

Remaining release blockers: comparable full-path timing and resource telemetry, complete dependency/lock proof, same-branch slow-job independence and target Cloud rollout evidence. Keeping the branch lock has not been certified as satisfying the independent-bill requirement.

## Full real-business-data test copy — 2026-10-29

The user selected Local completion with a release package before Cloud rollout, then explicitly requested all real data for testing. Cloud export used a repeatable-read, read-only exported snapshot shared by pg_dump, table counts, sanitized profiles and Auth ID extraction. Source migration: `20261029015000`. All **93 public/private tables, 221,703 rows** were exported. Auth password/session/token data and profile password fields were excluded; business names and values remain real data in the ignored backup, so it must not be attached to public reports or committed. Auth user IDs and inert session-ID placeholders support foreign keys in the offline test database; they are not usable login sessions.

Artifact directory: ignored `output/production-backups/rubber-sync-2026-10-29T13-26-23.481Z`. `business.dump` is 20,309,626 bytes, SHA-256 `8be66f6521b6b9c4f9e9042f3e8746bca1ac31180115f8bb7807ecda2a549472`; manifest records receipts for each export. Full export scope is public/private business data, not storage file bytes or Supabase Auth credentials.

Restored into dedicated `lanflow-rubber-realdata-20261029`, Docker network `none`, cron disabled. The application Local database was not replaced. Restore verified all table row counts against the source snapshot and all profile password fields null. Initial restore attempts exposed missing extension preloads and the business FK to auth.sessions; corrected only the dedicated container configuration, used inert referenced Auth IDs, and resumed post-data with transactional constraint recreation. No source Cloud data was modified.

Tools:

- `scripts/pull-cloud-business-test-snapshot.mjs`: read-only snapshot and checksums.
- `scripts/restore-cloud-business-test-snapshot.mjs`: isolated restore, counts, credential exclusion.
- `scripts/verify-realdata-test-snapshot.mjs`: offline/network/cron guard, 93-table fingerprints and actual FK row validation.
- `RUBBER_BENCHMARK_CONTAINER=lanflow-rubber-realdata-20261029 node scripts/measure-rubber-queue-mutations.mjs`: benchmark only the allowlisted dedicated test database.

Two runs each produced 120 batch samples (8 scenarios × 3 sizes × 5 rounds), checking exact business outcomes. The second run was bracketed by hashes of every business table; all **93 fingerprints unchanged**, **zero FK violations**. First-run ten-command worker medians in ms: manual direct 263.014; manual approval 143.982; OCR direct 301.453; OCR approval 156.536; update 287.644; delete 236.095; approve 188.149; cancel 59.290. Raw aggregates are in ignored `output/rubber-realdata-mutation-baseline-first.json` and `output/rubber-realdata-mutation-baseline.json`. This runs synthetic commands against the complete real-data background, not commands that alter actual copied customer bills. All mutations/settings/fixtures roll back. It does not prove full-path latency, UI recovery, or slow-job independence. Script lint and source-size checks passed.
