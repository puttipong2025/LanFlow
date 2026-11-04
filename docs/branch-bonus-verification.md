# Branch bonus verification and review

Work began after explicit user authorization. The latest follow-up plan is codingDO `10_Daily/2026-11-04.md`; `2026-11-03` records the original implementation. Tests use synthetic data and dedicated/disposable databases; source app data must not be reset. The Local-only boundary in the historical sections below describes implementation work before the separate 2026-11-04 request to push `main` and Supabase DB push.

## Cloud database release — 2026-11-04

The user explicitly authorized `push main supabase dB push`. Source commit `e01918f` contains the reviewed implementation. The linked project was independently verified as **LanFlow**, ref `psxwhhwjmolqperxrlzj`, matching `.env.production.local`; Git remote is `puttipong2025/LanFlow` and the release branch is `main`.

- Preflight: production environment groups passed without printing values; migration checker passed; dry-run listed exactly `20261104010000` through `20261104016000`. The existing verified Local gates include 123 bonus SQL assertions, 22 Route tests, five concurrency cases, 11 browser workflows and `npm run verify` with 1,421 passed / two existing live-OCR skips.
- A custom Cloud archive of `public`, `private`, `auth`, `storage` and `supabase_migrations` was created before mutation and its `pg_restore --list` validated. Receipt: **24,618,580 bytes**, SHA-256 `736fb405b382017eab1be73fbba00421d927a969466b986fec476ab134c3e946`. The archive and receipts remain under ignored `output/production-backups/branch-bonus-20261104-y4NlOK/`; they must never be uploaded or committed.
- `supabase db push --linked --yes` applied all **seven** reviewed migrations. A subsequent `--dry-run` reports **Remote database is up to date**. Existing migration history is unchanged; no reset, seed, history repair or source-data copy was performed.
- Independent Cloud catalog checks verified all six relevant public entrypoints, security-definer/search-path settings, authenticated/anon grants, bonus RLS, blocked direct authenticated writes and private receipt/calculator restrictions. An existing manager's authenticated SQL role can review actual REX; an ordinary role is rejected. The public REST signature resolves and an anonymous request is rejected with **401 / 42501**. These checks do not claim an HTTP sign-in for a manager or a completed production browser flow.
- Counts and sorted row hashes for all **111 pre-existing public/auth/storage tables** match before/after. New bonus and batch counts are **zero**; no financial assessment or payment was created for verification.
- The CLI reported an optional pg-delta catalog-cache warning about a missing certificate inside its local runtime after the successful push. Independent migration history, catalog, role/REST checks and the clean dry-run establish the installed Cloud state; no repeated mutation or project restart was needed.

The matching web code is published by pushing `main` after these database checks. No separate Vercel CLI deployment or Edge Function change is part of this release request.

### Release CI follow-up

The first pushed head `9a98d03` passed the web gate and Vercel deployment. Its database gate failed **before SQL tests started**: setup used CLI 2.118.0 and successfully replayed all migrations, but the unversioned `npx supabase test db` downloaded CLI 3.0.0, which rejects the existing `[inbucket]` config. The completed job log provides the runnable failing command and excludes migration/startup failures. Pin `test:db` to the same 2.118.0 as setup; preserve the project config and applied migrations. This is a test-runner version-resolution correction, not a Cloud schema repair.

The pinned run `f3d98b7` reached all 2,266 SQL assertions and exposed one existing fixture defect at 00:00 Bangkok: `rubber_central_queue_test.sql` moved creation/admission back ten/nine minutes into yesterday while leaving the bill dated today, so the date rule correctly produced `pending_approval`. In a disposable database, forcing that day mismatch reproduced exactly the edit-window failure; changing only the fixture bill date made all 69 assertions pass, excluding worker-clock or bonus-guard regressions. The final fixture derives bill date, creation and admission from one historical Bangkok-day anchor and adds two assertions that admission is inside the five-minute window while actual execution is outside it. All 71 focused assertions pass. Production functions and Cloud migrations are unchanged. The local repro initially needed the required settings field and the source worker's revoked execute grant restored in the schema-only clone; these were harness corrections, not product changes.

