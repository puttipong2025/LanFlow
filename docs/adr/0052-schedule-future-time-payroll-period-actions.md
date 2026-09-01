# ADR-0052: Schedule Future Time/Payroll Period Actions

- Status: Accepted
- Date: 2026-09-01
- Owners: LanFlow team
- Decision scope: Time/Payroll active periods, future scheduling, payroll close, admin UI
- Extends: ADR-0047

## Context

Managers need to arrange payroll activation, pausing, returning to work, and employment end ahead of time. Applying a future choice immediately would misstate the employee's current status, while an external scheduler would add an unnecessary operational dependency. Period changes and payroll-slip creation can also race and must not leave a closed month inconsistent with a pending change.

## Decision

Each employee may have at most one pending period action. The manager's selected date is `selected_effective_on`; the actual state-change date is `activation_on`. `ENABLE`, `RESUME`, and `PAUSE` activate at `00:00 Asia/Bangkok` on the selected date. `END` treats the selected date as the last paid day and activates at `00:00 Asia/Bangkok` on the following date.

The period row remains the source of truth for date-range payroll calculation. Pending metadata is stored on that row only to explain, replace, or cancel the future action; no cron job, queue table, or duplicated status column is introduced. A later `SET` atomically replaces the employee's pending action, and one explicit cancel operation restores the prior range.

The period mutation, cancellation, and payroll-slip creation acquire the same per-employee advisory transaction lock. Scheduling must fail when the affected selected month already has a pending or approved slip, and slip creation must fail while a pending period action affects that month. The read contract returns `currentStatus`, `currentPeriod`, and `nextAction` so the UI never infers current state from `end_on is null` alone.

At the workday cutoff, eligibility remains conservative: opening or returning at `15:59` with a `16:00` cutoff does not award that day yet; the full day becomes eligible at or after the cutoff. Comments and confirmation copy state both the selected date and the actual activation time.

## Consequences

- Managers can prepare one future change per employee without running a scheduler.
- `END` on today keeps the employee active through today and changes state at the next Bangkok midnight.
- Rescheduling and cancellation are auditable and cannot bypass a closed payroll month.
- API and UI consumers must use the explicit period-state contract instead of checking only for an open-ended row.

## Verification

Verify fresh migration replay, one-pending-action constraint, reschedule/cancel restoration, schedule-versus-slip and schedule-versus-schedule races, unauthorized cancellation, Bangkok cutoff behavior, current/next read-state transitions, focus/visibility refresh, responsive controls, TypeScript, production build, pgTAP, and database lint.
