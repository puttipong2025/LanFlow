# Payroll slip scrutiny — 2026-11-01

## Intent and simpler alternative

Keep original debt/withdrawal descriptions and carried balances readable while showing financial totals once, with the same result in the document Route, Preview and PDF.

The aggregate `deductionRows` model and deduction-only transaction-label branches are no longer consumed by production code. Remove them instead of maintaining a second representation of the same totals. Source-detail snapshots are still necessary: original monthly transactions do not contain prior-month carried balances.

## Trace

- Creation RPC holds the employee fence → existing adjustment/outstanding triggers → new private source-detail snapshot trigger → immutable `slip_data`; no change to payroll amounts or deduction planning.
- Document GET → `requireAuth` → UUID/source-type guard → RLS-bound source query → profile/approver metadata (and live totals/attendance RPCs for withdrawal only) → shared document mapper → JSON.
- Preview and PDF consume the same mapper, but both independently used a device-local weekday for the Bangkok calendar.
- `deductionRows` has no production reader; only its type, empty output assignments and old tests remain. `transactionLabel` deduction/unknown branches are unreachable after the source-type filter.

## Ranked hypotheses and attempted disproofs

1. Calendar: device-local `getDay()` is the primary cause; alternatives are incorrect snapshot dates or a shifted weekday header. Holding the snapshot/header constant and changing only browser timezone disproves the alternatives: Bangkok passes, UTC shifts July 1, 2026 from Wednesday to Tuesday.
2. Route: catch-all converts authorization failures to 500; alternatives are a failing initial authentication step or a transport error mislabeled by the fixture. Authentication succeeds in all fixtures, both source types reproduce 401/403 becoming 500, and the transport-error control correctly remains 500.
3. Optional source metadata: missing runtime array validation is the primary cause; alternatives are invalid monetary inputs or date formatting. All money/date fields remain identical and valid while only the metadata shape changes. Node Inspector pauses at `buildPayrollSlipDocument` on `sources.filter is not a function`; `[null]` fails on `.status` instead.

## Experiment ledger

| Run | Change / control | Observation | Conclusion |
| --- | --- | --- | --- |
| R0 | Production call-site search | No reader of payroll `deductionRows`; label helper only receives source types | Remove unused output and unreachable branches |
| R1 | First test CLI used a regex pipe through the Windows `.cmd` wrapper | Shell interpreted the pipe; tests did not execute | Use the Node Playwright entry point; no product conclusion |
| R2 | 9 focused tests: malformed source metadata; post-auth 401/403 and 500 controls | 7 failures, 2 expected transport controls pass | Reproduced mapper crash and Route status loss |
| R3 | Same July calendar in UTC vs Asia/Bangkok | UTC has 2 leading cells; Bangkok has the correct 3 | Device timezone alone causes the calendar offset |
| R4 | First Inspector bootstrap transpiled a TypeScript default import without interop | Bootstrap failed before production mapper execution | Correct bootstrap compiler option; no product conclusion |
| R5 | Node Inspector with exception breakpoints on the actual mapper | Paused at `sources.filter` with a non-array input | Confirms the mapper fail path without product instrumentation |
| R6 | Remove unused output/branches; validate snapshots; reuse auth errors; use UTC calendar-date arithmetic | 31 mapper/Route tests passed, including the 7 previously failing cases | Fixes address the observed fail paths without changing money calculations |
| R7 | Exercise malformed metadata through the actual document GET mapper, plus both withdrawal RPC failure positions | 34 isolated tests passed | Route-level behavior and auth error propagation verified beyond the mapper alone |
| R8 | Browser/API/PDF regression including UTC and Bangkok; inspect day 1's text position in the generated PDFs | 9 tests passed; day 1 is in Wednesday's column in both contexts | Both rendering surfaces share the corrected calendar alignment |
| R9 | TypeScript, focused ESLint, source-size/import-direction checks, production build, Service Worker and bundle budget; inspect regenerated receipt PNG | All passed; no clipping or overlapping text | Final implementation verified across compile, browser and exported PDF paths |

## Fixes and verification

### P2 — Malformed optional source metadata could crash document GET

- Finding: `src/lib/time-tracking/slip-document.ts:252` now validates snapshot arrays, object rows, amounts and optional text fields before using them. Invalid new metadata falls back to saved legacy transactions; invalid legacy arrays become an empty list rather than throwing.
- Evidence: `{}`, `[null]` and a string produced a mapper TypeError with valid monetary/date fields, which the document GET translated into 500. The Inspector and Route-level tests confirm the fail path.
- Fix: validate at the shared mapper boundary, preserving monetary totals and the original saved descriptions.

### P2 — Device timezone shifted the attendance calendar

- Finding: Preview and PDF previously called local `getDay()` on Bangkok midnight; UTC interpreted the date as the previous day.
- Evidence: July 1, 2026 had 2 leading cells in UTC and 3 in Bangkok, with the identical snapshot.
- Fix: `src/lib/time-tracking/slip-document.ts:265` calculates the weekday of the calendar date using UTC, consumed by `src/components/time-tracking/SlipPreviewModal.tsx:195` and `src/lib/time-tracking/slip-pdf.ts:132`. Browser and generated PDF coordinates are verified in both timezones.

### P2 — Document Route lost post-authentication 401/403 errors

- Finding: `src/app/api/lanflow/time-tracking/documents/[sourceType]/[id]/route.ts:144` now preserves authentication/authorization failures using the existing payroll error helpers.
- Evidence: after successful `requireAuth`, both source-query errors became 500; withdrawal totals/attendance RPCs use the same catch path.
- Fix: return redacted 401/403 responses for recognized auth failures while retaining generic JSON 500 for unexpected failures. Existing source RLS, 404 behavior and initial-auth responses remain unchanged.

### Dead code removed

- Removed payroll `deductionRows` from the document type and both builders: no Preview/PDF consumer remained.
- Removed `transactionLabel` and its unreachable deduction/unknown branches. Only debt/withdrawal source rows reach the formatter.
- Removed the eager `transactions`/`approved` filtering pass that was unused when a new source snapshot was present.

Verification: 34 isolated mapper/Route tests and 9 real API/browser/PDF tests passed. TypeScript, focused ESLint, source-size, import-direction, production build, Service Worker and bundle budget checks passed. Regenerated PDF PNG inspection passed. No SQL/schema changes in this review; prior DB verification remains in `docs/payroll-slip-debt-clarity-design.md`.

Local scope only. Existing income/expense work and the separate rubber-queue failure are outside this review.

Verdict: ship for the reviewed payroll-slip scope — all three reproduced bugs are fixed and the regression checks pass. No commit, push, Cloud apply or deploy performed.
