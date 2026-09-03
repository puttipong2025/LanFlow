# Background history cleanup — Local verification, 2026-09-03

## Result

Local implementation and review are complete. No commit, push, Cloud migration, Production cleanup, or deployment was performed in this change. The deployed daily-cleanup limitation remains in Production until migration `20260903020000_background_history_retention_cleanup.sql` and the matching application are released.

## Scope and simpler-alternative review

The goal is to let a manager start safe, bounded cleanup once, independent of the browser, while automatic cleanup keeps up with arrivals. Increasing only the old daily limit would not satisfy persistent manual progress or short transactions. The implementation reuses `history_cleanup_runs`, the private worker, the existing settings endpoint, and one Cron job; it introduces no queue service or external worker.

See [ADR-0059](adr/0059-background-history-retention-catch-up.md) for policy, concurrency, API, and operational limits.

## Verification evidence

| Check | Verified result |
| --- | --- |
| Original throughput repro | Insert 4,321 expired Scheduler fixtures in a rollback transaction; old worker deletes 1,000, leaving 3,321. A larger batch drains them, ruling out undeletable data. |
| Forward migration permissions | Applied with the non-superuser `postgres` migration role; no ownership/privilege escalation for Cron tables. |
| Database regression | 18 files / 328 pgTAP assertions pass on Local and on a separately initialized baseline-schema + new-migration + seed database. |
| API/UI | 8 Playwright tests pass, including auth setup, permissions, strict input, idempotency, stale confirmation, cancellation/default focus, mobile layout, metadata-only polling and refresh-failure recovery. |
| Real Cron | After HTTP acceptance, the initiating Browser context closes. The installed Cron—not a test worker call—deletes expired fixtures and preserves new ones. |
| Concurrent inserts | Rows inserted while a batch is inside deletion are not included in that batch's selected snapshot; new in-window rows remain. |
| Concurrency | A second worker skips; policy save waits for an in-flight batch; the next batch uses the new policy; an eligibility-changing row update is protected. |
| Failure / timeout | A failed batch rolls back its deletions. A real 200-ms statement timeout injected into the isolated verification environment produces safe SQLSTATE 57014 and retains the row. |
| Static/build | TypeScript with unused checks, scoped ESLint, optimized 20-page Next/PWA build and Service Worker checks pass. |
| Schema | Local DB lint reports no errors; public/private schema snapshot refreshed; diff whitespace check passes. |
| UI inspection | Desktop confirmation and 390px mobile screenshots inspected; no page-level horizontal overflow; the data table scrolls independently. |

## Backup replay

Source checkpoint: `output/production-backups/history-retention-pre-20260903-123024/` (git ignored).

- Public/private data SHA-256: `61BC1038657F308B6CA59EFB0EC2087BE0E16F774DB72DFEC55A2FE316A85D42`.
- Native Cron data SHA-256: `8350271A69BADF45A59B9557E785AF03633ECFB02C9D5ED1FE51AACD4CD12E33`.
- Both hashes were rechecked after testing; source backups were not modified.
- Data was restored only into a Docker container with `network=none` and `cron.launch_active_jobs=off`. The application Local database never received production business rows.
- The replay starts with 158,403 Cron rows, of which 95,547 are expired. Together with 326 expired application-history rows, the worker removes 95,873 rows in 96 committed batches, leaving zero eligible rows.
- Full-row fingerprints for 61 durable public/private tables and every pending-approval group remain unchanged; FK content validation finds zero violations. The two durable Payroll employment boundaries remain intact.
- Database execution time: total 3,212.63 ms; median 29.484 ms, p95 51.612 ms, maximum 134.085 ms per batch. These are local database measurements, excluding scheduler waits and client/container overhead. With one scheduled batch per minute, this backlog needs approximately 96 ticks under comparable conditions.

Reusable verification entry points:

```text
node scripts/verify-history-retention-backup.mjs
node scripts/verify-history-retention-concurrency.mjs
npx supabase test db --local
npx playwright test tests/history-retention-contract.spec.ts tests/history-retention-ui.spec.ts tests/admin-content-accessibility.spec.ts --project=chromium
npm run verify
```

