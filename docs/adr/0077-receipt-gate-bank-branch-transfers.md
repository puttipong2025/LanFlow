# ADR 0077: Gate bank branch-transfer income on recipient confirmation

- Status: Accepted
- Date: 2026-10-09

## Context

Bank transfers created with the “โอนให้สาขา” flow were previously treated as recipient income as soon as the sender saved the slips. That made the ledger disagree with the operating rule used for inter-branch cash: the recipient branch must acknowledge receipt before the amount affects its accounts. Reusing the generic payment status would also confuse “bank payment has been sent” with “recipient branch has confirmed the income.”

## Decision

Keep `transfer_status` as the payment-state contract and add an independent receipt lifecycle for new branch transfers:

- contract v1 starts as `pending_receipt` with no accounting date;
- the target branch must open the detail and confirm online;
- the bounded recipient queue serves the oldest pending transfers first so older work cannot be hidden by continuous new arrivals, and validates the fixed page cardinality against the reported total so incomplete RPC results cannot hide pending work;
- confirmation is revision-protected, single-write, idempotent, and records the authenticated actor plus Server time;
- the Bangkok date of confirmation becomes the accounting date;
- legacy rows with no receipt contract remain financially effective and cannot carry partial receipt status or receiver metadata;
- legacy rows are identified by the receipt contract version—not by their source/target shape—and remain read-only through both UI and deletion RPCs;
- pending rows are excluded from every financial projection, including the legacy dashboard overview route, and block Report and Cash Count;
- Report and Cash Count blocker queries include only receipt/deletion work created at or before their fixed cutoff;
- received rows are immutable, with receipt state and location revalidated after database locks, and deletion follows the shared cash-transfer approval setting and Report Lock rules;
- only the original creator can delete a pending receipt transfer, including through the generic money-transfer deletion RPC;
- receipt and deletion RPCs reject users without module/location access before acquiring Report locks or exposing branch lifecycle state, then revalidate mutable state after locking;
- receipt and deletion-decision API routes canonicalize valid UUID path parameters before the RPC and validate the successful RPC identity and lifecycle result before reporting success to the UI, including every returned receipt slip row, so PostgreSQL UUID normalization cannot turn a committed mutation into a false contract-mismatch response;
- the recipient queue rejects malformed RPC pages instead of silently presenting pending work as an empty queue;
- concurrent deletion-request changes return a conflict response so the approval UI can reload instead of treating them as server failures;
- the shared approval modal permits only one in-flight decision at a time and cannot be closed while that decision is being committed, preventing duplicate or cross-row submissions from producing a false failure after success;
- deletion-request amount snapshots use the same `numeric(14,2)` precision as their source transfers, so every valid transfer amount can enter the approval flow;
- receipt, deletion, and deletion-approval mutations lock the affected Report location before transfer/request rows, preventing cross-flow database deadlocks;
- all money-transfer slip write paths reject future timestamps at the database boundary.
- app badge counts are restricted to locations accessible to the authenticated user.

Virtual list states (`branch_pending_receipt`, `branch_received`) are derived by the Server so status filters, counts, and pagination remain consistent without extending the generic payment-status column.

## Consequences

The recipient queue, app badge, and Telegram digest can expose pending work without recognizing income early. Retry and concurrent confirmation cannot duplicate financial effects. Historical reports remain stable because legacy rows are not backfilled. The flow requires separate deletion-request storage and a canonical “financially effective” predicate shared by Income/Expense, Dashboard, Report, and history projections.

## Verification

Local verification on 2026-10-10 passed incremental migration application, 42 database files / 976 assertions, 400 isolated tests, 86 route-boundary tests, the authenticated route-input and branch-transfer browser suite 23/23, lint, TypeScript, source-size and import ratchets, production build, Service Worker checks, and bundle budget. Cloud/Production rollout was intentionally not performed from the mixed uncommitted working tree.