## Required REX / atomic batches — final Local verification, 2026-11-04

The user authorized all follow-up phases and confirmed retaining actual A → A operating costs. The existing calculator/source projection/history guard remain authoritative; the new layer derives required inventory and disjoint assessment periods and confirms the whole batch. `20261104016000_branch_bonus_batches.sql` closes fresh writes through legacy confirm while retaining exact receipt recovery. New snapshots carry `requestVersion=batch-v1` for display; the formula remains v2.

| Verification | Result and practical scope |
| --- | --- |
| Fresh install | All seven bonus migrations replayed in a disposable database after removing only bonus objects there; original 96 + batch 27 SQL assertions passed |
| Upgrade | Existing snapshot/receipt survived upgrade from the old schema; old confirmation resolves its original saved result |
| Concurrency | 5 real database cases passed: identical/different requests, history exit before/after confirmation, and a new REX committed while confirmation waits |
| Route/parser | 22 tests passed, including canonical input, legacy precision, new integer weights/two-decimal rates and aggregate payload limits |
| Real browser | 9 workflows passed on the dedicated 55431 stack: mandatory readiness, duplicate disable/history lock/delete, lost response/reload, new unfinished source, readonly target/mobile, independent periods, unloaded invalid row, legacy receipt and changed financial sources |
| Full verification | `npm run verify`: 1,421 passed / 2 existing live-OCR skips; lint/typecheck/source-size/import/auth-outage/build/SW/bundle gates passed. Initial first load 298.8 / 320 kB |
| Main Local migration | Supabase CLI applied 20261104016000; local history matches source. `supabase-schema.sql` regenerated; no reset/seed of main Local |
| Data preservation | Full custom dump before migration: 33,090,431 bytes, SHA-256 `34ade6df7349ad2999862e428b0254a8848de8ad9d39c88646aeb97d19f71cb0`. All 77 pre-existing public table row counts/hashes matched after migration. Main bonus and batch counts remain zero |
| Real-data read | Authenticated read-only review over 32 active Local branches succeeded with the copied data; no synthetic confirmations or payments in the user's app database |

### Follow-up experiment ledger

| Experiment | Observation / differential | Result |
| --- | --- | --- |
| SQL fixtures | Tiny loss rounded away at the actual weight column scale; direct edits of verified weights correctly rejected | Used positive raw loss at supported precision and the actual weight-adjustment RPC; did not weaken guards |
| Test environment | Dedicated UI stack lacked the existing weight-adjustment RPC; clone ownership required migration owner privileges | Applied the existing weight migrations only to the test stack and fixed the disposable schema helper; main data was untouched |
| Batch atomicity | Injected failure on the later result insert; also evaluated multiple periods with old global differences present | No partial result/membership/receipt; calculate-all-before-write handles old differences and acknowledges shared observations once |
| Apparent Next-button failure | Browser trace showed development-only TanStack artwork intercepting the click; actual Next handler was never reached | Hiding only the development tool in the browser harness removed the interception; no product navigation workaround or forced click |
| Changed financial sources | Runnable browser regression failed: 409 invalidated preview but remained on the final step | Returned to review, cleared manual overrides, retained the error until explicit review; regression passed |
| Invalid numeric input | Validation needed to block invalid text rather than silently normalize to valid final zero; error text inside a wrapping label also changed its accessible name | Invalid values block progress, errors have stable descriptions outside the label, corrected input and 0.025 → 0.03 pass in real browser |
| Manual final zero / first click | Replacing a nonzero amount with 0 initially appended to a reformatted focus value; preserving two decimals fixed selection. A second reproduction showed blur adding a summary block and moving Confirm between pointer down/up, with no request sent | Keep the nonzero focus format stable and render the final summary from the suggested amount before editing. A real single-click regression saves the first period as 0 and preserves the other period's independent positive amount |

Evidence receipts/logs are ignored under `output/branch-bonus/`: `batch-verify-final.log`, `batch-browser-final.log`, `batch-concurrency-final.log`, `fresh-branch_bonus_test.sql.log`, `fresh-branch_bonus_batch_test.sql.log`, backup receipt and before/after public fingerprints. Backups contain Local Auth/data and must remain ignored; no credentials are recorded here. Background web is intended to remain available at `http://127.0.0.1:3000` against ordinary Local 55421.

