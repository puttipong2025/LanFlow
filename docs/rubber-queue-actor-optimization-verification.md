# Rubber queue actor optimization — 2026-10-30

Implementation in progress; Local migration applied, no Cloud optimization release is asserted here.
Scope is Phase 1–3 of rubber-queue-and-feed-optimization-plan.md. Feed changes
are excluded from this release. Daily progress lives in codingDO
`10_Daily/2026-10-30 1.md`.

## Change and reproducible regression

Forward migration `20261030020000_rubber_queue_actor_statement_lookup.sql`
changes only three stable private permission helpers. A scalar subquery lets
PostgreSQL evaluate the protected actor lookup once per statement rather than
per scanned profile/membership row. Actor source, current permission predicates,
security-definer/search-path declarations, locks and worker transactions remain.

`supabase/tests/rubber_queue_actor_evaluation_test.sql` instruments the real
actor resolver only inside its rollback transaction, forces sequential scans,
and counts evaluations. Before the migration it reports 3 failures/15 assertions:
active lookup evaluates 5 times, manager lookup 3 times, and branch access
exceeds its three-query bound. Live deactivation, membership removal, capability
revocation, missing identity and branch decisions pass on the control.
The test is a call-count regression, not a wall-clock threshold or source-string
assertion. Its resolver instrumentation and fixtures roll back.

Local forward apply selected exactly 20261030020000. The expanded regression
passes all 19 assertions, including a protected original job actor overriding a
different ambient JWT, deactivation during execution, and restoration of the JWT
fallback after the context is removed. Catalog comparison confirms identical
owners, ACLs, stability, security-definer flags and search_path for all helpers.
Evidence: output/rubber-actor-{local-apply,evaluation-green}.log and
output/rubber-actor-catalog-{before,after}.json.

## Mixed Local baseline

`scripts/measure-rubber-branch-load.mjs` simulates independent branch actors
with committed admission, worker attempts and receipt reads, plus feed/items/
evidence/count/list reads. It accepts no Cloud URL: the target is fixed to
Local Supabase at 127.0.0.1:55422 with a bounded 16-connection pool. Each client
has its own synthetic actor and branch, with 100 pre-existing synthetic bill
headers and two new zero-price/unpriced bills at 30-second intervals. Seed
headers have no item rows; newly created bills have normal worker-created items.
This is a scoped SQL load/fixture profile, not a complete real-data/UI model.

Warm reads are excluded; arrival offsets spread clients across each interval.
Failures stay in samples and exact receipt identity, expected synced status,
attempt count, command count and business-effect count are checked. UUID-scoped
cleanup removes only synthetic rows, and original business data remain.
Counters are whole Local database/container deltas; they are not per-function
CPU attribution. No other benchmarks/builds should run during paired samples.

| Version | Clients / offered bills per minute | Commands confirmed | Median / p95 SQL workflow ms |
|---|---:|---:|---:|
| Control | 40 / 80 | 80 / 80 | 127.31 / 160.90 |
| Control | 80 / 160 | 160 / 160 | 73.12 / 106.76 |

These times exclude browser, HTTP/auth middleware, client outbox, printing and
real Internet latency. API/browser tests and the offline real-data operation
matrix are separate evidence and cannot be replaced by these values.

## HTTP and rendered-browser controls

scripts/measure-rubber-branch-http.mjs adds actual Local routing/auth/admission/
receipt traffic and concurrent list/feed reads, sharing the existing Local
super-admin test session. Distinct actor/membership behavior is covered by the
SQL workload and security tests, not asserted by this single-session HTTP load.
Each logical branch has 100 seeded headers without seeded item rows. There are
no real customer records in the fixtures. These are logical clients, not 80
rendered browser tabs. Local header-only fixtures do not replace later real-data
feed analysis.

| Control logical clients | Confirmed | Median / p95 HTTP-confirmed ms |
|---|---:|---:|
| 40 | 80 / 80 | 299.86 / 1,438.69 |
| 80 | 160 / 160 | 684.11 / 4,846.15 |

Existing browser harness: setup plus three one-bill saves passed. Click through
native outbox acknowledgement, exact final DB receipt and visible table row:
27,394.53 / 1,336.34 / 1,607.61 ms. The first slow dev-start sample is retained;
it is not discarded or called a Cloud measurement. Do not infer a universal
latency gate from three samples. Logs/artifacts:
output/rubber-actor-ui-control.log, output/rubber-actor-ui-control.json.

## Experiment ledger

