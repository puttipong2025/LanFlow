# ADR-0053: Round Time/Payroll Net Pay to Whole Baht

- Status: Accepted
- Date: 2026-09-01
- Owners: LanFlow team
- Decision scope: Time/Payroll wage precision, payroll calculation, accounting, payment, audit, and presentation

## Context

Daily wage needs up to four decimal places, while the actual payroll payment must be a whole-baht amount. The existing path converts the input to a JavaScript number before validation, truncates the stored wage to two decimals, and truncates net pay to two decimals. That loses the original input boundary and lets individual presentation surfaces choose inconsistent rounding.

## Decision

The API validates the raw daily-wage string and accepts `0` with no more than four fractional digits. The database enforces the same non-negative four-decimal invariant and rejects excessive precision instead of truncating it. The current wage remains one rate for every eligible day in an open payroll month.

Payroll keeps the existing gross-pay and deduction precision. It calculates `netPayBeforeRounding = greatest(grossPay - totalDeductions, 0)`, then `net_pay = round(netPayBeforeRounding, 0)` using PostgreSQL numeric rounding, and `roundingAdjustment = net_pay - netPayBeforeRounding`. The initial immutable `slip_data` snapshot stores the two audit values, but Product UI, presentation APIs, Preview, and PDF do not expose them.

`payroll_slips.net_pay` is the only accounting and payment source of truth. Approval, payment-location selection, Income/Expense, Dashboard, Report, Preview, and PDF consume it directly and do not round or recompute it. A rounded zero does not require a payment choice or create an expense; a positive rounded amount does.

The behavior is implemented under versioned internal payroll and wage RPC names. The public RPC signatures remain stable. The rollout locks `payroll_slips` and aborts unless the table is empty, because existing slips must not be silently recalculated or backfilled.

## Consequences

- Daily wage preserves up to four decimal places from input through the database and snapshot.
- Payroll payment is a deterministic whole-baht value across every downstream consumer.
- Audit can explain rounding without adding a visible adjustment row.
- Existing payroll slips require an explicit accounting decision if any appear before rollout; migration fails closed.

## Verification

Verify raw-input boundaries, database constraints, `.49`/`.50` rounding edges, negative-before-floor behavior, initial snapshot fields, zero/positive payment gates, source-aware two-decimal payroll presentation, PDF non-disclosure, fresh migration replay, schema parity, grants, focused browser/database tests, production zero-slip preflight, and post-deploy read-only smoke tests.
