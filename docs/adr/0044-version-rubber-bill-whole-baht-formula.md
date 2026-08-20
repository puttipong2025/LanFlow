---
status: accepted
---

# Version the Rubber Bill whole-baht formula

Rubber Bill formula version 2 floors every calculated weigh-row value and stock-deduction value to whole baht before summing. The summed weigh value remains the average-price basis. After applying the bill-level net-weight proportion, rubber value is floored to whole baht before money deductions. Direct debt deductions retain two-decimal precision, and the final customer payable remains floored to whole baht.

The browser, offline queue payload, server normalizer, stored item totals, generated bill totals, Modal, and receipt model use this same contract. The server continues to disregard client-provided summary values and recalculates them from item inputs.

Existing bills retain formula version 1 so historical reports, transfers, exports, and audit evidence do not change. A new ordinary bill uses version 2, and editing calculation inputs on an existing ordinary bill upgrades that revision to version 2. Branch-receipt Rubber Bills retain version 1 because their carried-value and zero-payable contract is separate.

This supersedes ADR-0017 only for its two-decimal Rubber Bill rounding details and its assumption that no calculation-version workflow exists. ADR-0017's browser/server parity, offline-first, and whole-baht payable principles remain in force.

## Consequences

- Formula version is stored on `rubber_bills`; the historical-compatible table default is version 1 and a scoped trigger assigns version 2 to ordinary calculation writes.
- Versioned generated columns preserve existing rows while applying whole-baht rubber value to new and revised ordinary bills.
- Calculated line totals shown in the Modal and PDF are the exact persisted item totals, not presentation-only flooring.
