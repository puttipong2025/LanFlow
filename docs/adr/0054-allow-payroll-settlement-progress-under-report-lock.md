---
status: accepted
date: 2026-09-02
---

# Allow payroll settlement progress under Report Lock

An active report freezes the approved source facts of a debt or withdrawal, including its original amount and payment context, but does not freeze the outstanding balance consumed by later payroll slips. Trusted payroll close and reversal paths may apply or release that outstanding balance while every report-visible source field remains unchanged; ordinary edits remain blocked. This preserves historical reports without allowing an older report to prevent creation, rejection, or deletion of a later payroll slip, and the new slip receives its own Report Lock only after a later report includes it.
