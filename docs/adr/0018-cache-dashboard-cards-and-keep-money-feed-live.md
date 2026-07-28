# Cache Dashboard cards and keep the money feed live

## Status

Accepted on 2026-07-28. Implementation must use a forward-only migration after
`20260728010000_dashboard_overview.sql`; that migration is already installed in
the local database and must not be rewritten.

## Intent

Dashboard card values are calculated in PostgreSQL outside the page request and
stored as the latest successful snapshot per branch. The recent-money table
remains a live, keyset-paginated query. This removes repeated full-history card
aggregation from page loads without pretending the live table and cached cards
have the same freshness.

## Observed baseline

Measured against local Supabase on 2026-07-28 by calling
`public.get_dashboard_overview(..., 10)` with an authenticated branch user:

| Dataset | Execution time | Shared buffers | Temporary buffers |
| --- | ---: | ---: | ---: |
| Current local data (64 rubber bills, 23 income/expense rows and small related tables) | 25.682 ms | 2,014 hits | none |
| Same data plus 100,000 temporary income/expense rows in one branch | 276.292 ms | 9,339 hits | 4,587 reads / 4,102 writes |

The 100,000 rows were inserted inside one transaction, `ANALYZE` was run, the
RPC was measured with `EXPLAIN (ANALYZE, BUFFERS)`, and the transaction was
rolled back. No benchmark rows remain.

The current function builds card aggregates and every financial event before it
returns ten rows. The large run spilling to temporary buffers confirms that
pagination alone does not bound the work of the current combined RPC.

## Decision

Use the smallest read model that separates the two workloads:

1. One singleton settings row stores the global refresh interval. It defaults
   to 10 minutes, accepts 10–1,440 minutes, and cannot disable automatic work.
2. One state/snapshot row per active branch stores only the latest successful
   card JSON, its calculation time, source/snapshot versions, and the current
   work state. There is no snapshot-history table.
3. Source changes increment a branch `source_version`. Snapshot completion
   records the claimed version; it may mark the row ready only when no newer
   source version exists.
4. A one-minute `pg_cron` tick marks Bangkok day rollover once, then claims a
   bounded number of due branches. Card calculation runs in the database job,
   never inside the manager's HTTP request.
5. Manual refresh only queues the selected branch. It does not calculate in the
   request and cannot create a second running job for that branch.
6. Dashboard reads return the saved card snapshot and state. A separate RPC
   returns ten current money events with an opaque keyset cursor.
7. Telegram reads the same latest successful snapshot. A stale or failed
   snapshot remains usable but the message must include its calculation time
   and warning.

## State machine

The row has one visible state: `dirty`, `queued`, `running`, `ready`, or
`failed`.

| Current state | Event | Next state | Rule |
| --- | --- | --- | --- |
| none | branch becomes active / migration seed | `dirty` | Create one row; do not aggregate in migration |
| `ready` | source changes or Bangkok day rolls over | `dirty` | Increment `source_version` |
| `dirty` / `failed` | manager requests refresh | `queued` | Keep the latest successful snapshot |
| `queued` | manager requests refresh again | `queued` | No duplicate work |
| `dirty` / `queued` / retryable `failed` | scheduler claims due row | `running` | Row lock with `SKIP LOCKED`; save `claimed_version` |
| `running` | source changes | `running` | Increment `source_version`; do not alter the claim |
| `running` | calculation succeeds and versions match | `ready` | Replace snapshot and clear safe error fields |
| `running` | calculation succeeds but source is newer | `dirty` | Save the successful snapshot, keep work pending |
| `running` | calculation fails | `failed` | Preserve the previous snapshot and source version |

Only the scheduler/worker changes `running` to a terminal state. A bounded lease
allows a later tick to recover an abandoned claim; it must not run concurrently
with a live claim.

## Source-to-metric and dirty matrix

Dirty triggers attach to physical source tables, not compatibility views such
as `stock_movements`.