- Local inventory: migration history through 20261030011000, 42 existing bills;
  pre-existing CA and packaging changes retained.
- Initial load-fixture attempts stopped before measurement: a duplicate branch
  name violated locations_name_key. UUID-qualified names fixed the fixture;
  cleanup ran. This was not a product or queue failure.
- Control 40: 80 exact committed effects/receipts, no errors; fixture jobs
  remaining after cleanup: zero.
- Control SQL 80 and HTTP 40/80: all expected commands/effects/receipts verified,
  no errors; synthetic scope cleanup completed.
- Candidate SQL 40: 80/80 confirmed, median/p95 73.99/104.03 ms. Candidate SQL
  80: 160/160 confirmed, 71.89/99.14 ms. These are single samples, not a claim
  of a measured 40-browser performance improvement.
- Candidate HTTP 40: 80/80 effects, no errors, median 287.37 ms but p95
  2,439.39 ms versus control 1,438.69 ms. This tail regression needs reversed
  ordering to separate read-start bursts, receipt polling phase and helper cost.
- Candidate HTTP 80: 160/160 exact effects/receipts, median/p95 597.78/4,290.28
  ms, but FOUR read transport errors. This run FAILS the release gate despite
  all business commands completing. The original diagnostic retained only an
  error class; a follow-up adds an allowlisted transport reason without printing
  request headers/tokens. Server log search found no 500/503 response, which
  alone does not establish the cause. Original failed artifacts are retained.

## Verified release and observation

- Reversed HTTP round (candidate first, then original helpers): 40 clients
  control/candidate median 298.82/276.86 ms, p95 2061.29/1037.42 ms; 80 clients
  963.95/327.89 ms, p95 5796.48/4792.23 ms. All effects verified, zero errors
  and zero actual read retries. Existing QueryProvider retry:1 was modeled only
  for feed/list ECONNRESET; initial failed runs remain evidence above.
- Simultaneous 40-branch HTTP bursts: 80/80 effects, median/p95
  6250.52/7931.91 ms, zero errors/retries. This is a burst bound, not steady load.
- Candidate browser 3 saves: 3355.22/1351.94/1349.51 ms; two-device and
  offline/reconnect suite passed (setup + 2 tests). SQL 67 files/1582 assertions,
  concurrency 14 cases, full verify 875 passed/2 intentional skips, lint/types/
  source/build/SW/bundle passed (282.3/320 kB). Expanded actor regression
  20/20 passed, including switching actors within one outer worker statement.
- Full operation matrix on the offline real-data clone: control and candidate
  120 samples each passed exact outcome assertions. All 93 business-table
  fingerprints remained unchanged; zero FK violations, network none, cron off.
- Exact rollback rehearsal restored original definitions and ACLs; candidate
  was then reinstalled Local. Snapshot synchronized from the actual dump for
  the three changed functions only, preserving unrelated ordering/formatting.
- Cloud dry-run selected exactly 20261030020000. Strict-TLS read-only schema
  backup 1,616,157 bytes, SHA256
  74f2e8d777893c6e5b15e4ccaa4261e50a8c3242c936da98c8d6fa629cd97661.
- Cloud forward apply succeeded 2026-10-30; actual helper MD5s match Local,
  owner/ACL/security attributes unchanged, 12 read-only real-actor probes pass.
  Cron remains active every 2 seconds. CLI optional pg-delta cache emitted its
  certificate-file warning after successful apply; separate strict-TLS queries
  confirmed applied function definitions and migration history.
- Natural Cloud observation at 05:42 UTC: 2/2 new commands completed (one synced
  create, one pending approval), no errors/retries or unfinished jobs; mean/max
  admission-to-completion 0.834/0.904 s, 118 successful cron runs. This small
  sample is NOT a controlled peak-load or click-to-DOM speed claim. `/login`200,
  unauthenticated queue401. Existing Vercel deployment remains Ready; this SQL
  change needs no new web deploy. Feed unchanged at this milestone.

Evidence: output/rubber-actor-{verify,sql-suite,concurrency,browser-recovery}.log,
output/rubber-actor-realdata-invariants.log, output/rubber-branch-load-comparison.json,
output/rubber-actor-cloud-{preflight,release,observation}.json. Private backup
paths and customer values must not be copied into public reports or Vault notes.

Rollback script: `scripts/rollback-rubber-queue-actor-statement-lookup.sql`.
It restores only prior helper definitions via a forward operational change.
It must not remove command identities/receipts or alter migration history.
