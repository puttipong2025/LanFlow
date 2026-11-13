---
status: accepted
date: 2026-11-13
extends: ADR-0059
---

# Accept and process history cleanup independently of full preview counts

The Production inspection found four consecutive cleanup jobs ending after about
20 seconds with SQLSTATE 57014 and zero completed batches. Cron itself reported
success because the worker catches the exception and records its failure in
`public.history_cleanup_runs`. Scheduler history occupied about 3,570 MiB of a
3,803 MiB database. These observations establish a runtime failure, not that a
specific statement is the only cause of the Production timeout.

The worker's policy-change branch and manual acceptance RPC both depended on
`private.history_retention_preview_rows`. The Scheduler portion of that preview
has a sequential-scan plan. Injecting failure at the preview seam made both real
database paths fail locally; with the forward migration they proceed and delete
the expired terminal fixture while the same preview remains unavailable.

Replace the full-count prerequisite with the existing durable job and bounded
deletion path. Manual acceptance still checks the manager, policy version,
Bangkok cutoff, request identity, and active-job reuse under the settings lock.
It always queues a running job, including when the worker will subsequently find
no eligible rows. Its initial `hasMore` indicates pending inspection. Do not add
a second queue, increase the timeout, or alter extension ownership.

The worker retains a previously captured count snapshot only while its policy
and cutoff match. Otherwise it clears the snapshot instead of recounting. A null
`countsAsOf` means remaining counts are unknown while `hasMore` is true. Display
an em dash for those counts and pending inspection before the first batch, rather
than implying zero remaining rows. Successful completion still establishes zero
remaining eligible rows using the existing work checks. Explicit manager impact
previews and permanent policy-change audit counts remain unchanged.

The Route converts statement/lock cancellations (57014/55P03) into private,
non-cacheable HTTP 503 responses. Null, scalar, and array RPC payloads also return
503 instead of successful 200/202 responses. Business errors retain their existing
400/403/409 handling. This is not a complete JSON schema validator.

## Verification and deployment boundary

- New database regression: four failures before the change, four passes after.
- Retention/database suites: 82 passing assertions across four files. Migrations,
  fixtures, and worker mutations execute together inside a transaction and roll
  back. The sync-history suite masks pre-existing queue history only inside that
  same rollback transaction because it expects isolated fixtures.
- Route failure suite: 11 passing tests, covering all five request paths for
  cancellation, null and array payloads, plus existing auth/transport boundaries.
- TypeScript with unused locals/parameters enabled and focused ESLint pass.
- `supabase-schema.sql` contains the same two function bodies as the migration.

No migration was permanently applied to Local or Cloud; no deployment, restart,
statistics reset, ownership change, or production deletion was performed.

Remaining operational limits: the existing work-existence checks and Scheduler
candidate query may still read many pages. Explicit preview/save counts can also
remain expensive. Removing the count prerequisite is not a claim that the entire
Disk I/O incident is resolved, that the Production worker now meets its timeout,
or that DELETE immediately shrinks database files. Production verification must
measure successful nonzero batches and recent I/O after an authorized rollout.

Sources: `supabase/migrations/20261113010000_retention_worker_without_full_counts.sql`,
`supabase/tests/history_retention_no_count_test.sql`,
`tests/history-retention-route-failures.spec.ts`,
`src/app/api/lanflow/admin/history-retention/route.ts`,
`src/components/admin/HistoryRetentionSettings.tsx`.
