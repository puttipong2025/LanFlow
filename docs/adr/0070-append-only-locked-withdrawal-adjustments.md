---
status: accepted
date: 2026-09-19
---

# Adjust report-locked withdrawals with append-only corrections

An approved withdrawal may already be frozen by a Report Lock while its payroll deductions remain financially open. We decided not to edit or delete the reported source. Instead, LanFlow accepts an append-only adjustment that sets a new effective withdrawal total and records only the difference in the next report period.

## Decision

The action is available only for an approved, report-locked withdrawal. An unlocked withdrawal keeps the existing delete-and-recreate path. The requested target may increase, decrease, or become zero, but it must differ from the latest effective total and cannot fall below the amount already consumed by `PENDING` or `APPROVED` Payroll Slips. Open-month allocations may be restored or extended using the existing deterministic oldest-first payroll rules; closed slips remain immutable.

An increase creates a branch expense for the difference. A decrease, including a target of zero, creates branch income for the returned difference. The correction uses the approval date from the server in `Asia/Bangkok`, enters the next report period, and never rewrites the original report. The original branch is preselected, while the approver may choose another active branch within their authorized scope. The generated description identifies the employee, source withdrawal, previous effective total, new target, and difference; a human-entered reason is optional.

The employee may submit and withdraw one pending adjustment request for their own withdrawal, following the existing withdrawal-request workflow. A pending adjustment changes no balance and blocks Payroll Slip creation from the source month forward. The approver may approve or reject but may not rewrite the requested target. A payroll manager may create the adjustment on the employee's behalf and apply it immediately, matching the existing manager-created withdrawal behavior. Approval requires both employee-management scope and access to the selected branch.

Approval applies the payroll allocation change and the branch income/expense correction atomically. Concurrent or stale requests must fail without a partial write. Further adjustments are allowed from the latest effective total after the prior request is decided. Each approved correction becomes report-lockable like the existing source-linked financial rows; once reported, it is corrected only by another append-only adjustment.

## Considered options

- Editing or deleting the locked withdrawal was rejected because it would contradict the historical Report that froze the source fact.
- Requiring deletion of the latest Report before every correction was rejected because it couples an open payroll correction to historical report recreation.
- Adjusting payroll without a branch income/expense correction was rejected because employee settlement and branch cash reporting would diverge.
- Automatically reopening or rewriting closed Payroll Slips was rejected because it would change an approved payroll document retroactively.

## Consequences

- The UI reuses the withdrawal history and approval structure: a `ปรับยอดเบิก` action opens one summary dialog showing the current total, closed-slip floor, requested target, difference, direction, optional reason, and approver branch selection.
- The database remains authoritative for permissions, the latest effective total, closed-slip floor, one-pending-request rule, stale-request detection, allocation rebuilding, and the atomic branch correction.
- Income/Expense, Report Lock, report generation, audit history, employee self-service, manager queues, Payroll Slip snapshots, and Payroll Slip PDF generation must recognize the new correction contract without treating the original reported amount as mutable.

## Payroll Slip PDF

The Payroll Slip preserves the existing itemized layout. The adjustment feature does not add correction-history rows or a new section, so the feature does not make the 80 mm slip longer merely because a withdrawal was adjusted.

The existing `รายการหักเงิน` section continues to list each actual `DEBT_DEDUCTION` and `WITHDRAWAL_DEDUCTION` row that contributes to the slip. Each row shows the real effective date of its source debt or withdrawal, not the first day stored in `applied_month`. The adjustment approval date remains in source history and audit rather than appearing as the deduction date.

The existing `รายการหนี้สินและเบิกเงิน` section keeps one source row per relevant debt or withdrawal. An adjusted withdrawal row shows only its latest effective target at the time the immutable slip snapshot is created; the correction chain is not shown. A withdrawal whose latest effective target is zero is omitted. `ยอดหักรวม` and `ยอดสุทธิ` remain the authoritative stored Payroll Slip amounts, and the source rows are informational only. Historical Payroll Slips remain unchanged, while full withdrawal and correction details stay available in the employee source workflow and audit trail. The preview and searchable 80 mm PDF must use the same document model.