### Subsequent Business/Route scan — 2026-11-04

Traced the bonus module, pending intents, input parsers, manager Route boundary, review/calculation/confirmation RPCs, history guards, deletion and receipt replay. Kept the existing calculator and transaction layer; no parallel formula, Route rewrite or additional product migration was needed. Removed the unreferenced exported `bonusInputKey` from `src/lib/branch-bonus/input.ts`. Existing public candidate/read RPCs remain compatibility interfaces, not dead code merely because the new UI uses review.

Found a verification defect in `tests/branch-bonus-concurrency.spec.ts`: cloning an already-upgraded Local schema made `ensureBonusBatchSchema` return before applying an upgrade. An assertion requiring the batch entrypoint to be absent reproduced the defect reliably (`scan-upgrade-repro.log`). Ranked explanations were an upgraded clone, fixture installation, or an installer failure; the clone source already contained the entrypoint and the helper explicitly returned early, ruling out fixture installation and a failed migration. The fix removes only batch objects in the disposable clone and restores the actual previous public writer before seeding a saved receipt. The regression requires the old schema before upgrade, proves unchanged saved evidence and exact receipt replay afterward, and rejects a fresh legacy confirmation. All five contention cases then passed (`scan-upgrade-fixed.log`); ordinary Local was not downgraded.

First rescan gates: fresh seven-migration install with 96 + 27 SQL assertions, 22 Route/parser tests, five real concurrency cases including the corrected upgrade setup, lint and typecheck passed. No new product Business Logic/Route defect was reproduced in that scope. No UI/product behavior changed in that pass, so the previous nine browser workflows and full build verification remained earlier evidence rather than reruns claimed for that scan.

### Second Business/Route scan — retrying an empty review, 2026-11-04

Reproduced a recovery dead end in `BonusBatchForm.tsx`: interrupt an uncommitted confirmation, reload with its pending intent, change an REX, and retry. The actual Route/RPC returns 409 and the client clears the pending request, but `review` is still null because the initial load was skipped while pending. The mount-only load does not rerun, and the old render condition hid the existing reload button together with the absent review. The user saw “ชุด REX เปลี่ยนแล้ว กรุณาตรวจใหม่” with only disabled navigation (`scan-recovery-repro.log` and its browser trace).

Ranked hypotheses: missing review-dependent recovery controls; pending state not clearing; or authorization/network work still blocking the form. The repro first verifies the real 409 and disappearance of the pending button, ruling out the latter two. Source trace narrowed the cause to `step===1&&review`; changing only this render condition made the same regression pass. Reuse the existing explicit reload operation: show the first-step heading/reload button even when no review exists, with its existing fieldset protections. Do not add an automatic retry loop or clear the error before the user retries. This also fixes the first-ever review request failing with 503.

Both focused browser regressions passed (`scan-recovery-fixed.log`): retry after the actual source-conflict response returns to the current readiness checks without saving any result, and an initial 503 can load the four ready REX in the same form. The full regression gates are recorded after these focused runs. Removed the unused `endpoint` constant from the browser test; no calculator, Route or migration changed in this pass.

Final second-scan gates: all **11** real browser workflows passed (`scan-recovery-browser-final.log`); `npm run verify` passed **1,421** isolated tests / **2** existing live-OCR skips plus lint/typecheck/source-size/import/auth-outage/build/SW/bundle gates (`scan-recovery-verify-final.log`). An additional TypeScript unused-local/parameter/import diagnostic pass over **22** bonus product/test modules found no remaining unused declarations. All **77** existing public table row counts/hashes still match. Main Local web is restored against 55421; no product database migration or Cloud operation was required.

The sections below retain the earlier implementation/review history. Their free-selection/single-confirm creation behavior is superseded by the current batch contract; historical formula and snapshot evidence still applies.

## Intent and simpler alternative

Implement one branch lump-sum assessment using historical REX, original weight, three optional weighted metrics and owner-chosen final amount. Reuse existing manager capability, branch advisory locks, NumberField/InlineNumber and AlertDialog. Keep one database source projection/calculator for preview/confirm rather than a client/SQL pair. Preserve existing cash feeds and payment logic.

