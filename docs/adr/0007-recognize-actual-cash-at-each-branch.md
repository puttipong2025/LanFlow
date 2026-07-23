# Recognize actual cash at each branch

For cash transfers between branches, the source branch records an expense equal to the cash it sent, while the destination branch records income equal to the cash it actually received. If those totals differ, the transfer remains marked `ยอดไม่ตรง` and displays the difference instead of forcing both branches to use the same amount. This preserves the physical cash position of each branch and keeps evidence of shortages or overages rather than hiding them by changing either count.

Only a `super_admin` may settle a mismatched transfer. Settlement uses the action `ยอมรับผลต่าง`, requires a reason, and preserves both the sent and received denomination counts as immutable evidence.
