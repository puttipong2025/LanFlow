# ADR-0042: Allow Zero-Price Sale Lines

Status: Accepted

## Context

Some stock is given away without collecting money. The giveaway still needs the same sale-bill identity, stock deduction, revision, approval, deletion, PDF, and report-lock lifecycle as a normal sale. Modeling it outside the sale bill would split one operational event across unrelated workflows.

## Decision

A sale-bill line may have a unit price of zero. Quantity remains a positive integer, unit price remains limited to two decimal places, and negative prices remain invalid. The server continues to calculate every line total and the parent bill total; therefore an all-zero bill has an authoritative total of zero.

Zero-price lines deduct stock by quantity and appear in sale details, stock reporting, and the internal sale PDF with zero amounts. A zero-total bill does not create a positive cash event and does not contribute to dashboard money totals. Existing approval, revision, idempotency, deletion, and Report Lock rules remain unchanged.

## Consequences

- A zero amount no longer means a sale bill is incomplete.
- Money projections may omit the bill while stock and document projections retain it.
- Approval deletion must accept an existing zero-total sale bill so the normal approval flow can complete.
- Database constraints and RPC validation reject only negative sale prices and totals.
