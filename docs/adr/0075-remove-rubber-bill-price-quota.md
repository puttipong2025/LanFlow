---
status: accepted
supersedes: 0073-use-server-authoritative-admin-price-quota-for-rubber-bills
---

# Remove Rubber bill price quotas and keep one allowance-based price policy

LanFlow will remove the Rubber bill price quota, counter, round, ledger, preview, and confirmation workflow. Every role allowed to create or update a Rubber bill uses the same rule without a per-account or per-day limit: prices at or below the effective cap are saved directly when no other approval reason applies, and prices above the effective cap create the normal whole-bill approval request.

The effective cap remains `central price + configured allowance`. Grouped branches use their group allowance; ungrouped branches use the shared ungrouped allowance. The central price, allowance provenance, price-rule revision, edit-window, date, delete, OCR, relation-lock, and idempotent replay rules remain authoritative on the Server. Offline clients may queue a price equal to or below their cached effective cap, but replay always uses the latest Server rule and may create one idempotent pending request.

The system-wide maximum allowance becomes an independent setting. Only the exact `super_admin` role may change it; System Managers see it read-only. A same-value save is a no-op. Reducing it below an active group or ungrouped allowance is rejected atomically with a structured list of all conflicts. All policy writers keep the same advisory-lock boundary so a concurrent allowance increase and maximum reduction cannot violate the invariant. The current maximum and its existing updater/timestamp are preserved by renaming the old quota updater columns rather than reseeding them.

Historical bills, revisions, price snapshots, and approval requests are not recalculated. Pending requests continue through the existing approve/reject workflow. The quota ledger and bill quota reference are deleted after all active functions have been detached from them. Old preview and quota-setting routes/RPCs have no compatibility alias; an old application client must reload after the coordinated cutover.

Implementation and verification evidence is maintained in `docs/rubber-bill-price-policy-without-quota-plan.md`.
