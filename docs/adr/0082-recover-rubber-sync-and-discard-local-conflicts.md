---
status: accepted
---

# Retry transient Rubber Bill failures and discard verified local conflicts

Rubber Bill network and temporary server failures retain the immutable queued command for automatic replay. Correctable rejections stay in the sync-problem view, with their original operation and expected revision preserved when corrected. Normal feeds merge pending commands only, so rejected proposals cannot replace authoritative bill values.

The user chose to abandon conflicting local proposals instead of merging or overwriting the server bill. Automatic discard requires an authenticated, submission-bound `discard_local` resolution, an unchanged queue snapshot, and no dependent commands. Legacy or ambiguous conflicts are replayed for classification; unresolved groups remain available for explicit discard. Discard never sends a server bill deletion. Local receipt caches are cleared and normal invalidation reloads authoritative data. This deliberately loses the rejected local proposal after verified conflict, so reverting code cannot recover it.

HTTP success alone cannot acknowledge a queue command. Synced, pending-approval and discarded receipts must match the submitted operation and identity contract. In-memory single-flight shares a request within a tab; server idempotency and conditional IndexedDB writes remain responsible for cross-tab correctness.
