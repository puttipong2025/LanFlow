# ADR 0099: Edit one Income/Expense record and request sale PDFs explicitly

Status: Accepted — 2026-11-01, user authorized the two recommended simplifications.

## Decision

General income/expense editing changes only the original record. The edit form has no add-row control, and the persistence boundary rejects multiple records or a different server/client/branch identity before any approval or write. Creation still supports multiple new rows. A sale remains one parent record containing multiple product lines, so its existing add/remove/reorder product controls remain available in create and edit.

Remove the mixed-edit acceptance map, accepted-line state/props, frozen accepted-row presentation and replay branches used to combine an update with new creates in the same form. Ordinary editing error messages and underlying queue/idempotency/revision guards remain.

Saving or editing a sale waits for its confirmed sync result or approval handoff, then closes without generating a PDF. A synced save shows “บันทึกบิลขายแล้ว”. Stock errors, offline restrictions, pending locks and submission busy protection keep their existing behavior. The existing PDF button generates the receipt only when requested, using the confirmed record and detailed product lines.

Remove the save path's dependency on PDF busy state, PDF eligibility checks and delivery errors. A PDF failure cannot make the save operation appear to have failed.

## Boundaries

No change to database migrations, Route contracts, stock calculation, numbering, outbox retention, history, permissions or approval rules. No pagination or catalogue-loading changes are part of this decision.

ADR0098's fresh-create policy remains; this replaces its temporary statement that mixed-edit acceptance guards remain necessary.

## Verification scope

- `tests/income-expense-background.spec.ts`: reject mixed/foreign edits before side effects; allow one original-record update.
- `tests/income-expense-fresh-form-browser.spec.ts`: actual income and expense edits preserve the bill reference and one-record identity, with no add-row control.
- `tests/income-sale-auto-share-ui.spec.ts`: despite its historical filename, now verifies save/sync/approval/stock locks and absence of automatic PDF delivery for new and edited sales.
- `tests/income-sale-share-ui.spec.ts`: an explicit PDF request shares/downloads the document without changing the business record.

Local verification only; no Cloud apply, commit, push or deployment.

## Verified evidence

Build `RU0vxDByk-3nUs_mH9wgx` passed lint/type/offline assets, service-worker and bundle checks (298.5/320 kB initial load). The three changed product files match the tested snapshot by SHA-256. Strict unused/type checks, ESLint, source-size and import-direction checks passed. The full isolated suite passed **1,291 / 2 existing skipped**.

The production PWA suite passed **8 journeys + authentication setup**, including actual income and expense edits preserving the original bill reference, absence of the add-row edit control, fresh forms, quota failures and existing offline reload behavior. No storage or SQL migration was needed.

Regression verification passed **19 offline journeys + 9 sale save/edit/approval/stock journeys** on that build. The separate manual PDF journey passed sharing, download fallback, full two-line detail display and unchanged revision/update timestamps after document delivery. Total verified browser journeys: **37**, excluding authentication setup.

The old manual-PDF fixture initially failed before entering product UI because service-role direct inserts triggered a private-schema permission check. The test now seeds and removes only its unique fixture through Local PostgreSQL, guarded by the existing safe Local target assertion. Public writes, permissions, triggers and Route validators were not changed to make the fixture pass.
