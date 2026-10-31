# Payroll slip second scrutiny — 2026-11-01

## Intent and simpler-alternative pass

Verify the normal-slip compact summary without hiding real carried debt or changing the original debt-slip behavior. Keep the existing shared mapper and conditional sections instead of introducing a new template or Route.

## Trace

Document GET authenticates and queries the source under RLS, then the shared mapper reads saved source details, determines `hasAdjustments`, and creates the summary. Preview and PDF both hide an empty source list and use the same financial summary. Legacy `transactions` can include `APPROVED` rows with `cancelled_at`, because the historical snapshot query selected transactions by type/month without filtering cancellation.

## Reproduction and hypotheses

- Deterministic failing case: legacy approved debt amount 1,000, cancelled October 10, slip created November 1, all outstanding/deduction totals zero. The mapper still emits the cancelled item and expands the summary to five rows.
- Ranked hypotheses: (1) source-detail filter ignores cancellation; (2) financial aggregate is wrong; (3) date comparison/timezone is wrong; (4) the compact renderer independently expands the summary.
- Disproof controls hold the amount/type/status and renderer constant: uncancelled and post-slip cancellation rows must remain visible; both already pass. Explicit zero aggregates rule out hypothesis 2; the pure mapper reproduction rules out hypothesis 4. Node Inspector confirms a cancelled row survives into `sourceRows` before `hasAdjustments` runs. There was no date comparison at all, ruling out timezone arithmetic as the immediate cause.

## Experiment ledger

| Run | Change | Result / conclusion |
| --- | --- | --- |
| S0 | Strict TypeScript unused checks and existing mapper/Route tests | No unused declarations reported; 35 tests pass |
| S1 | Add before/after/no-cancellation controls on legacy sources | Pre-slip cancelled row fails; other 2 controls pass |
| S2 | Node Inspector breakpoint before `hasAdjustments` | Cancelled input is still present in `sourceRows`; filter omission confirmed |
| S3 | Filter by cancellation instant relative to slip creation | Mapper/Route regression 39 tests passed, including pre-slip cancellation and after-slip controls |
| S4 | Add equal-instant control expressed as Bangkok +07:00 | All 4 cancellation controls passed; equal instants are excluded consistently |
| S5 | Strict unused/type check, focused ESLint, source-size/import checks and diff check | All passed; no additional dead code found |
| S6 | Real document API/RLS, normal/debt browser views, mobile, PDF export and UTC/Bangkok calendar regressions | All 10 tests passed |

## Dead code

No further unused functions/imports/variables found in the reviewed path. Previous dead-output and empty-render branches were already removed.

## Fix and verification

### P2 — Cancelled legacy source rows could make a normal slip appear to have debt

- Location: `src/lib/time-tracking/slip-document.ts:378`.
- Evidence: the reproduced debt was cancelled before slip creation but retained `APPROVED` status in the saved legacy transaction. Its detail appeared beside zero opening/remaining totals and forced the full five-line summary.
- Fix: include cancellation metadata in snapshot validation and suppress rows cancelled at or before the slip's creation instant. Preserve rows cancelled later so a historical document is not rewritten by later events. Preview/PDF consume the resulting filtered list without separate rules.
- No monetary totals, Route authorization, SQL/schema or production data changed.

Browser/API/PDF regression: 10 tests passed. No Cloud write, commit, push or deploy.

Verdict: ship for the reviewed scope — cancelled legacy debt is excluded without changing monetary totals or valid historical details.

## Third scrutiny — 2026-11-01

- Goal: verify the existing complete/compact payroll-slip behavior and cancellation fix end-to-end. Simpler-alternative pass: keep the existing shared mapper and conditional sections; no additional template, helper layer or Route is needed.
- Trace: document GET auth and input guards (`src/app/api/lanflow/time-tracking/documents/[sourceType]/[id]/route.ts:53`), RLS-bound source reads, metadata and withdrawal RPC failures, shared snapshot validation and cancellation filter (`src/lib/time-tracking/slip-document.ts:253`, `:375`), compact-summary decision (`:381`), Preview detail guard (`src/components/time-tracking/SlipPreviewModal.tsx:217`) and PDF detail guard (`src/lib/time-tracking/slip-pdf.ts:257`).
- Checked no-debt, carried debt with no deduction this month, partially deducted debt, fully deducted debt with zero remaining, pending/approved statuses, legacy cancellation timing, malformed optional metadata, auth failures, invalid identifiers/types, unavailable database errors, mobile output, timezone-independent calendars and long PDF documents.
- Strict TypeScript `noUnusedLocals`/`noUnusedParameters`, focused ESLint and diff check passed; call-site search found no additional unused production declarations. No product code was changed in this pass.
- Isolated regression: 57 tests passed. Additional direct controls: 8 amount/status cases and 3 Route short-circuit cases passed; invalid identifiers/types stop before database access and an auth failure is returned unchanged.
- SQL: 48 assertions passed across source-detail and outstanding-snapshot suites. API/browser/PDF: all 10 tests passed, including real source RLS and both UTC/Bangkok PDF calendar positions.
- No reproducible new bug found within this reviewed scope. Existing source snapshots remain necessary because monthly legacy transactions alone cannot reconstruct carried balances.
- Verdict: ship for the reviewed scope; no additional fixes required by this pass. No commit, push, Cloud apply or deploy.
