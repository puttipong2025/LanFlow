# Combined payroll/time and bill-device reset release — 2026-11-02

The user authorized pushing `main` and applying Supabase migrations together with Codex chat `01a19675-4280-7990-8a9c-d08d20f9e9b4`. That chat confirmed its scope ready and froze source changes; this chat owns the combined release. Deploying reset functionality does not authorize exercising the global reset in Production.

## Scope and ordering

- Payroll/time: atomic recalculation after reopening a payroll month; attendance revisions and stale-write prevention; coordinated UI/Badge refresh; mutation guards and error handling.
- Device reset: Super Admin preview/confirmation, registry snapshot checks, idempotent receipts and replacement codes without recycling existing numbers.
- Include the repository records/tests for report-balance migration `20261101030000`, already applied to Cloud in the separately authorized report repair. It is not pending in this release.
- Linked project verified as LanFlow `psxwhhwjmolqperxrlzj`; `main` and `origin/main` initially match at `5ef357f`. Dry-run lists exactly `20261101040000`, `20261101041000`, `20261101050000`. Apply all three before the matching web code, preserving the required 040000/041000 pair.

## Verification and recovery

- Combined lint, typecheck, source-size/import-direction and login auth-outage checks passed. Isolated tests: 1,346 passed / 2 existing skips. The newly registered attendance Route/action test adds 9 passing cases; it now runs in the ordinary isolated CI gate.
- Full Local database suite: 83 files / 2,044 assertions passed. Existing concurrent DB suite: 29 passed; attendance concurrency: 1 passed and registered in the ordinary database CI gate. Dedicated harness tests are excluded from the generic browser project.
- Focused payroll Route/action suite: 67 passed. Actual-component payroll browser suite: 11 passed. Shared browser UI smoke: 1 passed.
- Initial optimized build overlapped a dev Route runner in the same temporary checkout, causing a missing app-entry invariant. That run is invalid as build evidence. A fresh dedicated build checkout completed successfully; Service Worker and unchanged bundle budgets passed. First load 298.6/320 kB; payroll 122.7 kB raw / 28.8 kB gzip. No product changes were made for the orchestration failure.
- Production dependency audit matches the existing November exception review: 18 records (0 critical, 4 high, 12 moderate, 2 low), all under the previously documented build-tool paths; no forced dependency upgrade.
- Recoverable pre-release public/private/Auth/migration schema and data dumps are in Git-ignored `output/production-backups/payroll-device-release-20261102/` with SHA-256 receipts. No backups, session fixtures or environment secrets belong in the commit. Counts and fingerprints of Auth/profiles, payroll facts and device registries are captured for post-apply comparison.

## Release status

Final Route authentication suite: 108 passed. Staged source/migration contents match the tested snapshot after line-ending normalization; configured non-public production credentials were not found in staged content. Whitespace scan passes with pre-existing blank-at-EOF notices in the report-repair record excluded; the already-applied report migration was not rewritten for formatting.

Supabase Cloud successfully applied 040000, 041000 and 050000 before web push. A subsequent dry-run reports up to date; remote lint returns no errors. The CLI emitted its previously observed optional pg-delta catalog-cache CA-file warning after the successful application. Direct catalog checks confirm all three history rows and all 13 affected function definitions exactly match Local, so no migration was repeated to address that cache warning.

Before/after counts and full-row fingerprints match for Auth users (54), profiles (54), financial transactions (436), payroll slips (56), active periods (34), attendance exceptions (86), bill issuer devices (53) and Rubber issuers (75). Private unchecked attendance writer and reset receipts are inaccessible to client roles; the revision-checked writer is the only public attendance writer; reset conflict code is PT409. A read-only authenticated Super Admin reset preview returned a valid snapshot; the actual reset was never invoked.

Git push, CI and application deployment status will be recorded after execution.
