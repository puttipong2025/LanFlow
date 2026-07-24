# ADR-0010: Rubber Export Owns Its Expense And Report References

Status: Accepted

LanFlow will keep each rubber export as the only source of truth for its work expense. A verified export may appear as a read-only Income/Expense feed row and as a `report_items` source, but the system will not create a duplicate `income_expense` row. This preserves one correction path, prevents copied amounts from drifting, and lets active report references enforce deletion order directly.

Rubber bills are reserved by active export items from the moment a draft is created. An active export therefore blocks deletion of every source report that supplied one of its bills. Conversely, an export referenced by an active report cannot be deleted until that report is deleted. Export deletion is a soft delete that expires its active bill reservations while retaining snapshots and audit history.

The module is online-only. Server-side RPC transactions own cutoff selection, bill reservation, document numbering, status transitions, verification, deletion, authorization, and timestamps.

## Implementation

The accepted design is implemented by migration
`20260724010000_rubber_exports.sql`. Income/Expense and Report Batch read
directly from `rubber_exports`; no `income_expense` row is created. The
application exposes authenticated endpoints under
`/api/lanflow/rubber-exports` and a snapshot-backed print route at
`/rubber-exports/[exportId]/print`.
