# ADR-0011: Rubber Bill Approval Precedes Source Mutation

Status: Accepted

LanFlow will store an approval request instead of creating or mutating a Rubber Bill whenever a configured price rule or edit-time rule matches. The real `rubber_bills` source remains unchanged until approval; a mismatched-price create therefore has no real bill, feed row, report item, transfer relation, or export eligibility before approval.

One request table and one approval queue cover `create`, `update`, and `delete`. Existing bills may have only one pending request, and pending approval is mutually exclusive with active Report Batch and Money Transfer relations. This keeps one source of truth and one correction path while avoiding duplicate pending-bill state.

Approval is online-only and atomic. The database owns current-setting evaluation, revision checks, relation locks, server timestamps, document numbering, stock effects, and exact application of the submitted snapshot.
