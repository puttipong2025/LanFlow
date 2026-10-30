# Rubber sync and queue-history combined release — 2026-10-29

Scope: The user authorized pushing main and Supabase forward migrations together with the queue-history retention task on 2026-10-29. This supersedes the earlier Local-only package scope. Cloud performance claims still require actual post-release observation.

## Release contents and prerequisites

The reviewed base is `0cd3024a9f5981d590ff99b2c7cc3077a8268bde`. The combined release includes Rubber sync implementation and queue-history retention, their routes/UI/tests, locked dependencies, and a schema snapshot rebuilt with both tasks. Secrets, real-data dumps, output artifacts and attachment directories are excluded. The IncomeExpense assertion correction is verification-only.

The linked Cloud project is `psxwhhwjmolqperxrlzj`, already migrated through `20261029015000`. The release applies exactly these forward migrations in order:

1. `20261029020000_sync_queue_history_retention.sql`
2. `20261029021000_rubber_queue_committed_attempts.sql`
3. `20261029022000_rubber_queue_skip_locked_lookahead.sql`

Retention compacts expired completed display history while preserving immutable command identities, durable terminal outcomes and replay protection. Pending approvals and unfinished/error states remain protected. It uses the existing Bangkok-calendar 1–365 day setting, default15. No Cloud reset, Auth replacement or business-data import is part of this release.

A fresh read-only consistent backup captured93 business tables/221703 rows before deployment; private backup receipts live under ignored `output/production-backups/`. A separate clean Local project verifies all366 migrations and the combined public/private schema before deployment. The original standalone Local patch remains a historical artifact and must not be used as the combined release.

## Optional immediate processing

Set server-only `RUBBER_QUEUE_DATABASE_URL` to a PostgreSQL connection for the same project as `NEXT_PUBLIC_SUPABASE_URL`. Local verification uses the Local database role; hosted credentials and private-worker invocation permission must be checked at rollout. Never prefix this variable with `NEXT_PUBLIC_`, include it in a package, or expose it to browsers. The app rejects a mismatched project URL. Hosted transport uses certificate verification; Local accepts only localhost/127.0.0.1 port55422.

The authenticated Route commits durable admission first, then attempts one job with a2s statement/250ms lock deadline. The worker still rechecks original actor permissions and all business guards. One connection and one active attempt per server instance bound load. A busy/missing/failing accelerator leaves the command for cron; it never changes admission into a failure. Only the exact validated receipt can acknowledge business completion. A due older command may run first.

Cron starts every2s, with at most20 separate one-job transactions and a7s start budget. An in-progress final attempt can extend the tick by up to its2s deadline. Existing `public.wake_rubber_queue` remains for report preflight; there is no browser wake Route. A legitimate job exceeding2s retries rather than finishing: monitor this and use a forward migration to adjust the limit if necessary.

After the scrutiny fix, a one-job attempt continues past locked candidates rather than inspecting only four and restarting the same search. Existing fair branch ordering, processed-job cap, seven-second kernel scan budget and statement deadlines still bound work. Client receipt checks honor server paused/retry backoff at2–30s; reconnect/cash-count unlock may force one admitted-receipt check without resubmitting unknown admissions early. Optional execution/receipt-read exceptions preserve the validated202 admission. Input envelopes require `centralQueue: true`, and history cursors require valid ISO timestamps.

## Deployment validation

Use the verification report and its artifact hashes to identify the reviewed sources. Recheck typecheck/lint/source-size/import/auth/isolated, SQL/concurrency, browser/offline/PDF and production build/SW/bundle gates. Verify old-client pending commands, `localContextPending`, IDBv7 and correction/replacement compatibility. Check the hosted project's cron support, role permissions and actual function hashes. Run synthetic branches only; keep copied real business data in the isolated offline database.

Optional Local timing probes: set `RUBBER_DETAILED_TIMING=1`, run `npx playwright test --config=playwright.rubber-performance.config.ts --grep "save 1 independent"`, then `node scripts/summarize-rubber-detailed-timing.mjs`. This test temporarily pauses/restores the Rubber cron job, gates admission on completed local PDF, and injects one short row lock. It invokes real source handlers/auth/RPC/worker/driver at intercepted browser request boundaries; it is diagnostic evidence, not a replacement for the ordinary HTTP performance benchmark. Probe files stay under tests/scripts; product code and business contracts do not change. Run a fresh production build after any dev-browser checks before service-worker/bundle verification.

The combined hosted rollout is authorized. Before deployment, Cloud had224 completed commands, no pending commands, and30 successful cron runs in the preceding five minutes. Observe the deployed version before claiming a latency improvement. Observe confirmed command latency, oldest pending age, retry/ATTEMPT_TIMEOUT rate, cron errors, active connections, lock waits and database CPU/IO. The Local warm measurements are comparison evidence, not a hosted SLA. Stop or adjust if ordinary fixtures retry/error, backlog increases continuously, connections exceed the intended budget or measured load/latency regresses. The deployment receipt below records the actual release outcome; Local timing remains Local evidence.

## Forward rollback

1. Unset `RUBBER_QUEUE_DATABASE_URL` and restart the application to disable the immediate accelerator. Durable admission and server cron continue.
2. If needed, alter only the existing cron job back to its prior command with a forward operational change:

