# Rubber bill immediate edit/delete feedback

Created: 2026-10-29; revised: 2026-10-30 (Asia/Bangkok)
Status: Completed Local implementation/verification, 2026-10-30. See
[verification ledger](rubber-immediate-feedback-verification.md).

The execution checklist is `codingDO/10_Daily/2026-10-30.md`: four phases,
18 completed tasks and acceptance criteria A01–A16. This repo document is its
compact scope and evidence map; update the Daily checkboxes only after verified
implementation results.

## Agreed behavior

- Pending approval bills have Edit and Delete disabled as soon as that state is known.
- After submitting a valid edit or confirming deletion, disable Edit and Delete immediately to prevent another action on the same bill.
- Update the originating screen as quickly as possible, targeting no more than one second from the final Save/Confirm action. One second is an upper target, not an intentional delay. This measures local feedback, not central completion or another device's refresh.
- Keep central persistence and processing in the background. Durable local acceptance must precede acknowledging that the proposal is saved or starting a PDF handoff.
- For an edit, show the latest proposed values with “กำลังบันทึก” or “รออนุมัติแก้ไข” while unresolved. Those values are a proposal; existing approval rules still govern the authoritative bill and downstream totals.
- For a delete, retain the row with “กำลังลบ” or “รออนุมัติลบ” while unresolved. Remove it only after successful deletion.
- Share an edited PDF immediately after eligible local acceptance, using the same delivery flow as bill creation. An edit requiring approval must not trigger immediate PDF sharing.
- Preserve existing automatic-sharing exclusions for unknown receipt eligibility
  and nonpositive payable amounts. Local edited PDFs retain the existing offline
  document title and device reference, even while the browser is online.
- Retain proposed edit values across local-command acknowledgement, pending
  approval and reload. An old feed response must not overwrite a newer proposal
  or temporarily restore Edit/Delete controls.
- Displayed proposal fields must stay separate from authoritative bill identity,
  revision, creation time, locks, financial projections and confirmed receipt
  snapshots. Approval rejection/cancellation must restore the actual bill display
  with the existing recovery/status behavior.
- Deferring delete context must not silently move the confirmed deletion to a
  revision changed by another device. Preserve command identity and bind deletion
  to the version the user confirmed, with explicit stale-version handling.

## Existing evidence and implementation boundaries

- `CONTEXT.md` defines pending bill changes separately from the authoritative bill, whose values remain unchanged until approval.
- `docs/rubber-background-mutations.md` currently describes showing Server values during pending edits. The proposed-value display above is an intended change to that behavior, not a claim about the existing implementation.
- `docs/adr/0087-immediate-local-rubber-receipt.md` already records the eligible local PDF decision. `src/lib/rubber-bills/immediate-receipt.ts` suppresses immediate receipts for approval-required or unknown eligibility.
- `src/hooks/useRubberBillList.ts` reads local events before awaiting the Server
  feed and merges them after the response. A fast mutation alone therefore does
  not guarantee fast visible feedback; local presentation must work independently
  of that GET and stale responses.
- `src/components/rubber-bills/RubberBillsModule.tsx` does not explicitly inspect
  `approvalPending` in its action block reason. Add a Rubber-specific guard to
  both the buttons and handlers; shared helpers also serve Income/Expense.
- `src/lib/rubber-bills/central-sync.ts` can acknowledge and remove a command
  after a confirmed pending-approval result. Migration
  `20260929020000_scope_rubber_approval_feed_summary.sql` limits proposed summaries
  to the manager approval mode. The revised plan prefers the existing scoped feed
  returning only required proposed table fields for pending updates, so reload
  does not depend on a removed local event. A forward migration/API validation
  change may be necessary; do not edit old migrations or grant User approval-mode
  access to obtain the data.
- `src/lib/rubber-bills/command.ts` currently replaces a delete's expected revision
  with the context revision. Moving that context read to the background requires
  explicit stale-revision/concurrency handling, not just a defer flag.
- Preserve existing authorization, approval, report/transfer locks, financial
  calculations, queue identity and failure/recovery controls. No migration apply
  or deployment is authorized by this planning update.
- Reuse ADR 0087 for the existing PDF trade-off. A new ADR is unnecessary for
  reversible presentation choices; record a separate decision if revision/delete
  semantics need an architectural change with meaningful trade-offs.

## Revised execution sequence

1. Reproduce visible delays and define the proposed-summary/status contract,
   including acknowledgement/reload and stale-delete regression cases.
2. Apply immediate per-bill guards and durable local feedback, independent of
   feed GET; defer context without weakening revision or replay checks.
3. Display proposal fields and pending-delete states through approval, completion,
   failure, reload and scoped pagination, while keeping authoritative data intact.
4. Reuse and verify the current PDF pipeline; measure actual DOM timings, run
   affected/full gates, and update evidence and the Daily checklist.

## Verification to perform after implementation

- Hold feed GET, command context, admission POST and result reads independently
  for at least three seconds. Exercise a response started before local acceptance
  that arrives afterward, as well as the approval/local-cleanup/feed handoff.
- Measure final valid Save/Confirm to disabled controls, local commit and proposed
  table/status rendering separately. Use at least 20 browser samples per edit/delete
  operation, report sample counts and cold/warm/approval cases separately, and
  record p50/p95/max plus any samples exceeding 1,000 ms. Never acknowledge success
  before durable storage to improve a timing result.
- Exercise pending approval for both edit and delete; neither action may be available during that state.
- Verify an eligible positive-payable edit shares the new PDF before central
  completion and shares no duplicate at completion. Approval-required, unknown
  eligibility and nonpositive-payable cases share no immediate PDF.
- Check rendered PDF content against the edited snapshot, including the local
  reference/offline title and absence of old approval metadata. A PDF header or a
  download arriving within 15 seconds does not establish content or subsecond DOM
  behavior. Report PDF generation/native-share invocation separately.
- Verify the same proposal remains after pending approval clears the local queue
  and after reload; test approval/cancellation and an intervening edit from another
  device before deferred deletion. Preserve filter/cursor scope and receipt caches.
- Exercise central success, rejection/failure, and reload recovery using the existing recovery contract. Do not report pending work as completed or silently lose a proposal.

## Review baseline

During scrutiny, the following existing isolated suite passed 50 tests:

```text
npx.cmd playwright test --config=playwright.isolated.config.ts tests/rubber-immediate-pdf.spec.ts tests/rubber-background.spec.ts tests/rubber-bill-local-feed-pagination.spec.ts tests/action-column-contract.spec.ts --workers=2
```

These were baseline checks, not proof of the new implementation. The subsequent
delivery has completed all18 Local tasks; final gates, real-browser timings and
explicit environment limits are in the verification ledger and Daily note.
