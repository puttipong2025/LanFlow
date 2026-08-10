# ADR-0010: Rubber Export Owns Its Expense And Report References

Status: Accepted; cutoff-selection portion superseded by ADR-0019; deleted-row retention portion superseded by ADR-0034

LanFlow will keep each rubber export as the only source of truth for its work expense. A verified export may appear as a read-only Income/Expense feed row and as a `report_items` source, but the system will not create a duplicate `income_expense` row. This preserves one correction path, prevents copied amounts from drifting, and lets active report references enforce deletion order directly.

Rubber bills are reserved by active export items from the moment a draft is created. An active export therefore blocks deletion of every source report that supplied one of its bills. Conversely, an export referenced by an active report cannot be deleted until that report is deleted. Export deletion is a soft delete that expires its active bill reservations while retaining snapshots and audit history.

The module is online-only. Server-side RPC transactions own explicit selection validation, bill reservation, document numbering, status transitions, verification, deletion, authorization, and timestamps.

## Implementation

The accepted design is implemented by migration
`20260724010000_rubber_exports.sql`. Income/Expense and Report Batch read
directly from `rubber_exports`; no `income_expense` row is created. The
application exposes authenticated endpoints under
`/api/lanflow/rubber-exports`. Verified and deleted evidence is generated as a
searchable A4 landscape PDF in the browser after a fresh detail fetch. The
table and detail modal share the same direct Web Share/download-fallback
workflow, and the former `/rubber-exports/[exportId]/print` route is removed.
Generated files remain in memory and are not uploaded or persisted.
