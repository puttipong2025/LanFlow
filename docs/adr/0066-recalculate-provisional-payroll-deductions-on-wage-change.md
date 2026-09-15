---
status: accepted
date: 2026-09-15
---

# Recalculate provisional payroll deductions when daily wage changes

LanFlow previously rejected every daily-wage change when an open payroll month already contained an approved debt or withdrawal deduction, because one current wage in `profiles.daily_wage` drives every financially open month. We decided that deductions in months without a `PENDING` or `APPROVED` Payroll Slip are provisional allocations rather than final payroll facts, so an authorized payroll manager may change the one current wage and replace all provisional allocations across every open month without adding wage-history tables.

## Decision

Before mutation, a server calculation shows the old and new wage plus deduction totals before and after for each affected month. Confirmation is bound to the exact calculation inputs; if attendance, payroll periods, parent transactions, provisional deductions, slip state, wage, or the Bangkok calculation boundary changes before commit, the write fails and requires a fresh preview.

The commit acquires the existing per-employee attendance lock before the financial lock and runs atomically. It restores every affected provisional child deduction to its approved debt or withdrawal balance, replaces the wage, and reuses the existing oldest-first deduction rules to allocate again through the current month while skipping closed months. A higher wage consumes additional outstanding balance immediately; a lower wage, including zero, restores the difference and carries it forward. Active Payroll Slips remain immutable boundaries, while rejected or deleted slips do not close a month.

An active Report Lock continues to freeze the approved parent amount, status, payment context, and other report-visible facts, but does not block trusted recalculation of `remaining_amount` and provisional child allocations. The ordinary employee view shows only the latest allocations. Existing audit storage records the actor, old and new wage, and before/after results; no reason, new approval workflow, role, permission toggle, or table is added.

## Considered options

- Keeping the unconditional lock was rejected because it prevents correcting the only current wage until every affected month has a slip.
- Scheduling a future wage was rejected because it does not correct open months and adds a second wage state.
- Adding effective-dated wage history was rejected as disproportionate to the required one-rate-for-all-open-months contract.
- Updating the wage without rebuilding deductions was rejected because it could leave allocations inconsistent with the wage that now calculates those months.

## Consequences

- Preview and commit must share one deterministic calculation contract and the commit must reject stale confirmation.
- Rebuilding may replace provisional deduction row identities, so they must not be treated as external document identities before a slip closes the month.
- Forward migration, database/API integration tests, UI confirmation tests, schema parity, and responsive accessibility verification are required before release.