```sql
select cron.alter_job(jobid,
  schedule := '10 seconds',
  command := 'set statement_timeout=''8s'';set lock_timeout=''2s'';select private.process_rubber_queue(20)')
from cron.job where jobname='rubber-central-queue';
```

This restores legacy batch timing and transaction limits. Keep accepted jobs/receipts and migration history. To undo the fast client polling, issue a forward client patch retaining owner single-flight, staged command resolution and30s recovery. Never clear an outbox, reset Auth, downgrade IDB or regenerate UUIDs to force an upgrade. Old tabs may continue using the unchanged queue protocol.

The historical standalone package is documented by `output/rubber-release/manifest.json`; the combined release is identified by its Git commit and Cloud migration history. Production currently uses the2s cron fallback: strict TLS verification of the optional pooler connection failed with `SELF_SIGNED_CERT_IN_CHAIN`, so `RUBBER_QUEUE_DATABASE_URL` is not installed on Vercel. Resolve the certificate trust chain before enabling that accelerator; do not disable certificate verification.

## Combined release preflight

- Clean reset:366 migrations through20261029022000; SQL65 files/1556 assertions passed.
- Cloud dry-run: exactly200,210,220; no other pending migration.
- Fresh consistent business backup:93 tables/221703 rows, before schema change; protected ignored output only.
- Worker DDL MD5 from the clean combined project: `b8b6d98e8b9bf655d4a3f8b6b22e0b42`.
- Optional hosted accelerator remains disabled pending a valid trusted TLS chain. Scheduled processing remains enabled.

## Cloud database release receipt

On2026-10-29, `supabase db push --linked --yes` applied exactly200,210,220 successfully. Linked migration history reaches20261029022000. Cloud worker MD5 matches the clean tested worker above; the active Rubber job runs every2 seconds. Immediate post-migration read-only observation found224 done commands, no pending commands, and successful recent cron runs. This is a deployment/health check, not a loaded performance benchmark.

`npm run verify` passed: lint/typecheck/source/import/auth-outage,866 isolated tests (2 intentional skips), production build,155 offline assets, service-worker checks and first-load280.5/320kB bundle budget. The CLI emitted an optional pg-delta catalog-cache certificate-file warning after successful migration; direct Cloud checks and migration-list verification independently confirmed the applied schema.

## CI seed-fixture correction

The first pushed CI web-gate passed; database-gate exposed a pre-existing seed-dependent test in `income_expense_background_test.sql`: `seed.sql` truncates profiles with CASCADE, removing the approval-settings singleton; the test updated zero rows and incorrectly expected approval. A rollback-only differential reproduced exactly3 failures when the singleton was removed and0 with it present. The fixture now inserts its singleton with ON CONFLICT DO NOTHING before setting policy. Both differential cases pass and all1556 SQL assertions pass again. No application behavior or Cloud migration changes are required.

Vercel confirmed the9146946 production deployment Ready. Subsequent fixture-only commit is tracked in Git/CI; Cloud remains through20261029022000.

## Current queue/feed rollout — 2026-10-30

The earlier disabled-accelerator and migration-boundary statements above are
historical. Production now uses trusted server-only RUBBER_QUEUE_DATABASE_CA
with RUBBER_QUEUE_DATABASE_URL; TLS identity verification remains enabled.
The existing Vercel production deployment is Ready. SQL-only optimizations do
not require changing its UI or polling behavior.

The user authorized the staged optimization plan. Cloud applied only
20261030020000 for actor-helper statement lookups, observed real completion,
then separately20261030021000 for page-first Rubber feed decoration. Exact
function hashes match tested Local definitions; ownership/ACL/security flags
are unchanged. Actor release:12read-only permission probes; feed release:
12read-only mode/cursor probes on real branches. Cron remains active every2s.
Strict-TLS schema backups and separate forward rollback scripts are verified.

Final Local gates:SQL68files/1591assertions, concurrency14, browser5,
fullverify875pass/2existing skips, build/SW/bundle282.3/320kB. Offline237complete
JSON cases per ordering preserve the feed response; SQL sums reduce60–63%
under those fixed test conditions, not a Cloud/UI speed promise. The offline
clone retains93unchanged business-table fingerprints and zero FK violations.

Short Cloud observation after feed:48feed RPC calls mean115.99ms SQL,6new
creates synced, no unfinished queue work or error codes,243successful cron
runs. No production peak-load test was run. See
`docs/rubber-queue-actor-optimization-verification.md` and
`docs/rubber-feed-page-optimization-verification.md` for limitations and the
complete experiment ledger, including failed/superseded samples.

## Main release preflight — 2026-10-30

The user authorized pushing the accumulated queue/feed optimizations, Route
boundary fixes and Rubber table changes to main. The table now uses text-only
PDF/edit buttons and places Sync between actions and customer name. The
previously deployed SQL migrations remain unchanged.

Fresh linked `supabase db push --dry-run` reports the remote database is up to
date; no additional Cloud migration is needed for this release. Fresh
`npm run verify` passes with878tests and2existing skips, lint/type/source/import/
auth-outage/build/offline/service-worker checks, and282.3/320kB first-load JS.
The focused UI/queue/feed suite passes102tests; a direct component check covers
10sync/approval combinations, action guards and empty-table column alignment.
Private environment files, generated evidence, backups and local attachments
are excluded from the commit. Hosting deployment status must be verified
separately after pushing; these checks alone do not assert a new live release.
