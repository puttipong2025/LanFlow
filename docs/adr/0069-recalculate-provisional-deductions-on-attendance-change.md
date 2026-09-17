---
status: accepted
date: 2026-09-17
---

# Recalculate provisional deductions when attendance changes

LanFlow treats approved debt and withdrawal deductions in months without a `PENDING` or `APPROVED` Payroll Slip as provisional allocations. We decided that an authorized manager may correct a period start or replace day-off/half-day exceptions in those open months, and the same transaction must rebuild every open-month allocation through the current month with the existing deterministic deduction planner.

## Decision

Attendance mutations acquire the existing per-employee attendance lock before the financial lock. They reuse `private.plan_time_tracking_deductions(...)`, restore affected provisional allocations to their approved parent balances, and reallocate oldest-first across every open month. Closed Payroll Slip months remain immutable. Report-locked parent amount, status, payment context, and other source facts remain unchanged; only trusted settlement state and unreported provisional child allocations may change.

The database compares canonical allocations without row identities before writing. If the result is unchanged, it keeps the existing deduction rows and creates no recalculation audit. If the result changes, it replaces provisional child rows and records one summary audit containing the actor and before/after allocations. The attendance change, balances, replacement rows, and audit commit or roll back together. The existing UI confirmation remains the only confirmation step and shows the server-confirmed deduction total before and after success.

## Considered options

- Removing the deduction guard without recalculation was rejected because attendance and financial allocations could disagree.
- Recalculating only the edited month was rejected because restored balance can cascade into later open months.
- Adding another planner or a new table was rejected because wage recalculation already provides the required deterministic allocation contract.
- Always replacing child rows was rejected because unchanged results would churn identities and create misleading audit noise.

## Consequences

- Only period-start correction and attendance-exception replacement use the new recalculable-open-month boundary; other period actions keep their existing guard until they also perform a financial rebuild.
- A reported provisional child remains protected by the existing Report Lock trigger, causing the whole attendance mutation to roll back.
- Forward migration, database/API regression tests, schema parity, and UI success-summary verification are required before release.

## Implementation evidence

- Forward migration: `20260917100000_time_payroll_attendance_deduction_recalculation.sql`.
- The existing admin API actions and RPC names remain unchanged; no table or endpoint was added.
- `replace_time_payroll_attendance_exceptions` preserves its existing numeric `changed` field; the new financial outcome is exposed separately as `deductionsChanged` so existing callers do not receive a silent type change.
- The admin route rejects malformed, cross-month, duplicate, or oversized attendance selections before calling the RPC; direct RPC callers receive `INVALID_ATTENDANCE_SELECTIONS` for malformed and impossible dates instead of a raw date-cast error.
- Discarding a failed calendar draft clears its inline error together with the draft, preventing stale failure text after cancellation.
- Calendar writes use the month from the loaded attendance snapshot, and editing stays busy while a requested month is loading or differs from that snapshot; stale month data can therefore never replace the newly requested month's exceptions.
- Regression coverage proves changed allocation, no-op identity preservation, fragmented-allocation equivalence, report/slip locks, permissions, and transactional rollback.
- Verified locally on 2026-09-17 with a fresh migration replay, pgTAP, database lint, focused Playwright suites, TypeScript checking, production build, service-worker checks, and generated-schema parity.
