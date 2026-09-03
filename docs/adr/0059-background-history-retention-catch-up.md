---
status: accepted
date: 2026-09-03
extends: ADR-0058
---

# Run bounded history cleanup in the database independently of the browser

Production observations showed 4,321 Scheduler history rows generated in one day against a cleanup limit of 1,000 per day, leaving 95,547 expired Scheduler rows. Increasing only the daily limit would not provide resumable manual cleanup or short transactions. Reuse `history_cleanup_runs` as the durable job record and the existing private worker as the single deletion path; do not add a queue service, another scheduler, or a browser-owned loop.

Manager confirmation and retention-setting saves enqueue or reuse one active job. One Cron tick per minute commits at most 1,000 rows per group, uses a 20-second statement timeout, and retries eligible work on subsequent ticks after failure. Empty ticks use existence checks without writing a cleanup-job row. Failed batches roll back atomically, while already committed batches remain; a subsequent automatic job can retry the remaining eligible work. Job history remains temporary under ADR-0058, not a permanent copy of deleted payloads.

## Policy changes and concurrent writes

The worker and policy writer acquire the same settings-row lock before reading or changing the policy. A confirmed policy update waits for an in-flight batch; subsequent batches use the latest saved days and Bangkok calendar cutoff. Increasing retention cannot restore deleted rows. An advisory transaction lock prevents overlapping workers, and a partial unique index permits only one running job. A request UUID deduplicates retries of the original recorded request, while additional commands during a running job reuse that job.

Deletion candidates are terminal/expired rows locked using `FOR UPDATE SKIP LOCKED`; the same rule protects stale Admin password-reset audit transitions. New inserts after a batch's statement snapshot are not part of that batch. Fresh, in-window history and pending approvals are protected; deliberately backdated/imported history that meets the age and terminal-state rules may qualify in a later batch. New Scheduler rows in a running state are not deleted even if their start time is old. Business sources, tombstones, cumulative state, employment boundaries, replay guards and permanent deletion/change audits stay outside the deletion allowlist.

## Cost and presentation

App-owned indexes match timestamp predicates without a timezone conversion on every filtered row. Scheduler deletion orders by its existing `runid` primary key: the migration role cannot create indexes on the extension-owned Cron table. Do not alter ownership or broaden privileges to work around that restriction.

Full counts run at job creation and again only when the policy or calendar cutoff changes. Batch progress adds actual deleted counts and subtracts them from the captured remaining counts. Remaining numbers are explicitly approximate until completion because other writers may add eligible history; there is no misleading percentage or exact-snapshot promise. UI polling reads status metadata only, refreshes the full overview when policy changes or a job finishes, and preserves an unsaved day value. Starting cleanup refreshes the impact summary and checks both the settings timestamp and cutoff date at confirmation.

## API and UI

- `GET /api/lanflow/admin/history-retention` and `POST action=preview/save` retain their contracts; saving now queues cleanup rather than performing deletion in the HTTP transaction.
- `GET ?view=status` returns `currentDays`, `updatedAt`, `cutoffDate`, and `lastCleanup` without full table counts.
- `POST action=cleanup` accepts `requestId`, `expectedUpdatedAt`, and `cutoffDate`; returns HTTP 202 with the accepted/reused job status and ID. It is a destructive command only after an accessible confirmation dialog, never a GET side effect.
- Both API and public RPC enforce active Super Admin/System Manager access. The browser has no direct execute privilege on the worker and no insert/update/delete grant on job records.
- `AlertDialog` keeps native initial autofocus on the cancellation action, including when scrollable impact details precede the buttons.

## Verification and operational limits

The native Scheduler backup must accompany public/private data when verifying retention. The isolated 2026-09-03 replay drained 95,873 expired rows in 96 batches, with 61 durable table fingerprints and all pending-request fingerprints unchanged and zero FK violations. Measured database time totaled about 3.21 seconds (median 29.5 ms, p95 51.6 ms, maximum 134.1 ms per batch); these are local measurements, not a Production SLA. At one batch per minute, the same initial backlog needs about 96 scheduled ticks, not 3.21 seconds of wall time.

Physical removal is eventual and bounded, not an exact midnight deadline. SQL DELETE makes space reusable through normal vacuuming; it does not promise an immediate reduction in database file size. Do not run VACUUM FULL in the cleanup path. This forward migration remains Local verified until separately deployed; it does not claim the existing Production backlog has already been removed.

Evidence: `supabase/migrations/20260903020000_background_history_retention_cleanup.sql`, `supabase/tests/history_retention_background_test.sql`, `tests/history-retention-contract.spec.ts`, `tests/history-retention-ui.spec.ts`, `scripts/verify-history-retention-backup.mjs`, and `scripts/verify-history-retention-concurrency.mjs`.
