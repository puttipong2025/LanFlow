---
status: accepted
---

# Use One Offline Rubber Bill Calculation Contract

LanFlow calculates a Rubber Bill identically in the browser and database. Each weigh row accepts at most two decimal places. The bill has one weight-deduction field; bill net weight is the sum of row net weights minus that deduction and is floored to two decimal places. Rubber value preserves the weighted value of all weigh rows in proportion to bill net weight and is rounded half up to two decimal places. Stock and debt deductions are money deductions only. The amount actually paid to the customer is the remaining amount floored to whole baht, and that same whole-baht amount feeds receipts, income and expense, transfers, and reports.

The browser performs the full calculation before an offline payment and queues the calculated source values. The database independently derives and constrains the same result when the queued bill syncs. There is no calculation-version workflow because deployed offline devices are operationally updated before a new formula is introduced. Internal source values remain stored for audit, while rounding differences are not shown to users.

Rubber-export cost uses actual paid amount divided by bill net weight and is named “ต้นทุนซื้อเฉลี่ย”. Customer-facing bill, transfer, and report views show net weight and do not expose gross weight, weight deduction, or the hidden rounding difference.
