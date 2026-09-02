---
status: accepted
date: 2026-09-02
supersedes: ADR-0056
extends:
  - ADR-0047
  - ADR-0052
  - ADR-0055
---

# Correct the latest started payroll period in place

System Managers may correct the start date of the latest payroll period that has already started, whether that period came from the employee's initial `ENABLE` or a later `RESUME`, and whether it remains active or has closed. This is a correction of the existing period boundary, not a new `RESUME`: the application sends the period ID the manager reviewed, and the server locks the employee, verifies that ID is still the latest started period, checks the date bounds and every financially affected month, then updates only `start_on`, `updated_by`, and `updated_at`.

The earliest date is the day after the previous period ends, or unbounded for the first period. The latest date is Bangkok today while the period remains effective, including a future `PAUSE` or `END`, otherwise the closed period's `end_on`. The correction may move earlier or later but may not overlap another period, move after the period end, delete the period, or target a future scheduled `ENABLE` or `RESUME`. A stale period ID fails without changing any row.

Attendance continues to derive from the existing period and exception model, so newly included days are full days by default while existing `HALF_DAY` and `OFF` exceptions remain authoritative. The correction preserves `end_on`, earned current-day results, future period actions, period identity, slips, deduction balances, `remaining_amount`, and Report Lock. Every month containing a changed day in the half-open range between the earlier boundary and the later boundary must be free of pending or approved Payroll Slips, applied debt or withdrawal deductions, and Report Lock under the shared employee payroll lock; a document in the unchanged later-boundary month does not block the correction.

The product exposes a separate “แก้วันเริ่มช่วงล่าสุด” control and leaves the ordinary `RESUME` earliest-date guard unchanged. The active API, state, and RPC contracts use period-start terminology. The former Resume-specific RPC remains temporarily unchanged for application rollback compatibility and may be removed later with a separate forward migration. No correction audit event, reason field, reset, delete, replacement period, or wage preview is added.
