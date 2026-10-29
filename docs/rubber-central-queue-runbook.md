# Rubber central queue operations

Scope: Rubber create/update/delete and explicit manager approve/cancel decisions. Income/Expense remains an independent workflow. This runbook describes Local-verified code; it does not record a Cloud deployment.

## Entry points and rollout

| Entry | Execution |
| --- | --- |
| Bill form, correction, delete confirmation | Validate current context; commit local v2 outbox; owner uploader admits centrally |
| Manager approve / delete pending request | Explicit confirmation; commit local manager command; exact request UUID is immutable |
| Automatic / manual retry | Same command UUID and payload; read central outcome after admission; no second browser business processor |
| Old browser business POST | Existing legacy compatibility for untouched bills; known central identities return receipts; unknown commands cannot overtake a bill using central admission |
| Price/date settings | Immediate configuration: determines policy for future admission |
| OCR capture/review, local tickets, export/branch receipt, PDF | Existing dedicated workflows; OCR source is still checked by business execution |
| Report creation | A separate bounded branch preflight, then the original report transaction rechecks blockers |

1. Apply append-only Server migrations `20261028030000` through `20261029015000` in sequence after their dependencies. Keep all existing command receipts and contexts. Do not reset the public schema or Auth.
2. Verify private queue/context tables have no public/anon/authenticated privileges; private worker and batch kernel must not be executable by these roles. Public RPCs check the active actor and branch.
3. Verify pg_cron is available with subminute scheduling, the `rubber-central-queue` job is active, and a controlled admitted command completes with every browser closed. Local pg_cron is 1.6.4; verify the target separately before enabling a new client.
4. Publish the compatible client only after Server admission/read/worker/report guards are installed. New client commands explicitly carry `centralQueue`, actor identity and queue version. No service credential belongs in the client.
5. Run the two-device browser scenario and check no off-branch PDF/dialog/toast occurs. No automatic report is created when work drains.

The existing IndexedDB version remains 6 (already required by the separate Income/Expense work). Rubber reuses the outbox and receipt/tombstone stores; it adds no destructive local migration.

## Timing and recovery

- A database cron tick runs every 10 seconds, processes at most 20 jobs and considers at most 80 candidates. Due jobs are interleaved by branch; locked branches use try-lock and are skipped.
- Each attempt's business effect, terminal receipt, proposal cleanup and blocker handoff share one transaction. No committed running claim exists. Killing the transaction rolls back the whole attempt; next due tick can retry it. Cron enforces an 8-second statement timeout and 2-second dependency lock timeout; report preflight uses a 250 ms lock timeout. A query cancellation inside a job rolls back that job, records `ATTEMPT_TIMEOUT` and backs off. The tick stops taking new work after its 7-second budget; a connection kill outside the job boundary still rolls back the outer tick safely.
- Infrastructure failures back off from 5 seconds to a maximum 300 seconds. Rights/cash pauses check again after 30 seconds. Invalid create drafts wait for correction; they never disappear because a network response is uncertain.
- Owner upload/reconciliation rounds use the existing 30-second coordinator; one round considers at most 20 commands and interleaves branches. A failing branch is deferred for that round. Reconnect/unlock also wakes the coordinator. Each upload has a 15-second transport timeout and each session probe an 8-second timeout.
- The selected branch queue polls every 10 seconds while online. A central revision change invalidates its normal feed/counts even without a sender in that browser. Hidden-tab timer throttling can delay refresh. Offline UI states explicitly identify cached/local information.
- The existing all-branch actionable badge RPC includes central work for authorized branches without another per-branch polling loop. Work already represented by an unpriced/pending-approval badge is not counted again; other module counts retain their existing rules.
- Local targets under an idle reachable system: Server completion normally within two 10-second ticks; selected shared view within a further polling interval. These are diagnostic targets, not measured Cloud SLOs or browser/physical-printer guarantees.

## Diagnose safely

Run these read-only queries as a database operator. Never expose raw proposals or OCR references in an ordinary queue summary.

```sql
select state, error_code, count(*), min(accepted_at) as oldest,
       max(attempts) as max_attempts
from private.rubber_queue_jobs group by state,error_code order by state,error_code;

select command_id,location_id,action,state,accepted_at,next_attempt_at,
       attempts,error_code,version,completed_at,retired_by
from private.rubber_queue_jobs
where state <> 'done' order by accepted_at limit 100;

select jobid,schedule,active from cron.job where jobname='rubber-central-queue';
select status,start_time,end_time,return_message
from cron.job_run_details
where jobid in(select jobid from cron.job where jobname='rubber-central-queue')
order by start_time desc limit 10;
```

Use the authorized queue retry action to wake a paused/retry command at its current version. It does not restore rights or unlock cash counting. Fix permission assignments or use the existing deliberate temporary cash unlock first; a worker never unlocks itself. Unknown generic failures remain retryable for investigation rather than silently discarding business work.

Only a system manager with branch access can deliberately retire a nonterminal job after authoritative Auth-user absence. `is_active=false` alone is temporary and is insufficient. The conditional action records manager/time and removes just that command's blocker. If a worker already completed, refresh the final outcome; do not undo the bill. Existing pending approval/zero-price/other-module blockers still apply.

## Rollback rehearsal and limits

Client rollback retains the Server queue, scheduler, actor boundary, report blockers and terminal receipts. An old client may read known results; after a bill has central history it cannot submit a new unknown legacy intent. This deliberate upgrade guard prevents old offline devices from reviving retired work. Keep a compatible client available for new actions on these bills.

For emergency admission freeze, revoke the new admission RPC from authenticated users while retaining reads, reconciliation and worker processing of accepted work. Restore its grant only after validation. For emergency worker pause, disable the named cron job: all unfinished commands remain report blockers until processing resumes. Do not delete jobs, command heads, receipts, tombstones, pending approvals, or execution attribution helpers during rollback.

Local rehearsal evidence uses rollback of an executed attempt, exact legacy receipt replay, revoked/restored actor rights, manager retirement, concurrent workers versus report creation, and a real cron-only completion test. Cloud migration/hosting checks require a separate deployment run against the authorized target. PDF delivery tests verify generated downloads; they cannot confirm physical paper output.

Run the database suite and browser suite sequentially against a shared Local database. Some existing dashboard/retention fixtures deliberately cover all active branches; a browser concurrently creating a branch can invalidate their fixed branch-count expectations.
