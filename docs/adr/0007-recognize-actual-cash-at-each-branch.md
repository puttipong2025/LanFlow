# Recognize actual cash at each branch

For cash transfers between branches, the source branch records an expense equal to the cash it sent, while the destination branch records income equal to the cash it actually received. If those totals differ, the transfer remains marked `ยอดไม่ตรง` and displays the difference instead of forcing both branches to use the same amount. This preserves the physical cash position of each branch and keeps evidence of shortages or overages rather than hiding them by changing either count.

Only a `super_admin` may settle a mismatched transfer. Settlement uses the action `ยอมรับผลต่าง`, requires a reason, and preserves both the sent and received denomination counts as immutable evidence.

The source accounting date is derived from server `sent_at`; the destination accounting date is derived independently from server `received_at`, using `Asia/Bangkok` when converting timestamps to ledger dates. A transfer sent and received on different days therefore appears on the actual day of each event.
