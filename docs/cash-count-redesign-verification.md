# Cash count redesign — local verification and release boundary

Date: 2026-10-24. Scope: the six implementation phases in `codingDO/10_Daily/2026-10-24.md`. No Git push, Cloud migration or production deployment is implied by this receipt.

## Implementation

- Independent cash-count sessions, numbers, ledger snapshots, cash/bank totals and signed differences; no reason field or prediction/analysis workflow.
- Financial source guards cover parent and relevant child records, both transfer branches, ordinary writes and background writes. Start, submit and cancel use the shared branch fence. Reporting remains independent and retains its own source locks.
- Camera-only one-bank capture; readonly validated OCR result, explicit confirmation, retake and explicit omission. Identical image retries reuse the OCR result. Original images are never exposed by public Drive permissions.
- Private Drive IDs are reserved before upload and reused after uncertain responses. A completed upload is required by the submission RPC. Unused evidence is cleaned lazily on subsequent count actions only for terminal sessions, with a grace period longer than upload timeout; attached evidence, including deleted counts, is retained.
- Optional manager review records the first reviewer and time, without blocking deletion or the next count. Receipt printing is available immediately to the submitting operator; history remains manager-only.
- Thai searchable 80 mm PDF uses existing roll-PDF and sharing machinery, cash denominations, totals, start snapshot, discrepancy and signature lines. Legacy missing baselines remain missing.
- Separate 1–5-day count groups share the existing alert request/timer/dialog/acknowledgement. Count deadlines read count history directly and do not wait for dashboard snapshot readiness.

## Evidence

- `npm run verify`: passed, including lint, TypeScript, source-size/import-direction checks, auth-outage checks, 565 isolated tests, production build, Service Worker and bundle budget. Optional live OCR tests run separately.
- Full local database suite: 56 files / 1,315 assertions passed.
- Auth/middleware route suite: 94 tests passed.
- Final focused browser regression: 33 tests passed, including camera/retake/omission, Admin count-group editing, shared alerts, count/report pagination and deletion, live private Drive round trip, receipt PDF and report PDF regressions.
- Two real PostgreSQL connections verified mutation-before-start observes the committed balance, active sessions fence a different caller, expiry releases the fence, simultaneous review preserves the first reviewer, and review/delete races preserve a consistent deleted result.
- Live OCR: all six supplied photos returned their expected amounts; three synthetic screens verified balance-over-available precedence and refusal of multiple accounts/blank images.
- Live authenticated OCR → Drive upload → submit → replay → private image download passed, with identical image bytes and exactly one attached evidence row; test-created Drive files were removed during fixture cleanup.
- Injected Drive failure, lost database acknowledgement, swapped image, unconfirmed result, expiry and duplicate-ID replay tests passed.
- Additional live cleanup acceptance passed: cancellation retained a recently attempted private file during its grace period; a later count action removed both the unused evidence row and its Drive file after the grace period. Attached count evidence was not part of that cleanup.
- Real browser PDF download passed. `output/pdf/cash-count-sample-80mm.pdf` was parsed and rendered: one 80 mm page, Thai text, expected totals and signature names, no reason field; visual review confirmed no overflow.
- Camera tests use Chromium's simulated camera and mobile viewport; no claim is made of a physical phone camera test.

## Migration replay and data preservation

An isolated temporary database was restored from the pre-change repository schema plus the local Auth schema, without copying customer rows. Fixtures contained two legacy counts and two reports in different branches with the same report number, plus an active legacy session. All three forward migrations applied successfully: both count histories and reports were retained, no ledger baseline was invented, duplicate legacy numbers remained valid within their own branches, and the old active session was expired. The temporary database was removed after verification.

Local migration history and `supabase-schema.sql` match:

1. `20261024010000_independent_cash_counts.sql`
2. `20261024020000_cash_count_alert_groups.sql`
3. `20261024030000_retire_cash_prediction.sql`

## Production cutover and rollback preparation

1. Before any requested Cloud rollout, capture a verified recovery point for public/private schema and business data, including counts, sessions, reports/items, deletion audits and evidence metadata. Keep credentials and backups outside tracked source. Preserve Auth.
2. Use a maintenance window for the coupled schema/application cutover. The first migration already removes the report FK, and the third removes prediction/report fields; the old API is not a supported live intermediate state.
3. Apply the three forward migrations in order and release the matching application build. Reload old PWA clients, check migration history/schema cache, then smoke-test start/cancel/submit, report independence, permissions, private evidence and alert counts before resuming writes.
4. Before migration 3, prepare any failure recovery against the actual checkpoint rather than assuming the old UI can run on detached relations. After migration 3, recover the matching database/application pair or issue a verified forward fix. Do not overwrite historical migrations or fabricate missing snapshots.

The six-phase coding work does not authorize the separate Cloud cutover. Current release state remains local only.

## Final scrutiny

Traced start → branch fence → live canonical balance → optional OCR/evidence → submission/replay → detail/review/PDF, both deletion directions, and Admin group writes → deadline calculation → shared alert parser/hook/dialog. Resolved the legacy audit-pair constraint, lingering report-delete guard, branch-scoped legacy numbering, upload replay and terminal-session cleanup boundaries before closing the phases. Prediction functions and report links are retired; original financial/report source locks and role boundaries remain covered by the database and browser regressions above.

Verdict: ship locally. No unresolved blocker was found in the verified local paths; physical-phone testing and production cutover are not claimed.

Vault write-back updated the Daily checklist and five related project notes/hub with atomic checksum/readback verification. The 86-note read-only audit found no metadata/link/source-path issue in these updated notes; existing findings in other components were left outside this task. Cash-count backlinks were checked through Obsidian.
