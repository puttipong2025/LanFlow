---
status: accepted
---

# Guarantee Dashboard refresh freshness without quiet-period starvation

The configurable Dashboard refresh interval is a maximum freshness target for every active branch while the scheduler and database are healthy, not a quiet-period debounce. If source data changes, the system must produce a successful Dashboard result that covers that change within the configured 10–1,440 minute interval. Later source changes must not restart the original deadline. Outages and calculation failures can exceed the target; the UI must disclose overdue data rather than promise an impossible unconditional SLA.

## Context

The existing worker marks a branch dirty and uses the same timestamp both as mutable state metadata and as the automatic eligibility clock. Every source write moves that timestamp forward. A busy branch can therefore remain ineligible indefinitely and appear to require the manual “คำนวณสาขานี้ใหม่” action.

The scheduled path itself is live: a production branch observed as dirty later became ready without manual intervention. A transaction-scoped local reproduction also showed that a newly dirty branch was not claimable until its mutable timestamp had aged past the interval. The system currently processes one branch per minute, while production has 26 active branches; that capacity cannot honor the supported 10-minute setting.

## Decision

1. Store scheduling facts explicitly instead of overloading a general update timestamp. At minimum, keep the first unprocessed change time, consecutive failure count, and next retry time. Repeated changes advance the source version but preserve the first pending deadline until a result covering those changes succeeds.
2. Dirty work is eligible immediately; use the first pending deadline for ordering and overdue disclosure, not as a gate that starts work only when it is already due. Failed work waits for its explicit retry time, not the most recent source write.
3. Process an adaptive batch on each one-minute scheduler run. The minimum batch size is `ceil(active branch count / configured interval minutes)`, with a floor of one, so every supported interval remains an actual system promise. With 26 active branches this is one branch per minute at 30 minutes and three branches per minute at 10 minutes.
4. Preserve one active calculation per branch. A manual refresh moves an eligible branch ahead of normal work but does not create a duplicate concurrent calculation.
5. Retry failures automatically after 1, 2, 5, 10, and then 30 minutes, repeating the 30-minute delay for later failures. Preserve and serve the latest successful result while retrying.
6. Present product language instead of raw scheduler states: “ข้อมูลรออัปเดต”, “อยู่ในคิวคำนวณ”, “กำลังคำนวณ”, and “อัปเดตไม่สำเร็จ”. A ready result has no extra status label.
7. If a branch exceeds its configured freshness deadline, every user sees “อัปเดตล่าช้า” and the latest successful calculation time. Only an authorized user sees the manual refresh action.
8. Do not add Telegram notifications for this condition.
9. Keep a transaction ID only as the internal source-write dedupe token. Increment `source_version` under the branch row lock once per source transaction; XID allocation order is not commit order. A transaction started earlier can write during a later rebuild and must still advance the version. `last_source_transaction_id` stays server-only.

## Consequences

- Midnight rollover and sustained daytime activity cannot postpone automatic work indefinitely.
- Scheduler capacity scales with the number of active branches and the configured promise, which increases database work at shorter intervals.
- The latest successful Dashboard remains usable during pending work and failures, but the UI must clearly disclose when it is late.
- Database, API, client state, UI copy, and tests migrated together through forward-only migrations. The production verification below records the shipped state.
- Automatic rebuilds acquire the same per-branch advisory lock as manual rebuilds, but do not update/lock the snapshot row before calculating. Source writes can therefore advance the version during calculation; completion leaves newer data dirty instead of losing it.
- A manual rebuild RPC waits for an overlapping automatic branch lock. Its existing second pass can then claim and calculate the requested version instead of exhausting both passes while the automatic calculation is still running and falling back to the next Cron tick.

## Required verification

- Repeated source changes do not move the first pending deadline.
- Twenty-six active branches can drain within a 10-minute interval by completing at least three rebuilds per minute while work remains.
- Midnight rollover drains all active branches within the configured interval.
- Failure retries follow 1, 2, 5, 10, and 30-minute delays while retaining the latest successful result.
- Manual refresh is prioritized and idempotent per branch.
- Raw scheduler states never appear in user-facing copy, and overdue disclosure is visible to every existing Dashboard-viewer role. The User payroll-only UI is not expanded.

## Production verification — 2026-09-12

- Supabase Cloud project `psxwhhwjmolqperxrlzj` applied migrations `20260912010000`, `20260912020000`, and `20260912030000`. The post-apply catalog has one active one-minute Dashboard Cron calling `private.process_dashboard_refresh_tick()`, the four new internal columns, the work index, RLS, expected grants, hardened search paths, and a blocking manual-to-automatic handoff on the shared per-branch lock.
- The production interval remained 30 minutes. The worker drained all 26 active branches to ready with no retrying branch; the five observed Cron runs completed in 235–395 ms. Read-only fingerprints for 78 other public/private/Auth/Storage tables were unchanged.
- Database-role checks preserved the payroll-only User boundary, assigned-branch Admin isolation, manager/super-admin access, manual-action authorization, derived `isOverdue`/`nextCheckAt` fields, and exclusion of scheduler metadata from browser payloads.
- Vercel production deployment `dpl_AMpwez3mm5gEp7fZnL3FhVjgFNaw` is Ready and aliased to `https://lan-flow-alpha.vercel.app`. Its uploaded file tree excludes local backups, `.env*`, Supabase temporary files, and Playwright auth state through `.vercelignore`.
- Authenticated Admin smoke showed a current successful calculation time, interval 30, the existing authorized manual button, new healthy-path wording, no raw scheduler token, and a stable desktop layout. Public root/login/Service Worker and unauthenticated API boundaries returned 307/200/200/401 as expected.
- Forced overdue, failure, retry, concurrent-write, orphan, and manual/Cron overlap cases were exercised only in Local/isolated environments; no production fixture or interval change was used.
- A follow-up deterministic overlap reproduction found that two immediate nonblocking Edge passes could both miss a five-second automatic calculation. Migration `20260912030000` makes the manual rebuild RPC wait on that calculation; the isolated race now proves the first pass observes the handoff and the second pass completes the requested version without duplicate calculation. Cloud verification reports the migration and lock contract installed, one healthy Cron job, 26 active branches, no retrying branch, and the production interval unchanged at 30 minutes.