| Physical source | Snapshot/card effect | Live-money effect | Branches marked dirty |
| --- | --- | --- | --- |
| `rubber_bills` | purchase today, 7-day purchase, 7-day cost, accumulated payable purchase, rubber inventory | one payable bill event | `location_id` |
| `rubber_bill_items` | payable status, bill totals/weight inputs, stock deductions | bill amount is read from parent | parent bill `location_id` |
| `income_expense` | accumulated net cash, operating expense, stock sale deduction | one active income/expense event | `location_id` |
| `money_transfers` | accumulated net cash | bank transfer, customer branch-paid and cash-transfer identity | source `location_id` and distinct `target_location_id` |
| `money_transfer_cash_details` | accumulated net cash when sent/received | cash sent/received event and time | both locations from parent transfer |
| `money_transfer_items` | whether rubber/OCR rows affect accumulated cash | row remains visible but `affects_balance` changes | source entity's branch and parent transfer branches |
| `ocr_tickets` | accumulated net cash | one active OCR purchase event | `location_id` |
| `financial_transactions` | accumulated net cash and operating expense | approved withdrawal event | `expense_location_id` |
| `payroll_slips` | accumulated net cash and operating expense | approved payroll event | `expense_location_id` |
| `rubber_exports` | rubber inventory, 7-day water loss, operating expense | verified branch-expense event | `location_id` |
| `stock_entries` | stock balance | none | `location_id` |
| `stock_products` | stock item name/unit/active membership | none | every active branch |
| `locations` | active-branch work population | none | create a dirty row when active; stop scheduling when inactive |

Approval request rows do not directly change card values. Approval completion
must mutate the authoritative source row in the same transaction, and that
source mutation marks the branch dirty. A pending request alone must not make a
payable bill disappear because `private.rubber_bill_is_payable` is based on the
active synced bill and its weigh-item prices.

Dashboard settings change scheduling only. Telegram threshold changes alert
evaluation only. Neither change invalidates a card snapshot.

## Card snapshot contract

The snapshot contains card data only:

- purchase today;
- 7-day purchase total, daily average, weight and average cost;
- accumulated net cash flow;
- accumulated operating expense;
- accumulated payable rubber purchase;
- operating burden percentage;
- rubber inventory;
- 7-day water loss;
- stock items and counts.

Operating burden is:

`accumulated operating expense / accumulated payable rubber purchase * 100`.

Rubber purchase expense and inter-branch money movement are excluded from the
numerator. A zero accumulated payable purchase returns `null`, not zero.

The existing recent-money rows and cursor are not copied into the snapshot.

## Authorization contract

| Capability | Branch user/admin with access | System manager |
| --- | --- | --- |
| Read branch snapshot/status | yes, accessible branches only | yes, all branches |
| Read live money page | yes, accessible branches only | yes, all branches |
| Change global refresh interval | no | yes |
| Queue manual refresh | no | yes, selected branch only |
| Read/update branch thresholds | no | yes |
| Run claim/rebuild/complete functions | no | no; service role / scheduler only |

Next.js checks the session and requested branch before each RPC. PostgreSQL
checks `private.is_active_user`, `public.can_access_location`, and
`private.can_access_super_admin_features` as appropriate. Browser code never
uses the service role or scheduler-only functions.

The API branch guard must be
`hasSystemManagerAccess(auth) || auth.locationIds.includes(locationId)`. The
current Dashboard route checks only `locationIds`, while the database correctly
lets a system manager access all branches. New split routes must not copy that
stricter API behavior.

## Scheduler and concurrency contract

- Cron runs once per minute; the configurable interval controls eligibility,
  not the cron expression.
- Bangkok rollover compares a stored `last_rollover_date` under a row lock and
  increments every active branch exactly once per date.
- A claim uses `FOR UPDATE SKIP LOCKED`, records `claimed_version`, and changes
  one branch to `running` atomically.
- Manual queueing is idempotent while `queued` or `running`.
- Completion updates the snapshot even when a later source change exists, but
  it clears dirty state only when `source_version = claimed_version`.
