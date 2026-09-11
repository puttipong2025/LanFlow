# ADR-0064: Separate Rubber Weight Alert Groups

- Status: Accepted
- Date: 2026-09-11

Rubber accumulated-net-weight alerts use their own branch groups, independent from the existing Rubber Bill price/time approval groups. Each alert group has one integer threshold and at least one branch; a branch belongs to at most one alert group, while an active ungrouped branch receives no alert. The inspection interval remains one system-wide value, and group or threshold changes take effect only when the existing browser timer reaches its next scheduled check.

The migration seeds one alert group from the legacy global threshold with all branches active at migration time, while later branches start ungrouped. Inactive existing members remain attached but are excluded from checks and resume their prior group when reactivated. A single check returns globally stable group order plus candidates visible to the caller, and the UI presents every qualifying group in one acknowledgement dialog.

For one release, the legacy threshold column, config RPC, and `{ config, candidates }` response envelope remain valid so older cached clients can still read checks. New candidates add group metadata that old parsers ignore, while the legacy settings write endpoint rejects threshold-bearing requests and asks the stale client to reload instead of applying one value across every group.
