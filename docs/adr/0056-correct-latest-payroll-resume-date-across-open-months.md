---
status: superseded
date: 2026-09-02
superseded_by: ADR-0057
extends:
  - ADR-0047
  - ADR-0052
  - ADR-0055
---

# Correct the latest payroll resume date across financially open months

Time/Payroll managers may backdate `RESUME` without an arbitrary current-month limit and may repeatedly correct the start date of the current open period when that period came from the latest `RESUME`, but not when it came from the employee's initial `ENABLE`. The selectable range starts after the immediately preceding active period and ends today; every affected month must remain free of `PENDING` or `APPROVED` Payroll Slips, applied debt or withdrawal deductions, and Report Lock. The server rejects the whole change atomically at the first blocker and identifies its month, type, and document number when available.

The correction changes only the current period boundary under the existing employee payroll lock. It preserves `HALF_DAY`/`OFF` exceptions and any future `PAUSE`/`END`, recalculates projected wages from the existing attendance contract, and never changes slips, deduction balances, `remaining_amount`, or Report Lock. No new period-history table or correction-audit event is added; the period retains only its latest editor and update time. The UI offers the correction only inside the active employee's period controls, confirms old date to new date once, and does not require a reason or calculate a separate wage preview.

This deliberately trades correction history for a smaller, faster correction workflow. Financial immutability remains authoritative because payroll close, deduction application, and this correction share the same lock and month-open guards.
