# ADR: Cash count and Report Batch are one aggregate

## Status

Accepted — 2026-08-02

## Decision

A completed cash count and its Report Batch are created in one PostgreSQL transaction with the same server cutoff. The cutoff is fixed when the 30-minute count session starts. Business modules remain writable while the form is open; events received after the cutoff belong to the next report/count round.

Only ordinary report creation for the same location is blocked by a live count session. A per-location transaction advisory lock serializes session start, count submission, and report creation without adding write guards to business tables.

The pair is soft-deleted only from the Cash Count manager view and only when its report is the latest active report for the location. The operation marks both records deleted and deactivates the report items in one transaction. The Reports module exposes the relationship as read-only and rejects deleting a linked report directly.

## Authorization

No permission schema or feature toggle is added. Active User/Admin accounts may start, cancel their own session, and submit only in assigned locations. The existing system-manager capability is a superset and additionally permits location-scoped history, analysis, and latest-pair deletion.

## Formula v1

The anomaly score is immutable after submission and uses three capped components: total cash variance (70), unexplained denomination increases (20), and denomination-pattern churn (10). Confidence is separate and is reduced by unknown-denomination income, simulated change, fractional-baht rounding, or an allocation that cannot be reproduced from the previous counted stock. The first count is a baseline and has no score or confidence.

After ten prior rounds at confidence 80 or higher, only the denomination-pattern component may be normalized against the location history. Total-variance rules never adapt and old results are never recalculated.

## Cash event matrix

| Source | Cash effect | Denominations |
| --- | ---: | --- |
| Rubber bill / OCR bill without transfer item | Expense | Simulated from previous stock |
| Ordinary Income/Expense | Income or expense | Income unknown; expense simulated |
| Payroll / approved withdrawal | Expense | Simulated |
| Branch-paid customer transfer portion | Expense | Simulated |
| Verified branch rubber-export work cost | Expense | Simulated |
| Cash transfer sent / received | Expense / income | Exact source counts |
| Bank transfer amount and fee | Excluded | Not cash |
| Bill later selected for bank transfer | Cash restored | Unknown denominations |

Report Items are the authoritative membership snapshot. Source-owned rows are counted once through their own report-item type; mirrored Income/Expense feed rows are not copied into the calculation.
