# Hard-delete only completely empty branches

Status: Deferred

This decision is retained for a future branch-deletion feature. It is not part of the current branch-provisioning refactor.

LanFlow permits a super admin or system manager to permanently delete a branch only when no business or historical row in any module references it, including cancelled and soft-deleted records, and the target is not the system's last active branch. User assignments and Dashboard snapshot/configuration rows are system-owned branch state and may be removed with the branch. The API and database operation both enforce the same manager boundary, and deletion never cascades into business history.

Because an offline device may still hold unsynced work after the server observes an empty branch, deletion retains a minimal tombstone containing the immutable branch identity, deletion actor, and time. The tombstone reserves the branch code and lets late sync return an explicit deleted-branch error rather than an opaque foreign-key failure; it stores no business rows and does not make the branch active or restorable. This makes newly provisioned but unused branches removable while preserving every established record, keeping at least one active branch for workspace operation, and accepting that a branch with any history must remain in the system.