## End-to-end trace

- Navigation capability and online policy → dynamic BranchBonusModule → owner/branch-scoped hook → manager-only Route → manager-checked RPC/private SQL projection.
- Historical candidate IDs → raw weight readiness → Bangkok creation-date interval → complete aggregate, paged evidence → manual goals/rate/weighted tiers.
- Persisted confirmation UUID → synchronous client claim/disabled button → request lock + branch lock → fresh shared calculation/fingerprint → snapshot, selected REX memberships, known-source observations and replay receipt in one transaction.
- REX sale reversal / receipt change → existing own-branch fence plus additional cross-branch receipt source fence → post-change history predicate. Source TRUNCATE has a statement guard because row triggers do not run for it.
- Delete → branch lock → remove snapshot and memberships/observations → keep minimal anti-replay identity with no canceled snapshot. Source bills, real payments and existing report/WEX locks remain separate.
- Source loss → recorded coverage gap; old snapshot remains readable. Differences use the last considered source value, are outside current metrics and never change money automatically.

## Experiment ledger

| Run | Observation and differential | Result / ruled out |
| --- | --- | --- |
| Clone preparation | Full privilege dump referenced excluded cron schema; ordinary schema-only clone pattern excludes ACLs | Corrected disposable setup; app DB untouched |
| SQL first | Trigger referenced local variable as a table-qualified function identifier | Renamed local variable; source insertion became runnable |
| SQL second–sixth | Fixture used nonexistent item weight column, omitted mandatory number/session/denominations, and lacked test extension/private schema access | Corrected fixtures/privilege assertions without weakening product grants |
| SQL seventh | Known monetary example and real source/guard paths | 34 assertions passed |
| Expanded SQL | Missing weights could exploit SQL null validation; coverage probe still carried JWT claims; receipt source deletion reached its existing FK first | Tightened DB shape checks; cleared both claims for purge simulation; tested sold-only bonus guard separately from retained receipt FK |
| Expanded fixed | Raw rounded-to-zero loss, replay, snapshot after loss, owner override and cross-branch receipt guard | 51 assertions passed |
| Cost source fixtures | Existing withdrawal/work/bundle source guards rejected invalid synthetic labels/status/direct parent writes | Used valid source contracts and real bundle create/save RPCs; did not weaken guards |
| Cost/volume result | Full split withdrawal, unpaid payroll, external work amount, transport, one bundle slip fee, 51 counts and zero purchase denominator | 66 assertions passed |
| Bulk erasure | Row guards cannot intercept TRUNCATE | Added statement-level history/coverage guards; 68 assertions passed |
| Initial contention | Weak startup timing could release a lock before the child writer started | Superseded by a deterministic SOURCE_READY barrier |
| Deterministic ordinary-sale contention | Unrelated sale failed BONUS_SOURCE_CHANGED under the added broad try-lock | Ruled out data/permission errors; removed redundant REX/own-branch try-lock and retained only additional cross-branch receipt fence |
| Contention regression | Duplicate same-ID confirmations, different overlapping IDs, both history-exit race orders, ordinary sale serialization | All 5 bonus cases passed in the final 36-case concurrency run |
| Initial browser | Dev compilation/aborted Strict Mode request made a body-based readiness probe unreliable | Wait for scoped HTTP response without reading an aborted body; keep application checks independent |
| Browser baseline | Actual SQL/API/UI on dedicated 55431 test instance | 4 browser tests passed, including duplicate click, lost response/reload/retry, 320/390 px, Focus Zero, leave guard and stale source rejection |
| Observation baseline | A source changed 390→391, next assessment considered it, later 392 compared against 391; deleting the considering result restored 390 | 73 SQL assertions passed; saved difference detail remained frozen |
| Test refresh ownership | New helper/observation table were created by a different role during manual test refresh; same SQL ran as admin but failed as original RPC owner | Metadata probe and role differential proved setup ownership issue; matched newly added objects to the original migration owner, preserving RPC grants |
| Disabled target validator | Negative/unfinished target from a now-0% side still blocked API input | Fixed canonical input to skip disabled targets; 16 route/input tests and real mobile regression passed |
| Moved source date | A considered document moved into a later interval and risked being counted in full again or gaining a second origin | Track considered identities including excluded sources and late arrivals; follow changes by identity outside the original dates; expanded SQL 80 passed |
| Existing branch cleanup | The new gap marker FK blocked the existing background concurrency fixture's legitimate branch deletion | Forward migration 20261104013000 cascades only coverage markers; saved bonuses still restrict branch deletion. Regression added; final SQL 81 bonus assertions passed |
| Combined test runners | Full SQL and existing main-DB concurrency fixtures reused fixed payroll IDs when run simultaneously | Ran these suites sequentially; final SQL 2,224 and concurrency 36 passed. This was runner overlap, not a product uniqueness failure |
| Modal and toast action | The bonus lock action existed but a sale confirmation modal intercepted clicks; browser trace showed the button behind its dialog | Close the failed sale dialog before offering the action; actual undo→lock→bonus-list→open→delete→unlock browser test passed |
| Post-test data check | Existing device-numbering tests deleted auth users but retained their synthetic public profiles | Added explicit owned-profile cleanup to both tests, removed only this run's four known fixtures and reran both cases successfully; profile count returned to baseline 64 |

