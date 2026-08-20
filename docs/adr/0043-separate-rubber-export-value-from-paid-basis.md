---
status: accepted
---

# Separate Rubber Export value from the legacy paid basis

LanFlow stores `rubber_value_amount` on each Rubber Export item and `rubber_value_total` on its parent so material value remains distinct from the legacy paid basis. Ordinary Rubber Bills snapshot `net_rubber_value`; branch-receipt bills carry their existing `rubber_value`. Existing `paid_amount`, `paid_total`, and `average_price = paid_total / original_weight_total` keep their current compatibility contract: ordinary bills use `net_total`, while branch receipts retain the carried `rubber_value` even though their customer payable total is zero.

New branch receipts use `rubber_value_total + work_total` as their Rubber Bill value, while existing receipt rows remain unchanged. Rubber Export detail and PDF presentation use the same sum for total and average cost including work; cash, report, and legacy paid-basis surfaces continue to use the paid fields. This supersedes only ADR-0033's use of `paid_total + work_total` for newly created branch receipts and does not supersede ADR-0017's Rubber Bill calculation-parity contract.

## Consequences

- Historical exports are backfilled from their source bills and must abort rather than guess when a source or immutable paid snapshot has drifted.
- Both value snapshots become immutable with the export membership snapshot after backfill.
- No persistent Rubber Export average based on `rubber_value_total` is added; the average including work is presentation-only.
