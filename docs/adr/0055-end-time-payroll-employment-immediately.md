---
status: accepted
date: 2026-09-02
supersedes: END timing in ADR-0052
---

# End Time/Payroll employment immediately while preserving earned daily results

`END` changes the employee's current Time/Payroll status immediately and may be selected only for today or a future date. For today, a server-side Bangkok comparison against the effective `workdayEndTime` makes the day unpaid before the boundary and preserves the already-earned FULL, HALF, or OFF result at or after it; for a future date, `END` activates at 00:00 on the selected date and that date is unpaid. This replaces ADR-0052's next-midnight END timing so managers do not see a terminated employee remain active, while avoiding retroactive removal or duplication of earned wages; same-day return may reopen the period only while the affected payroll month remains open and every transition remains audited.