## Initial delivery gates (before the follow-up scan)

- `npx.cmd supabase migration up --local`: applied only the four new 20261104010000/011000/012000/013000 versions; existing versions are unique and append-only. No reset/Cloud operation.
- `npx.cmd supabase test db --local`: **2,224 passed across 87 files**, including **81** branch bonus assertions, after the forward migration.
- `npm.cmd run test:db:concurrency -- --output=output/branch-bonus/final-concurrency-results`: **36 passed**, including all 5 bonus races. The two existing numbering tests also passed after the fixture-only cleanup fix.
- `npx.cmd playwright test --config=playwright.branch-bonus.config.ts`: **all 5 real SQL/API/UI scenarios passed** on dedicated local test stack 55431. Follow-up targeted reruns passed for the locked-sale action, default-closed difference disclosure and mobile 320/390 px after the final summary weight fields. These exercise actual backend writes, retry after committed/lost response, override and deletion; no mock API replaces the feature.
- `npm.cmd run test:routes`: **110 passed**, including discovery of the new endpoint and anonymous/invalid-session rejection.
- Final `npm.cmd run verify`: **passed** lint, typecheck, source-size, import-direction, auth-outage, **1,415 isolated tests / 2 pre-existing skips**, build, service worker and bundle gates. New feature route/input subset: **16 passed**. First load **298.7 / 320 kB**; offline manifest **165 assets**.
- Main Local business proof before/after the first three migrations: count+sorted row hash for **all 76 existing public tables matched**, SHA-256 `026a44596ec73c6344f68d8696c892785cf1c41d76d18718cb4ee2e0b57e899f`. The fourth migration changes only the coverage FK. Snapshot regenerated from actual Local `public,private` schemas and whitespace-normalized; `git diff --check` passed.
- After all tests and fixture cleanup, **75 original public tables still match**; the existing income-expense numbering suite touches approval-settings update metadata while restoring its settings. App source money tables match the baseline; main Local has 0 synthetic bonuses, 0 coverage markers, and original profile count 64. The recorded disposable schema-only database was removed.
- Final source review traced client, API, SQL, existing branch fence, sale/receipt writers and native dialog behavior against the requirements. The experiment fixes above are covered by actual regression paths; no unresolved feature blocker was found. Vault Daily/checklists, subsystem note and hub are verified through atomic writer receipts and audit (see the notes for the final writeback).

Verdict: **ship Local** — monetary inputs, retries and history locks are verified end-to-end. Cloud rollout still requires user authorization and all four migrations before the new web code.

## Reproduction and rollout

Use the existing Local stack on 55421/55422 for SQL and concurrency, sequentially because some existing suites reuse fixed fixture IDs. Browser config uses the dedicated existing test target 55431, with its validated private status file provided by `tests/support/bill-device-reset-target.ts`; apply the same four migrations as the original migration owner before running. Do not reset either stack or print its keys. Browser fixtures create their own actor/branch and clean sources/results/auth afterwards; test branches are deactivated.

