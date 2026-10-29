---
status: accepted
date: 2026-10-28
---

# Durable general Income/Expense commands without pending replacement

General income/expense edits and deletions need durable local acceptance followed
by quiet submission across accessible branches. Existing deterministic revision
keys and disposable approval history cannot distinguish explicit new intent from
automatic replay after a rejected request. The sale-detail route also cannot
positively prove deletion of a general transaction.

Use a UUID bound to actor, source ID, branch, operation and immutable fingerprint,
with a private minimal receipt ledger and authenticated context/submission RPCs.
Known receipts resolve before reading the current business revision. Capture
terminal approval decisions before history cleanup; replay never recreates a
rejected approval. Retain the existing business RPC, approval rules and locks.
Do not introduce Rubber's generation/replacement workflow into this domain.

The user chose to discard exact general edit/delete drafts on positive deletion
proof and on confirmed revision conflict. Deleted work closes silently. Revision
conflict leaves a durable explanation; it must not be confused with successful
work whose response was lost or an unknown/auth/network failure. This explicitly
differs from Rubber's retention of active-bill revision-conflict drafts.

Reuse the queue, conditional primitives and existing app coordinator. Background
submission follows owner work across branches; presentation remains in the source
branch's Income/Expense screen. No cross-branch toast, modal or navigation is
introduced. Pause unsent owner work on logout/account change. A started request
may still commit under its original authenticated actor and requires reconciliation.

IndexedDB version 6 adds one outcome store so exact queue cleanup and recording an
explanation commit atomically. Preserve existing Rubber stores. This costs a
version-aware rollback: clients after rollback must still open version 6; do not
clear local work or delete Server receipts. Keep explanations until acknowledged
and receipt identities beyond temporary-history retention.

Creates, sales, transfers and unmarked legacy queues retain their original paths.
See [contract, rollout and evidence](../income-expense-background-mutations.md).
Acceptance describes the decision and Local implementation; it does not assert
Cloud migration, hosting release or recovery of a specific customer device.
