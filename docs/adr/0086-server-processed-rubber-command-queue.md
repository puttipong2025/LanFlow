---
status: accepted
date: 2026-10-28
extends: ADR-0084
---

# Process accepted Rubber commands centrally

Accepted Rubber work must finish without depending on the selected branch or an open browser, and authorized devices must share its status. A local replay loop cannot provide either guarantee.

Use the existing local outbox as durable upload staging and a private Server queue as the sole processor for new marked commands. Keep existing calculation, generation, receipt and approval contracts. Accepted-time and price-policy snapshots prevent queue delay alone from adding approvals; current rights, revision, locks and source ownership remain execution guards. A private actor-aware context attributes execution without storing user sessions or forging JWT claims.

Terminal command results are durable independently of display history and prevent old devices from reviving rejected or retired commands. Nonterminal work blocks reports through the existing branch rules. Silent off-branch behavior and origin-tab printing keep central work from interrupting another branch.

This changes ADR-0083 stale-draft retention only for the user-approved confirmed stale/rejected outcomes; invalid offline creates remain correctable and uncertain outcomes remain durable. Explicit authorized replacement of pending approvals still exists. A system manager may explicitly retire orphaned central work after permanent account closure without deleting its Server bill.

See [the implementation contract](../rubber-central-queue-contract.md). Acceptance of this design is not verification of an implementation or deployment.
