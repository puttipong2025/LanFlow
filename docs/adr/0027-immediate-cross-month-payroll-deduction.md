# ADR-0027: Immediate Cross-Month Payroll Deduction and Manager-Owned Time Tracking

- Status: Accepted
- Date: 2026-07-31
- Owners: LanFlow team
- Decision scope: Time Tracking, withdrawals, debt, payroll month close, authorization, scheduled jobs
- Supersedes: the leave and approver-scope portions of ADR-0006

## Context

Withdrawals and debt previously depended on request creation time and a daily deduction function. The application could therefore assign a transaction to the wrong payroll month, delay a deduction after approval, and race approval against the daily job or payroll creation. Ordinary admins could also control employee time, while the unused leave workflow added schema, badge, report, and authorization surface without affecting wages.

The required behavior is:

- choose a non-future Bangkok business date in any month that has no payroll slip;
- deduct immediately after approval, starting with that month;
- carry any remainder forward month by month without making wages negative;
- close payroll months in worked-month order;
- let only `super_admin` and system-manager capability accounts control time/payroll;
- preserve approved withdrawal and net-payroll branch expense relations;
- remove the leave workflow.

## Decision

### Effective dates and deduction ledger

`financial_transactions.effective_date` identifies the parent `DEBT` or `WITHDRAWAL` business date. `applied_month` identifies the month charged by a child `DEBT_DEDUCTION` or `WITHDRAWAL_DEDUCTION`. Neither meaning is inferred from `created_at`.

One security-definer engine locks by `profile_id`, calculates available wages per open month, subtracts already-recorded child deductions, and consumes approved parents in this order:

```text
effective_date, created_at, id
```

Approval, the 15:05 job, and payroll close call the same engine. Parent `remaining_amount` and child insertions occur in the same transaction. Retries see the recorded children and cannot make wages negative or deduct the same amount twice.

### Month close

Any payroll slip closes its month. Transaction creation, approval, manual time edits, and other month-sensitive writes reject a closed month. Pending withdrawal/debt rows block their month and later payroll slips.

Payroll slips are created from the oldest month that contains paid work and has no slip; empty months are skipped. Slips are deleted newest-first. Current-month creation closes an active segment and may create a one-shot next-month resume schedule. Historical slips do not alter current tracking.

### Time ownership and scheduled transitions

Inside this module:

- ordinary `user` and ordinary `admin` can read only their own data, request a withdrawal, and permanently delete their own pending withdrawal;
- `super_admin` and `can_access_super_admin_features = true` have the same manager rights for self and others;
- only managers can start/stop time, create debt, decide records, and manage payroll.

Browser clients no longer own the daily cutoff. PostgreSQL cron runs:

| Bangkok time | Job |
| --- | --- |
| 15:00 daily | close each active segment at 15:00 and open its continuation |
| 15:05 daily | run the shared deduction engine |
| 00:00 daily | consume due next-month resume schedules |

A regular manager stop removes any resume schedule. A payroll-close stop creates a schedule only when the employee was running and the manager kept the default option enabled.

### Write boundary and leave removal

Authenticated clients retain self-or-manager reads but no direct writes to critical Time Tracking tables. Mutations go through authenticated RPCs which recheck actor capability and acquire locks in the order `employee advisory lock → source row lock`.

The migration drops `leave_requests` and its trigger/type surface. UI, API, badges, report details, print/PDF totals, and tests no longer query or display leave. The legacy report enum label is retained because rewriting the shared enum is unnecessary and riskier than leaving an unreachable label.

### Expense relation

ADR-0006 still governs source-owned derived expenses:

- approved withdrawal uses its full amount;
- approved payroll uses `net_pay`;
- debt creates no branch expense.

Time/payroll managers may choose any active expense location, matching their module-wide manager rights. Corrections and permanent deletion remain source-owned and respect report locks and closed payroll months.

## Consequences

- The ledger is explainable by business month and safe under retries/concurrent approval.
- Carry-forward requires no installment scheduler or future deduction date.
- Open months with recorded deductions lock manual day edits and wage changes; normal timer continuation can still accrue new wages before payroll close.
- Payroll deletion is intentionally destructive but ordered, manager-only, and blocked by report locks.
- No business-row backfill is performed. The migration assumes the confirmed empty Time Tracking business data set.

## Verification

- `tests/time-tracking-immediate-deduction.spec.ts`
- `tests/time-tracking-branch-expense.spec.ts`
- `tests/actionable-badges.spec.ts`
- focused report presentation, print, and report-lock tests
- `npm run typecheck`, `npm run lint`, and `npm run build`
- local SQL proof for the 15:00 cutoff and cron schedule inspection