The first two scripts deliberately require the isolated `lanflow-retention-verification-20260903` container with networking disabled and Cron paused. Restore the checkpoint before repeating the backlog benchmark; a previously drained database is not a valid volume fixture. Local baseline setup and detailed run receipts are in `output/history-retention-background/` and the explicitly requested Obsidian Daily plan.

## Scrutinize findings resolved

- **Managed-table ownership:** adding a Cron index failed with 42501 under the real migration role. Use the existing `runid` primary key for bounded candidate selection; keep new partial indexes only on app-owned tables. Evidence: migration candidate query and backup EXPLAIN plan.
- **Admin pending transition:** the initial rewrite omitted `PENDING_TIMEOUT`, violating the secret-free audit shape. Restore the required field and lock pending candidates with `SKIP LOCKED` to avoid overwriting a concurrent completed result. Evidence: original retention pgTAP and the final worker.
- **Job ordering:** transaction-start timestamps can misorder a request that waited for another batch. Use `clock_timestamp()` for new job insertion. Evidence: job-summary ordering and schema default.
- **Malformed confirmation dates:** JavaScript can normalize impossible dates or parse loose timestamps that PostgreSQL rejects. Validate the ISO shape and calendar date before the RPC. Evidence: invalid-date API regressions return 400.
- **Dialog focus:** React mount-time autofocus did not reliably guide later native `showModal()` with scrollable content. Preserve the native autofocus attribute on the cancellation action. Evidence: browser focus assertion passes.
- **Polling recovery:** when a policy-change metadata response led to a failed full refresh, the one-shot polling timer was never rearmed. A deterministic regression reproduced the day input staying at 15; the fix rearms polling and the same test reaches the new value 30 without another click.

No unrelated refactor, dead-code sweep, or new service was introduced. The superseded `appSwal` dependency was removed only from the updated settings component.

Verdict: **ship-ready for a separately authorized release** — the requested safety and catch-up paths are verified locally; Production rollout is explicitly not included in this result.

## Follow-up scrutiny — 2026-09-03

Intent: remove dead paths and fix observable bugs in the history-retention module without broadening deletion scope. The smaller alternative is to reuse `ApiResponseError` / `assertApiResponse` from `src/lib/auth-fetch.ts:5` rather than duplicate HTTP-error parsing or add an error framework. Keep the existing database worker, queue record and dialog primitive.

### [P2, fixed] Permission loss left a live confirmation and stale impact data

Path: cleanup confirmation or full refresh → `readResponse` → generic `Error` → display error only, with the dialog still open. Polling had its own 401/403 branch but is paused while the dialog is open. Browser regressions for both statuses reproduced the stuck confirmation; a full-refresh regression reproduced retained impact data. Server/API/RPC authorization still rejected the command: this was stale privileged UI, not an authorization bypass.

Change: use the shared status-bearing error and one `handleAccessFailure` in every read/command path; clear overview, preview, confirmation and polling error only for a current response. Clear the old error on an explicit retry, so restored access does not retain the denial message. Evidence: `src/components/admin/HistoryRetentionSettings.tsx:53`, `tests/history-retention-ui.spec.ts:127` and `tests/history-retention-ui.spec.ts:145`.

### [P2, fixed] Message-dependent conflict handling broke retries

Path: `confirmAction` caught any error containing the Thai phrase for “load latest data” and discarded the dialog. An English HTTP 409 left the stale dialog open; conversely HTTP 503 containing that phrase closed it and lost the retry UUID. Both behaviors were reproduced by changing only HTTP status/message inputs.

Change: branch on `ApiResponseError.status === 409`; leave transient errors in the existing dialog and preserve its cleanup UUID for retry. Evidence: `src/components/admin/HistoryRetentionSettings.tsx:201`, `tests/history-retention-ui.spec.ts:163` and `tests/history-retention-ui.spec.ts:196`.

### [P2, fixed] Truncated successful JSON replaced state with an empty object

Path: HTTP 200 with a truncated JSON body → JSON catch returns `{}` → `applyOverview` publishes it → rendering dereferences missing `groups` / `totalEligible` and fails. The narrowed regression reproduced a runtime reload; its first version incorrectly captured an unrelated initial-page hydration error, so observation now starts after the settings screen is ready.

