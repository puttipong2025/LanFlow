---
status: accepted
date: 2026-11-13
extends: ADR-0109
---

# Bound scheduler previews and preserve indexed work checks

Production history-retention GET requests repeatedly returned 503. The preview
reproduced SQLSTATE 57014 with the authenticated role's eight-second budget.
Even a scheduler-only aggregate exceeded five seconds. The scheduler history
heap is extension-owned by `supabase_admin`; `postgres` is not a member of that
role and the only available index is the `runid` primary key. Do not change
extension ownership, widen privileges, or increase application timeouts.

## Worker work checks

Deploying ADR-0109's worker removed its full-preview dependency and committed an
initial batch, but later batches still timed out. A temporary function replacement
inside a rolled-back Production transaction captured the exception context:
`history_retention_has_work`, called after deletion. The scheduler `EXISTS`
selected a sequential scan despite a substantial expired backlog.

Forward migration `20261113020000_indexed_scheduler_history_work_check.sql`
replaces only this predicate with an ordered scalar lookup of a non-null `runid`.
`ORDER BY runid LIMIT 1` preserves primary-key traversal; eligibility still checks
terminal status and the strict Bangkok timestamp cutoff. This does not assume
that run IDs encode event dates. All other groups, policy checks, batch limits,
permission checks, and replay behavior are unchanged.

An empty eligible set can still require examining many rows with this index.
This is a verified fix for backlog processing, not a constant-time empty check
or evidence that all Production I/O pressure has recovered.

## Preview contract — Local implementation

Forward migration `20261113030000_bounded_scheduler_history_preview.sql` adds a
private scheduler-preview helper. For heaps up to 64 MiB it returns exact terminal
counts and the oldest eligible date. For larger heaps it returns null for both
fields without scanning scheduler rows. The size threshold limits this preview
scan; it is not a latency guarantee for every database or the other groups.

`eligibleCount` and `totalEligible` are nullable. If any group is unknown, the
total must also be unknown. The UI shows an em dash and explains the missing
count in both the table and confirmation. It can still enqueue cleanup using the
authoritative policy version and cutoff. A policy-change audit stores JSON null
for an unknown count; no zero or estimate is presented as an exact count.

The new UI opts into nullable counts with `?counts=nullable`. A legacy open tab
receives a private 503 reload message if its overview would contain unknown
counts. Legacy save dialogs are rejected before a policy mutation, even before
the database rollout, so they cannot commit a change whose response they cannot
render. Status polling and cleanup receipts retain their compatible shapes.
Deploy the compatible web build first, then apply the preview migration.

The Route validates operation-specific overview, status, and acceptance payloads,
including nested counts/dates and consistency of totals. An incomplete object
must return private, non-cacheable 503 rather than crash the UI or falsely
acknowledge a job. Existing 400/403/409 behavior and request UUID reuse remain.

## Experiment ledger and verification

| Experiment | Result |
| --- | --- |
| Original Production preview, read-only, 8 s | 57014; metadata reads worked; no blocking sessions observed |
| Initial worker deployment | First committed batch, then later 20 s cancellations |
| Rollback-only worker exception context | Failure located in `history_retention_has_work` after deletions |
| Same rollback probe with indexed scheduler predicate | Succeeded; 1,000 scheduler rows selected/deleted in the rolled-back transaction; about 2 s including connection |
| Scheduled execution after follow-up deployment | At 09:40 Bangkok, four committed batches in the new job, 4,000 scheduler rows; recent cron durations 131–240 ms; no application error |
| Incomplete RPC object regression | HTTP 200 before fix; private 503 after fix |
| Unavailable-count SQL regression | Four assertions failed before; nine assertions pass after, including exact small-heap behavior and permissions |
| Unknown-count browser regression | Runtime failure before; settings and confirmation render after fix |

Local verification: 91 SQL assertions across five retention suites in rollback
transactions, 17 isolated Route tests, and 10 desktop/mobile browser tests passed.
Strict TypeScript unused checks, focused ESLint, source-size, production build,
Service Worker and bundle checks passed. A TypeScript check initially overlapped
the build's generated-type replacement and failed; the sequential check after
the successful build passed. No proven dead function/import/local was found.

Browser setup's old fixture attempted to change an existing Local phone and was
correctly rejected by the phone-change guard. Verification used a temporary
Local Admin with manager capability and a fresh session; existing accounts were
preserved. The disposable actor is removed after the browser run.

## Release and recovery boundary

The user authorized Cloud worker rollout. On project `psxwhhwjmolqperxrlzj`, only
`20261113010000` and `20261113020000` were applied. Three installed function hashes
match the tested definitions, browser worker/helper access remains denied, and
the minute cron remains active. The retention policy stays 15 days.

Before the rollout, custom-format archives captured public/private/auth/storage
and migrations, plus explicit data dumps of extension-owned cron tables. Both
archives were read completely with `pg_restore --file=/dev/null`, listed, and
SHA-256 verified. A schema-selected dump alone omitted scheduler history, so the
separate table-selected archive is required for recovery. Receipts and private
archives are ignored under
`output/production-backups/history-retention-worker-20261113/`.

The preview migration and matching Route/UI changes remain Local and uncommitted.
Deploy them together: the old web build cannot render nullable preview counts.
No web deployment, project restart, reset, Auth replacement, or full-backlog drain
is claimed. Recovery should restore the previous function definitions with a
forward migration; any historical-row recovery must be scoped to the allowlisted
temporary-history data from the archives, preserving live business/Auth state.

## Continued Production incident — Vercel follow-up

Later samples showed further 57014 failures after the four successful batches.
Other jobs subsequently committed more batches, and a rollback probe using the
installed indexed work check succeeded in approximately 5.8 seconds. The index
fix improves actual backlog processing but does not establish stable performance
under the continuing shared-service incident.

At the user's request, inspected the supplied Vercel Logs page and two
non-overlapping CLI request samples: 90 observed 5xx requests from 07:57 to 09:44
Bangkok. These are bounded samples, not total incident counts. Rubber feed had
44 HTTP 500 responses; history-retention had 12 HTTP 503 responses; Income/Expense,
stock, Dashboard, queue and lock paths were also affected. Logs show both SQLSTATE
57014 and Vercel stopping requests without an initial response within 25 seconds.
A separate error-log sample shows concurrent token-refresh conflicts (Auth 409)
on requests returning 401. No Auth race fix or other-module fix is claimed here.

The Supabase Dashboard showed project health `Unhealthy` and Micro compute.
Infrastructure displayed Disk I/O Balance 0%, with a Nov 6–12 chart; this is
evidence of exhaustion in the displayed interval, not a verified current-time
budget sample. Resource reports failed to load, direct Metrics returned 504,
and management Metrics/disk-util endpoints returned 500. The lifecycle API still
said `ACTIVE_HEALTHY`; lifecycle status is insufficient to establish runtime
health. A read-only database sample found 38 connections, zero blocking sessions,
and a long-running autovacuum; I/O timing was disabled, so its zero timing counters
do not prove zero I/O pressure. No compute resize, spend-cap change or restart
was performed. Production remains an open performance incident.
