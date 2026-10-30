# Rubber central command queue

Implementation scope: Rubber Bill create/update/delete and explicit manager approve/cancel commands. The existing business calculation, command generation, approval, OCR and report guards remain authoritative. Configuration writes remain immediate so admission can validate the current policy; local weighing tickets, taking/reviewing images, exports/branch receipts and PDF handoff retain their existing workflows.

## Command and actor boundary

The browser first commits a v2 command with `centralQueue: true` to the existing local outbox. It uploads that immutable command to the central queue; it never processes it through a competing browser worker. A database worker processes accepted commands even with every browser closed. Other authorized operators read the same branch queue and may request retry. Only a system manager with branch access can retire a queued command after the origin account is permanently closed; retirement is conditional on the latest command state and records the real manager.

Admission binds command UUID, actor, branch, operation, client identity, revision/generation and a normalized payload fingerprint. A retry cannot change payload or refresh admission time/policy. A new correction is a new command. Manager commands also bind the exact approval request UUID and its proposal fingerprint; they cannot apply to a replacement proposal.

The worker uses a private transaction execution context keyed by backend/transaction, populated only by the private worker. Rubber-specific actor-aware helpers read that protected context, otherwise use the authenticated user. No browser JWT, session or token is stored and no JWT claims are forged. Both admission and execution validate the actor's active role, branch access and manager capability. Temporary permission loss pauses; logout alone does not revoke an accepted command. OCR access remains bound to its source owner and approval provenance. Actual actor and original creator remain distinct.

## Lifecycle and outcomes

`local pending → queued → synced | pending_approval | discarded | correction_required`.

Temporary errors move to `retry_wait`; cash-count and permission failures move to `paused`. There is no committed `running` lease: one job's work and outcome commit in one database transaction under the branch lock and job row lock. A killed connection rolls the whole attempt back, making the job eligible again. Workers use bounded batches, skip locked branches, due-time ordering and backoff; terminal rows are never runnable.

Success/approval handoff, final result and removal of the queue blocker commit together. Pending approval then uses the existing approval blocker. A terminal command keeps its minimal fingerprint/result even after its proposal is cleared. Every new and legacy transport checks an existing queued/terminal identity before invoking the core; an old device cannot resurrect retired work. Unknown/malformed/network outcomes never authorize removal.

Confirmed stale generation/revision and confirmed update/delete business rejection retire only that command, preserving the Server bill/new request. An invalid offline create retains a correctable proposal. Current local snapshots must match before local cleanup; unrelated/new/dependent work survives. Exact authorized deleted proof retains the existing silent retirement exception.

## Admission snapshot

Server admission generates immutable `accepted_at` and captures the authoritative price policy and decision. Evaluation of bill-date/edit-window and price thresholds uses that snapshot for that same command. Worker time must not add time/price approval merely because the queue waited. Offline proposals use the first successful Server admission time, not the client clock. Current revision, branch/actor permissions, cash-count/report/transfer locks, OCR source and stock availability are rechecked during execution. The user's price/weight/amount are never changed to force acceptance.

Only a protected execution context may select an admission snapshot. Client-supplied snapshot fields/settings are not authoritative. Old commands without a trusted snapshot keep their compatibility behavior. Manager approvals validate the exact request and latest revision/relations again; accepting a manager command is not approving the bill.

## Locks, reports and scheduling

Acquire the existing branch advisory transaction lock before command/job rows and before business changes. Admission, worker, retry/retirement and report creation share that order. A worker skips a locked branch rather than making unrelated branches wait. Command generations advance through the existing core, not separately at admission (which would make a command stale against itself).

Nonterminal central commands block the branch's latest report using the existing Rubber report/cutoff rules; completed history does not. Queue-to-approval transition is atomic and not double-counted. Existing zero-price, approval and other module blockers remain. Cash-count-start shares report blocker helpers: keep the existing temporary-unlock path and never make the worker unlock itself. Report preflight can wake due work before the report transaction, but must not hold the report lock while waiting for that worker. The actual report RPC rechecks blockers.

Use installed `pg_cron` (Local 1.6.4) for a short, bounded private processing tick. Verify schedule and processing after installation, bound retry age and batch size, expose safe queue status/counts and operational age/error counters. Prove worker processing without browser traffic; cron declaration alone is insufficient evidence.

## UI, reads and printing

Unsent-new-bill deletion exception (2026-10-30): pending edits remain disabled.
Only a new local bill with explicit proof that submission has not started may
open the existing delete confirmation, including offline. Confirming cancels its
local create history without enqueueing a server delete. The mutation rereads
the owner/branch outbox, rejects attempted/accepted/unknown/server-backed work,
and atomically checks the complete record snapshot before removal. Concurrent
submission or dependent commands make cancellation fail without losing work.
Approval/report/transfer, mutation-busy and other existing action guards remain.
Printing eligibility and already-issued local PDFs are unchanged.

Branch-scoped read RPCs return bounded pages and counts to authorized users, with conditional action APIs. Local-only and central rows deduplicate by command ID. A shared owner-level uploader/reconciler and bounded branch feed refresh keep other devices current; no timer per branch.

Keep errors local to the action and durable minimal outcomes separate from runnable commands. An off-branch command cannot open a toast, service overlay, cash-lock screen or PDF, or change the selected branch. Minimal terminal notices remain visible through the branch queue without retaining rejected proposal payloads solely for notification.

Eligible new offline/online bills and online edits start a frozen local-reference PDF after durable local acceptance, before central completion. Local approval-required/unknown eligibility blocks that share; Server approval and authorization remain authoritative. Serialize origin-tab handoffs, recheck the current account/branch scope, and skip permanently after scope leave. Central completion has no PDF trigger. Cancelled/failed PDF never replays business or starts a retrospective share. Manual confirmed Server receipt printing remains. See [ADR 0087](adr/0087-immediate-local-rubber-receipt.md) and the [local verification ledger](rubber-immediate-pdf-verification.md).

## Verification and rollback

Daily `10_Daily/2026-10-28 4.md` owns the Phase checklist and A01–A30 evidence. DB/route/race tests gate client integration. Test terminal replay, actor isolation, immutable admission, accepted-time/price policy, report/approval races, permission/cash pause, batch recovery, correction, multiple-device refresh and printing. Keep legacy controls and Income/Expense regressions. Record every failing run, differential control and verified fix in the implementation ledger.

Implementation evidence and A01–A30 mapping: [verification ledger](rubber-central-queue-verification.md). Rollout, rollback, bounds, latency targets and read-only diagnostics: [operations runbook](rubber-central-queue-runbook.md). The experimental old offline browser suite has separate setup interference recorded in the ledger; it is not counted as a passing gate.

Deploy compatible Server queue/guards/schedule before enabling the new client. Preserve contexts, terminal receipts and worker-compatible schema during client rollback. Local verification does not assert Cloud migration, hosting or customer-device recovery. Publish/Cloud mutation needs the user's applicable authorization; this implementation does not infer it from a plan approval.
