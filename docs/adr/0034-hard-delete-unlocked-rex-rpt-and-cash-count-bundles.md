---
status: accepted
---

# Hard-delete unlocked REX, RPT, and cash-count bundles with minimal audit

LanFlow will replace soft deletion for Rubber Export, ordinary Report Batch, and the paired Cash Count–Report aggregate with transactional hard deletion while preserving the existing authorization, newest-first ordering, Report Lock, Rubber Export Lock, and branch-receipt relation rules. Deletion never cascades into unrelated business records: an unlocked Rubber Export deletes its header and item snapshots; an unlocked ordinary report deletes its header and report items; and Cash Count deletion removes the submitted session, result, report items, and paired report as one all-or-nothing aggregate. A branch receipt that is successfully soft-deleted detaches its `source_rubber_export_id` foreign key while retaining the `REX` number snapshot, so an inactive receipt no longer prevents the source export from being purged.

Each successful deletion first writes a permanent, immutable audit row that contains only the document kind and number, branch, deletion actor and time, plus the prior export status or original cash-count checker when applicable. Audit rows contain no report body, bill snapshots, weights, costs, denomination counts, totals, analysis evidence, preview, or PDF, and cannot restore a deleted source. Report and Rubber Export audit is visible to every user who can open that module, scoped to accessible branches; Cash Count audit remains limited to super admins and system managers. Each module separates current data from audit through a dedicated `รายการปัจจุบัน`/`ผลตรวจนับ` versus `ประวัติการลบ` view.

`RPT` and `REX` numbers are never reused after deletion. Durable per-branch/date counters replace row-count numbering and are seeded above every number already issued. The existing 15-Bangkok-day Dashboard money-event projection still records deletion of a verified Rubber Export, but it is not a source copy and cannot open the purged record. DELETE retries may use the permanent audit identity as the idempotency boundary.

The forward migration must audit and purge legacy soft-deleted Rubber Exports and ordinary reports in dependency order without bypassing locks or cascading into other domains. It must abort if an unexpected Cash Count, paired report, active receipt, active report/export relation, or other foreign-key blocker is present. The production rollout requires a verified backup and explicit preflight; destructive rows are recoverable only from that backup.

This decision supersedes only the deleted-row retention and historical-copy portions of ADR-0010, ADR-0025, ADR-0030, and ADR-0032, and refines the deleted branch-receipt relation in ADR-0033. Their ownership, PDF generation for existing sources, balance, age, and active relation contracts remain accepted.
