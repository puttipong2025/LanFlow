# Income/Expense action behavior aligned with Rubber

The user confirmed this policy on 2026-11-01 for ordinary income and expense rows. Previously an unsent pending Income/Expense create could still be edited; Rubber already locked editing. Reuse the existing shared guards and outbox.

| State | Edit | Delete | Add the next row |
| --- | --- | --- | --- |
| New pending create, explicitly never submitted | Disabled | Confirm local cancellation, including offline | Allowed |
| Submission started, or result uncertain | Disabled | Disabled | Allowed |
| Legacy pending row with unknown submission marker | Disabled | Disabled until its state is known | Allowed |
| Confirmed, online | Existing business rules | Existing business rules | Allowed |
| Confirmed, offline | Disabled | Disabled | Allowed when existing offline rules permit |

Sale bills and derived-source rows retain their own rules. Existing approval/report locks and failed/conflicted queue recovery remain applicable. Under [ADR 0098](adr/0098-income-expense-fresh-create-forms.md), create forms discard unfinished input rather than resuming it. Accepted queue rows stay immutable and remain available in the operational list.

## UI and cancellation

- Main table begins `จัดการ → Sync → เลขที่`; cells move with the header.
- PDF actions display only `PDF`, without the share icon. Edit displays `แก้` without a pencil. Delete actions display only the trash icon; descriptive accessible names, tooltips and disabled explanations remain.
- An unsent ordinary create uses the existing confirmation dialog with a local-only explanation and `ยืนยันลบ`. No approval request or server delete is sent. Confirmed ordinary rows retain background deletion and current approval rules.
- `cancel-local-create.ts` verifies the exact current owner/branch/record queue in one transaction with the accepted-submission store. Every command must be a pending create explicitly never submitted. Save `cancelled: true` and remove its queue together; keep counters/reservations. Legacy explicit-unsent creates also receive a cancellation marker. An old form cannot recreate that identity.
- The main sender claims its snapshot with `reconcileSyncEventsIfCurrent` before HTTP and refreshes the pending projection. Cancellation winning first makes a stale sender skip the missing command; a sender claim winning first makes cancellation fail while preserving the command. Storage failure rolls back cancellation.

## Verification ledger

- RED: actual hook/IndexedDB reproduced pending accepted-row editing, cancellation leaving an accepted form reusable, and deleting a row with an unknown sent marker. The attempted-submission control already blocked deletion.
- Debugger: the existing pending-server helper permits an unsent local create; a separate pending-edit rule was absent from Income/Expense.
- Ten behavioral tests cover shared action parity, projection, new-row/partial-form continuation, cancelled-form replay, unknown markers, competing sender/cancellation, quota rollback, owner isolation and legacy cancellation. Full current isolated suite: **1,244 passed / 2 existing skips**.
- Actual browser regression: 19 offline journeys passed, including a controlled HTTP gate proving edit/delete are disabled during sending while the next-create action remains enabled. Offline cancellation, table order and text/icon changes are asserted on rendered controls.
- Lint, typecheck and source/import checks passed. Production build `zmfiOPbj5nL07K-zNc22m`, offline assets, service worker and bundle budget passed (298.6/320 kB initial load). Six core source hashes match the tested copy.
- Current-build browser verification passed: numbered upgrade/partial acceptance/approval/replay 1 journey, Income/Expense PWA 2 journeys, Rubber registration/branch/offline 3 journeys. Viewed the 375px image showing `Sync` before the number, plain `แก้`, icon-only delete and `PDF`; tests assert the rendered labels, icons and disabled states.
- Final user follow-up removed `Share2` from both PDF actions. Build `c-TJ-qHjdWQK8b8m0sLfY` passed all build/type/lint/assets/SW/budget checks; six core source hashes match. Both Income/Expense PWA journeys passed again with explicit no-SVG assertions on the PDF controls. Inspected the refreshed 375px image; only `PDF` text remains. The full 19-journey Income/Expense offline suite also passed on the preceding action-policy build; the final follow-up changes only PDF presentation.
- A concurrent shared-issuer change required the new registration fixture to carry `deviceId`. Existing source-text tests were updated to require the conditional sender claim and shared guard; business restrictions were not weakened.

Local implementation only. No IndexedDB version change, server migration, Cloud apply, commit, push or deployment is part of this work.
