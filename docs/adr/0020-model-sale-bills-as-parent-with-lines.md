# ADR-0020: Model Sale Bills as One Parent with Product Lines

Status: Accepted

Price positivity in this decision is superseded by [ADR-0042](0042-allow-zero-price-sale-lines.md), which permits a zero unit price for free giveaways.

## Context

The Income/Expense sale form currently turns each product line into a separate `income_expense` row and later groups those rows for one PDF. That makes approval, sync, stock deduction, revision, retry, numbering, deletion, report locking, and failure recovery operate at the wrong boundary. The product has no production sale-bill data, so backward compatibility and data backfill are unnecessary.

## Decision

One form submission creates one sale bill. The existing `income_expense` row is the bill parent and stores the server bill number, server-calculated total, approval state, revision, sync state, and report relationship. A new `income_expense_sale_lines` table stores ordered product lines.

Create, edit, delete, approval, retry, stock validation, stock mutation, numbering, and revision checks operate on the whole bill in one database transaction and one offline-queue event. Any failure rolls back the whole bill. Duplicate products may remain on separate ordered lines, but stock availability is checked against the summed quantity per product.

Quantity is a positive integer. Unit price has at most two decimal places. The server rounds each line total half-up to two decimal places and sums those rounded line totals for the authoritative bill total. A bill contains at most 50 lines.

The Income/Expense table, dashboard, and financial report use the parent as one row. Stock projections and bill details use the child lines. The main feed returns the parent and line count; details are loaded on demand, while a successful submit response returns authoritative lines for immediate PDF sharing.

The previous `sale_group_id`, `sale_line_order`, and `sale_expected_lines` model and its compatibility code are removed through a forward migration. No historical conversion path is retained.

## Consequences

- One bill receives one central number and cannot be partially approved, synced, edited, deleted, retried, or report-locked.
- A pending edit leaves the current bill and stock unchanged; approval revalidates stock before atomically applying the new revision.
- Financial reporting remains parent-based, while stock reporting must project child lines.
- The implementation must replace the sync and approval RPC payloads, add a details endpoint, update UI/read models, and replace group-based tests.
- Existing waiting/share behavior remains reusable: no-approval submissions share after atomic success; pending approval closes without sharing; cancellation never rolls back a submitted bill.
