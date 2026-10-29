---
status: accepted
date: 2026-10-29
extends:
  - ADR-0058
  - ADR-0059
  - ADR-0086
---

# Apply shared retention to completed sync history while preserving replay

Completed central Rubber sync history uses the existing 1–365 Bangkok calendar-day setting and bounded cleanup worker. Unfinished work and pending approvals remain protected. For approval handoffs, the later final command-receipt resolution starts the window; historical final receipts without a known time conservatively start at migration time.

Compact expired queue rows in place instead of deleting them or adding a second archive. Central submission and legacy sync already use these rows as replay guards. Remove proposal payload, captured price policy, display reference, target fingerprint, retirement actor and attempts; keep command identity, fingerprint, terminal result, queue version and compatibility timestamps. A purge marker excludes the compacted row from history and notices permanently. Increasing retention cannot restore cleared details. Keeping structural metadata preserves both replay paths without duplicating the command contract in another archive.

History and notices hide expired completed work immediately; physical compaction follows asynchronously. Direct command lookup remains available for old-client reconciliation. Business sources, permanent audits and replay identities stay outside deletion. See [the safety audit](../history-retention-safety-audit.md).