- Failure stores a short sanitized error, preserves the latest successful
  snapshot, and waits for the next normal interval unless manually queued.
- The initial migration inserts dirty state for active branches only. It does
  not calculate snapshots or scan historical business tables.

## Live-money query contract

The feed keeps `(occurred_at, sort_key)` descending as its stable keyset. Each
source branch applies the cursor and a small per-source limit before `UNION ALL`;
the outer query sorts the bounded candidates and returns one extra row to create
the next cursor. No offset pagination or summary aggregation is allowed in this
RPC.

## Telegram thresholds

- Purchase average: nullable minimum per branch; alert when value `< minimum`.
- Net cash: non-null minimum per branch, default 30,000 baht; alert when value
  `<= minimum`.
- Stock: nullable minimum per branch/product in that product's unit; alert when
  balance `<= minimum`.
- The existing Telegram master switch and schedule remain authoritative.
- Normal/recovery values add no text. Abnormal values may repeat each scheduled
  digest while the condition remains true.

## Migration and rollback

Implementation is append-only:

1. Add new settings, state/snapshot, threshold, trigger, scheduler and RPC
   objects in a migration after `20260728010000_dashboard_overview.sql`.
2. Keep `get_dashboard_overview` available until the web deployment has moved
   to the split snapshot/feed contract.
3. Deploy the database before the web app and Telegram function.
4. Roll back application behavior by deploying the previous web build. Repair
   database behavior with a new forward migration; do not edit or remove an
   applied migration.

## Implementation progress

Implemented locally through `20260728120000_dashboard_atomic_manager_config.sql`.
The database now has the singleton interval, one latest snapshot per branch,
dirty-source triggers, Bangkok rollover, bounded claim/rebuild cron jobs,
nonblocking snapshot calculation, atomic manager config, per-branch Telegram
thresholds and a bounded/indexed live money feed. No snapshot history is stored.

The web app reads cards and the money feed through separate API routes and React
Query keys. System managers can set the global interval (minimum 10 minutes),
queue the selected branch, and edit three Telegram thresholds per branch. The
Telegram dispatcher reads the same completed snapshot, includes its calculation
time, repeats only values below threshold, and emits nothing for normal card
values.

Verification on local Supabase:

- dirty/queued/running/ready, Bangkok rollover, manual queue and no-lost-update
  checks passed in rolled-back transactions;
- a failed multi-setting save rolled back the interval and all thresholds;
- cached snapshot read: 4.46 ms;
- ten-row live feed with 100,000 temporary branch rows: 10.10 ms, 2,410 shared
  hits and four reads; benchmark transaction rolled back;
- TypeScript, production build, Dashboard Playwright 3/3 and focused Telegram
  formatter/modal Playwright 3/3 passed.

Database lint still reports only the pre-existing unused
`v_record_status` variable in `sync_income_expense_core` and the temporary-table
analysis limitation in `sync_rubber_bill_core_20260725010000`.

## Alternatives not chosen

- **Keep calculating in every GET:** smallest code change but repeats unbounded
  historical work and already spills temporary buffers at 100,000 rows.
- **Cache the recent-money table too:** makes the table stale and duplicates
  pagination state without reducing card-calculation risk.
- **Store snapshot history:** adds retention and cleanup work that the product
  does not need.
- **One cron job per configured interval:** requires rescheduling operational
  objects whenever config changes. A stable one-minute tick is simpler.
- **Calculate in the manual-refresh HTTP request:** couples correctness to
  request timeout and makes double-click/concurrency handling harder.

## Verification required before ship

- Migration reset/up, schema diff/lint and grants/RLS checks.
- State and concurrency tests for dirty, queued, running, failure, day rollover
  and source changes during rebuild.
- Formula and source-coverage tests.
- Stable live-feed pagination tests.
- 100,000-row benchmark proving cached snapshot reads under 50 ms and ten-row
  live feed reads under 150 ms in the agreed local fixture.
- Typecheck, production build, targeted Playwright regressions and an
  end-to-end scrutinize review from source mutation through Telegram delivery.
