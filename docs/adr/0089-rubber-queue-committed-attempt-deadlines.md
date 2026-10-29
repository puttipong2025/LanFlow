# ADR 0089: Commit bounded Rubber attempts from the existing scheduler

Status: Local transaction/recovery verified. Cloud rollout is deferred by the user.

## Problem and evidence

The central queue is authoritative but the old tick executes up to twenty jobs in one transaction. Exception blocks isolate failed writes without committing earlier successes. Actual connection-kill tests demonstrate that late failure rolls all earlier outcomes back. A real four-second slow bill kept an independent bill waiting for the full attempt (4,416 ms in the reproduction).

Increasing browser wake requests would still use the public batch RPC's transaction boundary. Removing location locks would affect admission, management, replacement, legacy entry, approval, reports, stock, money transfer and cash-count assumptions. That is a substantially broader change than the measured scheduling/transaction problem.

## Decision

Keep all business functions, location advisory locks, command/job/head row locks, fingerprint/revision/generation/accepted-time/policy checks and resource guards. Use the existing pg_cron job to execute up to twenty **top-level transactions**, each calling the existing worker with limit one. Each attempt has a two-second statement deadline and 250 ms lock deadline set before its SELECT. Successful business effect, receipt and blocker transition commit together. The existing query_canceled handler records ATTEMPT_TIMEOUT/backoff; the next independent command can then commit before retrying the slow command.

A temporary per-connection budget prevents starting more attempts after seven seconds; the attempt already running can finish within its two-second deadline. No more than twenty attempts are started per tick, one pg_cron job owns scheduling, and the two-second schedule reduces idle queue wait. There is no new public processing RPC, job table, lease or parallel calculation engine. Existing multi-job worker functions remain available for compatibility and report preflight; their legacy transaction boundary remains explicit.

Remove the experimental browser `/queue/wake` accelerator: it could occupy a separate, longer batch transaction and interfere with the bounded scheduler. Browser upload and scoped receipt checks accelerate visibility; the server processes accepted work without any browser. The existing authenticated `public.wake_rubber_queue` used by report preflight remains unchanged, before the report transaction and its authoritative blocker check.

After durable admission commits, the authenticated queue Route may synchronously run one bounded attempt through a server-only PostgreSQL connection. This removes the normal timer wait without moving authority into the browser. The optional `RUBBER_QUEUE_DATABASE_URL` must match the application's Supabase project; no URL or credentials enter client bundles. One connection and one in-flight attempt per server instance bound this accelerator; busy/missing/failed connection simply retains the accepted receipt for cron. PostgreSQL location/job locks coordinate multiple instances and the scheduler. The existing worker may process an older due command in that branch; the Route rereads and validates the exact submitted command before returning any completed receipt. Admission and business execution are separate transactions, so a lost HTTP response cannot undo accepted work. Turning off this environment variable disables acceleration while keeping cron and receipt recovery.

The deadline is installed in a separate SQL statement before executing the one-job worker. Parameterized branch input is taken only from a validated admission receipt following authenticated database authorization. Core execution still checks the original actor's permissions, revision, generation, policy and dependencies. No public privileged processing endpoint is exposed.

## Dependency and lock map

| Entry/resource | Order and boundary retained | Proof |
| --- | --- | --- |
| Admission | Location advisory transaction lock → existing identity/head/replacement rows → insert immutable job | migration 20261028031000, command replacement SQL tests |
| Retry/retire | Location advisory lock → exact job row/version → conditional transition | same migration; retirement/exact-target tests |
| Scheduled attempt | Location try-advisory lock → skip-locked job → protected execution context → existing core/resources → effect/receipt/blocker → COMMIT | worker migration 20261028032000 + 20261029015000 + new 20261029021000 |
| Core/legacy/approval | Existing location/bill/create/approval/OCR row locks and generation/revision checks retained | 20261028010000, 20261028042000; actual command/approval/OCR SQL suites |
| Bill number | Existing branch/date allocation and uniqueness retained; transactions still serialize same-location writes | 20261008011000 and real concurrent worker tests |
| Stock/acid and money | Existing authoritative ledger guards and relation checks remain inside the same business transaction | same core; rollback and report/transfer/cash SQL suites |
| Report/preflight | Wake in a separate RPC transaction; report takes existing location lock and rechecks all queue/approval/cutoff blockers | 20261028037000; worker/report race test |
| Cash count / transfer | Existing start/report blockers, active cash lock and active transfer checks still reject or pause execution | cash-count/transfer tests; worker permission/cash pause tests |

`scripts/audit-rubber-queue-locks.mjs` captures current reachable function signatures, hashes, calls and exact lock lines in ignored `output/rubber-sync-lock-callgraph.json`. This supplements runtime tests; it does not claim to derive implicit trigger/FK locks statically. No acquire order changed, so this decision introduces no new reversed resource ordering. A slow/deadlocked attempt is bounded and rolls back its core subtransaction before retry metadata commits.

## Alternatives and limits

- Keep the existing batch: rejected by slow-bill/late-connection-kill evidence.
- PL/pgSQL loop with exception blocks: rejected because these are not independent commits or per-statement timers.
- Parallel worker lanes or narrower branch lock: not required for the tested independent-bill outcome and would widen shared-resource correctness work.
- Batch admission: deferred; the current HTTP/context checks remain authoritative and immutable retries do not renew accepted time/policy.
- Public/browser wake: removed from the client path to keep the scheduler's transaction/deadline contract authoritative.

A legitimate single job exceeding two seconds retries rather than completing; this must be watched against real-data execution measurements and raised with a forward configuration migration if required. No universal latency SLA follows from Local tests. Post-release observation remains outside this Local delivery.

## Rollout and rollback

Apply forward migrations `20261029021000` and `20261029022000` in order with their verified prerequisites through `20261029015000`; the original standalone package excluded retention. The user subsequently authorized a combined release including retention migration20261029020000 before these two migrations. Refresh clients while retaining IDB v7, staged command resolver, outboxes and terminal identities. Old clients can still submit immutable commands to the same queue. No Auth reset, storage clear or database downgrade is permitted.

Scrutiny follow-up: the inherited candidate limit was four times the processed-job limit. Reducing processing to one job also reduced the global candidate window to four. Four older locked branches then starved an independent fifth branch on every attempt. A real concurrent test first proved that the legacy20-job call could process the free branch, then reproduced a queued fifth-branch command under the one-job call. Forward migration20261029022000 removes only the candidate-window limit, preserving the existing fair order, one-job processed cap, seven-second scan budget, per-statement deadlines, authorization and resource lock order. The test also verifies all-locked scans finish, skipped jobs retain attempts0 and execution contexts do not leak. Increasing concurrency or introducing a second scheduler is unnecessary for this failure.

To reduce or stop the fast schedule, alter only the existing cron job back to the prior ten-second/8-second batch command, or increase the attempt deadline in a forward migration. Existing accepted jobs, retry metadata and receipts remain compatible. Rolling back the browser scheduler must preserve the original owner uploader and thirty-second recovery. Restore speed configuration only after comparing confirmed receipt age, retry/timeout rates, lock waits and load against the recorded Local baseline.