For a separately authorized rollout, apply `20261104010000_branch_bonus_sources.sql`, `20261104011000_branch_bonus_calculation.sql`, `20261104012000_branch_bonus_commands.sql`, `20261104013000_branch_bonus_gap_branch_cleanup.sql`, `20261104014000_branch_bonus_source_loss_and_pagination.sql`, then `20261104015000_branch_bonus_day_target_and_selected_counts.sql`, verify function owners/grants/RLS/triggers and PostgREST cache, then release web code. Smoke the manager-only flow and history lock/deletion release. Recover by a forward fix; preserve confirmed snapshots rather than dropping feature tables. No Cloud, deploy, commit or push was performed here.

## Read-only daily count goal and selected source counters — 2026-11-04

The user confirmed that the count goal is **one record per inclusive assessment day** (Jan12–Jan14 =3), read-only with gray explanatory text. Reused NumberField's readOnly behavior and aria-describedby; no editable-field Focus Zero logic was copied. The server derives the target from Bangkok REX creation-day boundaries and returns periodDays; it ignores caller-supplied count goals. Burden/loss targets stay manual. Formula v2 applies to new calculations; v1 snapshots retain their original goal. Canonical valid legacy request targets are retained for exact replay, while unfinished unused count targets are normalized safely.

Expense disclosure counts now use selectedSourceCounts aggregated over all source rows. Total sourceCounts still drives pagination, so exclusions do not remove evidence or hide later pages. Both item and whole-category exclusions reduce the displayed count; restoring a category retains individual exclusions. Saved summaries derive the selected count from frozen source flags, not live source joins.

Forward 20261104015000 was applied Local only after synthetic-clone verification; original applied migrations remain unchanged. **96 SQL assertions, 19 route/input tests, 5 bonus concurrency tests and all 6 real API/SQL/browser workflows passed.** The new UI journey verifies 51→50→0→50 selected expenses across 51 source rows, usable later-page evidence, readonly target1→3 when REX dates change, linked gray help text, and 320/390px layouts. The first multi-day SQL fixture attempted an existing forbidden verified-REX date edit; changed only the synthetic setup to insert an additional historical REX, preserving the real immutability rule. Final full verify passed **1,418 isolated tests / 2 existing skips**, lint/types/source-size/import/auth, build/SW/bundle (298.7/320kB). The copied main Local data was not reset or seeded; test writes used the dedicated 55431 target and synthetic clone. Local web and Vault writeback are restored/verified after the gates. No Cloud, commit, push or deploy.

## Business / Route scrutiny follow-up — 2026-11-04

Retained the shared SQL calculator and existing integer/UUID validators rather than creating a second business implementation. Traced input → manager authorization → RPC/source projection → source-loss triggers/coverage → saved observations and retry/history locking. Strict unused TypeScript checking and call-site searches found **no confirmed unused function, import or local variable to delete**. Live public RPCs and snapshot evidence were retained.

Four reproduced defects were corrected:

1. **Accepted uppercase exclusion IDs did not exclude the cost.** Synthetic SQL control: lowercase exclusion leaves expense 10.00; the accepted uppercase form left 400.00. Normalize complete validated UUID keys and reject normalized duplicates/malformed suffixes. Tests cover mixed-case exports as well.
2. **Pagination could return 503 for malformed input and for its largest valid value.** Same live manager request gave offset0=200, INT_MAX=503 and INT_MAX+1=503. Node inspector stopped inside actual GET and confirmed that JS-safe=true while PostgreSQL-range=false. Reused `isNonNegativePostgresInteger`, rejected null direct-RPC offsets, and changed SQL lookahead to bigint arithmetic. Live results after fix: **200 / 200 / 400**.
3. **Purging an old source after changing its date could look like a known zero correction.** Coverage was recorded on the new day while the difference query checked only the original bonus interval. Missing sources now honor a branch/kind coverage gap conservatively. Original-day purge and authenticated correction serve as opposite controls and still behave correctly.
4. **Purging weigh lines alone could silently remove a purchase from the denominator/source evidence.** The retained bill fails payable eligibility after its last weigh line disappears, but the parent-only guard recorded no gap. The existing loss function now resolves weigh-line deletion to its parent and records coverage; normal authenticated/audited corrections stay supported.

