---
status: accepted
date: 2026-09-03
supersedes: ADR-0031
extends:
  - ADR-0034
  - ADR-0057
---

# Configure one retention window for temporary history

LanFlow uses one system-wide temporary-history retention value from 1–365 Bangkok calendar days, defaulting to 15 days. System Managers may preview and change it. A value of 15 keeps today and the preceding 14 Bangkok dates. Reducing the value hides out-of-window history immediately and starts bounded physical cleanup; a daily job retries bounded cleanup until no eligible rows remain. Increasing the value affects future retention only and cannot restore rows already deleted.

The policy covers Dashboard money events, Time/Payroll audit logs, terminal Admin account audit logs, terminal approval requests for Income/Expense, cash-transfer deletion, Rubber Bills, stock entries and stock products, scheduler run details, and temporary cleanup-run details. Pending work is not history: stale Admin password-reset audit rows become `unknown` after 24 hours before normal retention applies. Each setting change leaves a permanent minimal audit containing the actor, old/new values, timestamp, and eligible counts by group; cleanup payloads are never copied into that audit.

Temporary history must not be a source of truth or the only replay guard. The latest employment-END boundary needed by Payroll Resume is moved to durable business state before Time/Payroll audit cleanup. Terminal approval idempotency keys are reduced to permanent payload-free replay guards before approval rows are deleted.

Business rows and cumulative sources remain outside this policy. In particular, `rubber_bills` and `income_expense` rows with `record_status = 'deleted'` remain durable business tombstones with their identities, document numbers, revisions, and relationships. They remain hidden from operational feeds and excluded from Dashboard, cumulative money, and stock calculations. Permanent document-deletion audits, managed Auth audit rows, Realtime messages, platform logs, active scheduler definitions, and Dashboard projection baseline state are also excluded.