Change: only handle non-2xx bodies through the existing error helper; let JSON parsing fail before publishing state. The user sees a retryable error and retains the previously loaded overview. Evidence: `src/components/admin/HistoryRetentionSettings.tsx:30` and `tests/history-retention-ui.spec.ts:178`.

### [P2, fixed] JavaScript-accepted timezone offsets caused HTTP 500

Path: `Date.parse` accepts `2026-09-03T01:00:00+16:00` → RPC argument cast → PostgreSQL rejects the displacement → generic 500. A direct read-only SQL cast and the actual authenticated API reproduced the mismatch.

Change: bound the numeric offset to PostgreSQL's supported hour/minute range before calling either save or cleanup RPC. Invalid `+16:00` / `-23:59` return 400; valid UTC, Bangkok and boundary offsets reach the version-conflict check instead. Evidence: `src/app/api/lanflow/admin/history-retention/route.ts:15` and `tests/history-retention-contract.spec.ts:96`.

### [P3, removed] Unused and misleading surface

- Save confirmation generated a UUID that no request consumed. The discriminated `Confirmation` type now requires it only for cleanup; saving allocates none. Evidence: `src/components/admin/HistoryRetentionSettings.tsx:35` and `src/components/admin/HistoryRetentionSettings.tsx:228`.
- Removed the unused legacy `HistoryRetentionOverview.cleanup` type; its synchronous-worker shape no longer described the enqueue result. No frontend consumer accessed it. The RPC response itself is unchanged. Evidence: `src/types/history-retention.ts:23` and repository reference search.
- Removed redundant route response casts, including the incorrect full-overview cast on the metadata-only status response. Evidence: `src/app/api/lanflow/admin/history-retention/route.ts:45`.

### Database trace and experiment ledger

Unchanged paths reviewed: Admin capability gate → manager API/RPC guards → preview/settings version/cutoff → enqueue → Cron → bounded worker → terminal-history archive trigger → status response. The worker's ten delete targets remain in `supabase/migrations/20260903020000_background_history_retention_cleanup.sql:248`; the archive/replay guard and RLS seams remain in `supabase/migrations/20260903010000_configurable_temporary_history_retention.sql:224` and `:602`. This follow-up does not change either migration or the schema snapshot.

| Experiment | Outcome and differential |
| --- | --- |
| Before fixes: 401/403 confirmation, forbidden refresh, English 409 | All failed on the old UI; status had been erased before the error branch. |
| Opposite input: HTTP 503 with conflict-like Thai text | Dialog disappeared and a second confirmation was unavailable; distinguishes a status bug from a permissions-only bug. |
| Truncated JSON after a valid overview | Runtime state failure reproduced after narrowing observation beyond unrelated page hydration. |
| Actual API offset test | Expected 400, received 500 before validation fix; supported-offset counterexamples remain accepted by validation. |
| After first fixes | All 15 API/UI/setup checks passed. An added access-restoration assertion then exposed the lingering denial message; explicit retry now clears it. |
| DB suite alongside real-Cron API suite | Six fixture assertions failed: another suite's older Cron row and running job consumed the same shared Local batch. This is test interference, not deletion of protected data. |
| DB suite rerun without the other suite | 328 assertions / 18 files pass. Run these suites sequentially when sharing one Local database. |
| Isolated real concurrency script rerun | All eight checks pass: concurrent insert, late insertion, worker overlap, setting wait/latest policy, status change, fresh history and real timeout rollback. Verification container stopped again afterward. |

Final verification after the last code fix: 15/15 API/UI/setup checks pass, including access restoration; real Cron completes after the requesting browser closes. TypeScript/noUnused, scoped ESLint, optimized 20-page build, Service Worker guard, DB lint and diff whitespace checks pass. Existing legacy-ESLint/dev-origin/line-ending warnings are not claimed resolved. The earlier backup-volume benchmark was not rerun in this follow-up; the worker SQL is unchanged. No commit, push, deployment, Cloud write or Production cleanup was performed.

Verdict: **ship for a separately authorized release** — the reproduced HTTP/UI failure paths now have passing regressions, and the unchanged database concurrency and business-retention checks remain green.
