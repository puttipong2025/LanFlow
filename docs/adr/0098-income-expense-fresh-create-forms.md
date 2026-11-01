# ADR 0098: Fresh Income/Expense create forms without draft recovery

Status: Accepted — 2026-11-01, explicitly confirmed by the user.

## Decision

Income/Expense create forms start empty on every opening: one blank line, today's date and the default income/expense option. Closing or reloading discards unfinished input. The form does not read or write persistent drafts, and no discard-draft confirmation is needed.

After an actual create save attempt returns, close the form even if persistence failed. If only some lines were accepted, show the accepted count; unfinished lines are discarded. Opening again allocates fresh client identities. Ordinary input validation still runs before persistence. An in-flight submission keeps its existing busy lock until the attempt returns.

Editing continues to load the original record. The subsequent [ADR0099](0099-income-expense-single-edit-and-manual-sale-pdf.md) restricts general editing to that one record and removes mixed-edit acceptance state. Sales use the same fresh-create lifecycle; stock shortage messages and queued work keep their business rules.

## Durable work is separate from a draft

Removing form recovery never cancels accepted rows or deletes the outbox. Keep number reservations, immutable accepted-submission snapshots, server handoff receipts, cancellation markers, bounded history and the existing sender/idempotency guards. These protect work that has already been accepted.

The shared draft service remains available to its other consumers. Legacy Income/Expense draft copies are ignored; this change does not clear another module's or account's storage.

## Removed complexity

- Income/Expense's persistent-draft integration and draft memoization.
- The now-unused `useAcceptedIncomeLines` hook and create-form recovery state.
- Restored-row/frozen-date/cancelled-row display and draft-discard confirmation in create forms.
- Browser tests that required resuming a saved partial form; replacement tests require fresh forms while accepted work survives.

The client queue, API and database contracts do not change. This supersedes the form-resume behavior in the earlier device-numbering verification and fourth scrutiny report.

## Verification

- `tests/income-expense-fresh-form-browser.spec.ts`: old drafts ignored, close/reopen/reload resets both types, total/partial quota failure closes the form, accepted work stays unchanged and the next create succeeds.
- `tests/income-expense-numbering-browser.spec.ts`: IDB upgrade/counter preservation, partial acceptance, fresh reopen, reconnect, approval and replay.
- Existing offline/PWA and sale UI regressions retain queue, stock and editing guarantees.

Local implementation only; deployment is outside this change.

Verified build: `NwRl_MvlEFHc6zIMh8Xx0`. Strict type/unused checks, lint, source-size/import guards, build, service-worker and bundle checks passed. Full isolated suite: **1,291 passed / 2 existing skipped**. Real PWA: **7 journeys + setup** passed; regression coverage: **19 offline journeys + 1 Income no-draft journey + 9 sale UI journeys** passed on the same build. The three changed product files match the tested copy by SHA-256.

The older sale test fixtures needed real branch IDs, complete feed metadata and the current approval type. Their accessible edit name remains `แก้ไข` even though the visible label is `แก้`. Mocked online sale tests block service workers so their intercepted API requests actually reach Playwright; real PWA/offline tests keep workers enabled. Ambiguous logout selection and the old native-confirm discard fixture were updated to the current UI contract. No product guard or Route validator was weakened to pass these tests.
