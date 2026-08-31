---
status: accepted
---

# Rebaseline cash count after unknown-denomination inflow

When the interval after the previous cash-count cutoff through the current session cutoff contains any positive inflow without denomination counts, the submitted physical count becomes a new cash baseline. The system records `expected = actual`, zero difference, no anomaly score or confidence, and formula `cash-v1-rebaseline`; it still creates and locks the paired Report Batch and retains the triggering references. This avoids manufacturing denomination evidence from an amount alone, applies to both general income and late bank-transfer cash adjustments, and does not force staff to repeat a completed count. Existing Report Locks still prevent attaching a new transfer item to a source in an active report, so late adjustments remain a compatibility path for event states that already exist; this decision does not weaken relation locks. Known-denomination inter-branch cash receipts continue through the normal calculation. Inferring denominations below an arbitrary amount such as 1,000 baht was rejected because the same total can be composed or tendered in many ways; adding payment-method and denomination fields to general income was deferred as unnecessary scope.