Original applied migrations were preserved; new forward `20261104014000_branch_bonus_source_loss_and_pagination.sql` was verified in a synthetic schema-only clone and applied **Local only**. Main manual-test data was not reset: all **76 original public table counts and sorted row hashes matched before/after**, and the real-data Super Admin → selected REX → expense-review smoke passed without confirming a bonus. Local schema snapshot was refreshed from actual `public,private` schemas.

Regression evidence: **18 route/input cases, 88 SQL assertions and 5 bonus concurrency cases passed**. SQL ran in a disposable synthetic clone; no tests were seeded into the copied Production data. The clone's omitted ACLs were restored from original bonus grants before counting SQL results. Final full verification passed **1,417 isolated tests / 2 existing skips**, lint/types/source-size/import/auth checks, build/SW/bundle (298.7/320 kB); strict unused checking also passed. Local was reopened after the build. Three actual-data preview requests returned 200 with stable fingerprints in 211/224/128 ms without confirmation; this is a bounded smoke measurement, not an all-history performance claim. Runtime Node inspector probes and all diagnostics stayed in ignored artifacts; no product logging probes were added. Vault readback/audit introduced no findings, and the synthetic clone was removed. Experiment ledger: ignored `output/branch-bonus/scan-ledger.md`.

## Production data copied to Local for user testing — 2026-11-04

The user explicitly chose replacing current Local data after backup. Used the existing read-only Cloud exporter (one repeatable-read snapshot; remote default_transaction_read_only enabled) and verified every export SHA-256. Source migration was `20261103010000`; retained all four newer bonus migrations and the current Local schema. No Cloud writes, migrations or deployment occurred.

Backed up Local schema/data/Auth to ignored `output/branch-bonus/local-before-production-20261104.dump` (SHA-256 `d7855a0ed2766c1b83ffc6457c5266890d82a61979acffa67fe67ef2c84a777a`) and verified its archive contents. Restored business data in one Local transaction with business triggers suspended during COPY, then checked counts for every copied source table and **210 foreign-key relationships: zero violations**. The snapshot inventory has 110 tables / 251,608 rows; seven browser/SMS security tables were intentionally excluded from restore. Production passwords, Auth sessions and browser trust were not copied. Local Auth was preserved and missing referenced Auth IDs are inert placeholders.

Local now contains **34,175 rubber bills, 2,399 income/expense rows, 440 REX and 278 cash counts**. Local cron jobs are paused and Telegram/evidence notifications disabled with remote integration secret references cleared; notification settings are deliberately different from Production. Original Local cron configuration and the imported verification receipt are in ignored artifacts. Product source and `.env.local` were unchanged by this operation.

The user requested Super Admin access. Set only the Local Auth account to the copied Super Admin's phone using the existing authorized phone-change workflow, then set a new Local-only password. Credentials are kept outside tracked docs/Vault and were provided directly to the user. Local web runs at `http://127.0.0.1:3000/login` with explicit Local API/keys (`55421`). Real UI login, Super Admin capability, bonus menu, historical REX selection and actual-data preview through expense review passed without confirming a bonus or producing a payment. Main Local bonus count remains zero. This is manual-test readiness; it does not claim that all copied users have login credentials or that Production file storage was mirrored.

## Boundaries

- There is no automatic payment, payroll split, new accounting taxonomy, cadence scoring, previous-period goal suggestion or reconstructed archive of purged history.
- Authenticated ordinary corrections retain existing deletion semantics. Future bulk purge must mark coverage before erasure; TRUNCATE/unauthenticated source removal are guarded where implemented. Erasure/import before this feature or outside guarded paths cannot be certified complete retroactively.
- The UI explicitly describes considering known differences at confirmation. Unknown/purged differences remain warnings. This is an implementation default following the existing next-assessment rule; it does not authorize automatic money adjustments.
- REX history locks also constrain bulk erasure of selected REX/last active receipt until its bonuses are deleted, as requested; snapshot retention does not bypass this rule.
