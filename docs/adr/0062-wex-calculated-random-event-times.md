# ADR 0062: Use calculated random event times for WEX

## Status

Accepted

## Context

The WEX form currently records the current Bangkok time when users add a trailer or enter an outbound weight. The workflow now requires one editable source time (truck inbound) and three read-only calculated times so users can enter outbound weights in either vehicle order without waiting for wall-clock time.

## Decision

- New truck inbound defaults to two hours before the form opens and remains editable.
- Trailer inbound is truck inbound plus a uniformly selected whole minute from 1 through 3.
- Truck outbound is truck inbound plus a uniformly selected whole minute from 30 through 180.
- Trailer outbound is truck outbound plus a uniformly selected whole minute from 1 through 3.
- Calculated fields are read-only and may be later than the current time.
- Adding a trailer after truck outbound preserves the existing truck outbound time.
- A positive outbound weight creates its calculated time when prerequisites exist. Returning truck outbound weight to zero clears both outbound times but preserves trailer weight; re-entering truck outbound recalculates both times.
- Opening an existing WEX does not recalculate stored timestamps. An explicit truck inbound change recalculates applicable derived times.
- The ranges are a UI convention. Existing API payloads, RPC validation, and database schema remain unchanged.

## Alternatives considered

- Keep actual event times: rejected because it prevents the confirmed flexible workflow.
- Make all times editable: rejected because it adds input burden and allows inconsistent ordering.
- Enforce the ranges in the server or database: rejected because no wire contract change is required and existing bills may contain timestamps outside the new ranges.
- Add reroll controls or configurable ranges: rejected as unnecessary surface.

## Consequences

- WEX timestamps created through the form are calculated workflow values, not evidence of real-world event time.
- Existing bills are not backfilled or rerolled.
- API callers can still submit any valid ordered timestamps; the server continues to require only valid per-line chronology and weights.
- Tests must control the random source and assert inclusive boundaries and state transitions without timing waits.

## Verification

Verified locally on 2026-09-06:

- The complete WEX timing/UI/contract/PDF suite passed 32/32.
- `npm run verify` passed type checking, the production build, and service-worker checks.
- `git diff --check` passed.
- A strict unused scan found only the pre-existing unrelated `workEnd` finding in `tests/time-payroll-exceptions-backend.spec.ts`.
- End-to-end review confirmed the generated values flow through the existing ISO payload and the unchanged API/RPC per-line chronology checks.
