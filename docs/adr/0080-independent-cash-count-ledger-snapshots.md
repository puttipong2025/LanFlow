---
status: accepted
---

# Independent cash counts use a frozen live-ledger balance

A count records physical denominations plus an optional single bank balance against the canonical cumulative net cash flow at session start. It owns its number, evidence and optional reviewer; it neither creates a Report Batch nor depends on report deletion, eligibility, prediction or denomination allocation. Branch financial mutations serialize with session start and are blocked until submission, cancellation or expiry, while reporting keeps its own source locks.

Deleting a count marks it deleted and records a minimal deletion audit; it retains the count and attached private bank evidence, and does not delete or unlock reports. This follows the business-record soft-deletion rule after removing the old paired-document boundary; ordinary report and rubber-export deletion retain their existing rules. Counts with no historical ledger snapshot show that absence explicitly rather than inventing a zero baseline.

Implementation is verified locally with the three 20261024 migrations. This supersedes cash-count pairing/prediction and the cash-count portion of ADR 0034 for the new application. It does not claim a Cloud rollout or change historical release receipts. Migration 3 removes old columns/functions, so rollback after cutover needs a database recovery point and matching application revision rather than simply deploying the old UI.
