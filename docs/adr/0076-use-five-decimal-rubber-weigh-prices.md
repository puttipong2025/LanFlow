---
status: accepted
---

# Use five-decimal prices only for Rubber Bill weigh rows

LanFlow will allow `ราคายางรายการชั่ง` to use up to five decimal places for both manual entry and price adjustment, while central price, approval allowance, adjustment targets, stock-deduction prices, average price, and monetary totals retain their existing precision. The price-adjustment tool moves every positive weigh-row price by the same `0.00001` baht/kg step, keeps zero-price rows at zero, and selects the greatest formula-v2 monetary increase that does not exceed the two-decimal target. When multiple price increments produce that same monetary increase, it selects the smallest price increment so the persisted price and approval impact are no larger than necessary.

Approval compares the exact five-decimal weigh-row price with the existing two-decimal effective cap; it does not round the item price before deciding. Formula-v2 whole-baht row values, rubber value, deductions, payable totals, replay rules, and historical bills remain unchanged. Existing bills are not recalculated; the wider price contract applies only when a bill is newly created or explicitly revised. UI and PDF show weigh-row prices with at least two and at most five decimal places so the persisted value remains auditable.

This deliberately limits five-decimal precision to the business value that needs finer adjustment. Extending every money field would change accounting semantics and downstream reports without improving the target-price workflow.
