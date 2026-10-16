# ADR 0078: Model payment bundles as money-transfer parents

- Status: Accepted
- Date: 2026-10-16
- Implemented locally: 2026-10-16

## Context

The money-transfer queue can contain customer transfers and rubber-export work transfers that remain `pending` or `partial` across any date range. Operators need to pay these outstanding balances as one working set without destroying the identity, source documents, prior slips, or Report Lock history of the original transfers.

The existing destructive pending-transfer merge is too narrow for this workflow: it moves source items into one survivor, excludes rows with slips, and is constrained by Report Lock. Removing Report Lock would make historical reports mutable. A separate aggregate table and persisted allocation table would preserve the originals, but would add another payment identity, slip owner, lifecycle, and reporting path.

## Decision

Represent a payment bundle with an ordinary `money_transfers` parent row and link each original `money_transfers` child to that parent.

- A customer bundle contains one branch, one linked customer, and one exact bank account. An unlinked customer row or a row without an account is ineligible until corrected.
- A rubber-export work bundle contains only eligible work transfers from one branch. Customer and work transfers never share a bundle.
- Membership is a snapshot. A no-slip, unlocked bundle for the same destination can accept newly selected eligible children; membership becomes immutable after the first bundle slip or Report Lock.
- Children retain their source documents, amounts, prior slips, and Report Lock relationships. While bundled they are hidden from the default work queue and are read-only, but remain searchable and viewable from bundle detail.
- Bundle due is the sum of current child outstanding balances. Existing child slips remain child-owned and read-only in bundle detail.
- New payment evidence is stored once as an ordinary bundle-owned `money_transfer_slip`. Its effect is allocated deterministically to child balances from oldest child to newest. No copied slips and no independent allocation table are introduced; allocation detail is derived from fixed membership, child balances, and ordered bundle slips.
- An amount above all child balances remains bundle-level overpayment and is not forced onto the last child.
- Customer bundles may use the existing branch-paid-remainder behavior. The branch amount is the live remainder, not a manually entered amount. Work bundles cannot use branch-paid remainder.
- Dissolving a bundle removes only the parent-child links and parent bundle row, making children visible again. It is forbidden after bundle slips exist or after Report Lock; child slips do not prevent dissolution.
- A bundle can be Report Locked only in a terminal state: `paid`, `overpaid`, or customer-only `branch_and_transfer`. Pending and partial bundles remain outside reports.
- A terminal bundle appears as one financial row in a report, with drill-down to its children, slips, and derived allocations. Its children are not duplicated as separate financial rows in that report.

## Consequences

The feature reuses the current transfer identity, status calculation, slip storage, permission boundary, and report-detail concepts. The new durable relationship is limited to a self-reference from child transfer to bundle parent plus the minimum bundle discriminator/metadata needed to validate type and destination.

The database must enforce compatible branch/type/destination, one active parent per child, immutable bundled children, fixed membership after payment starts, and the Report Lock rules. List, count, badge, and Telegram projections must treat one visible bundle as one actionable item and must not count its hidden children again.

Because FIFO allocation is derived rather than independently edited, every read and report path must use the same server-authoritative ordering and calculation contract. If manual allocation is required later, that would be a new decision and may justify persisted allocations.

The existing destructive merge remains available under its current lock rules; this decision does not weaken or bypass global Report Lock.

## Implementation note

The verified implementation uses three additive columns on `money_transfers`: `is_payment_bundle`, `bundle_parent_id`, and `bundle_frozen_at`. The third field is the minimum durable marker needed to remember that a bundle has started payment even if its current bundle slips are later removed; without it, the same parent could incorrectly accept new children again. No bundle or allocation table was added.

The lifecycle is exposed through scoped RPCs for candidate preview, create/reuse, detail, slip save, and dissolve. Bundle create/save/dissolve serialize on the same branch advisory lock as Report creation before row locks. The detail RPC is also the server-authoritative allocation seam used by the UI and Report API.

Local verification on 2026-10-16 passed migration replay, DB lint, 1,151 pgTAP tests, 519 isolated browser/contract tests, strict TypeScript, ESLint, source-size/import checks, production build, Service Worker checks, and bundle budget. Cloud migration and deployment were intentionally not performed.

