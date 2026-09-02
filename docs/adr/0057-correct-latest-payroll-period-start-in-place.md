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

System Managers may correct the start date of the latest continuous payroll work chain that has already started, whether its first row came from the employee's initial `ENABLE` or a later `RESUME`, and whether the chain remains active or has closed. Adjacent rows where the earlier `end_on + 1` equals the later `start_on` form one chain because there is no inactive day between them. This is a correction of the existing boundary, not a new `RESUME`: the application sends the chain-head period ID the manager reviewed, and the server locks the employee, derives the same latest chain, verifies that ID, checks the date bounds and every financially affected month, then updates only the head row's `start_on`, `updated_by`, and `updated_at`.

The earliest date is the day after the period before the chain ends, or unbounded for the first chain. The latest date is Bangkok today while a single-row target remains effective, otherwise the chain head's `end_on` so moving it cannot overlap the next preserved row. The correction may move earlier or later but may not overlap another period, move after the target row ends, delete a row, or target a future scheduled `ENABLE` or `RESUME`. A stale chain-head period ID fails without changing any row.

Attendance continues to derive from the existing period and exception model, so newly included days are full days by default while existing `HALF_DAY` and `OFF` exceptions remain authoritative. The correction preserves `end_on`, earned current-day results, future period actions, period identity, slips, deduction balances, `remaining_amount`, and Report Lock. Every month containing a changed day in the half-open range between the earlier boundary and the later boundary must be free of pending or approved Payroll Slips, applied debt or withdrawal deductions, and Report Lock under the shared employee payroll lock; a document in the unchanged later-boundary month does not block the correction.

The product exposes a separate “แก้วันเริ่มช่วงล่าสุด” control and leaves the ordinary `RESUME` earliest-date guard unchanged. The active API, state, and RPC contracts use period-start terminology. The former Resume-specific RPC remains temporarily unchanged for application rollback compatibility and may be removed later with a separate forward migration. No correction audit event, reason field, reset, delete, replacement period, or wage preview is added.
