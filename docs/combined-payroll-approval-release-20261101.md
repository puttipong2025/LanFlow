# Combined payroll-slip and approval-settings release — 2026-11-01

User authorized pushing the payroll-slip changes together with the “ปรับ UI ตั้งค่าอนุมัติรับจ่าย” chat to `main`, and applying the matching Supabase migrations.

## Scope

- Payroll Preview/PDF: original source details, carried balances, one bottom summary, compact normal slips, timezone-independent calendar and document Route/error/cancellation corrections.
- Income/expense: approval table and separately saved, collapsed settings; super-admin-only configuration writes; server-generated audit timestamps; acknowledgement/error/cache guards and keyword scope validation.
- Excluded: the unimplemented income/expense device-numbering plan, its ADR/glossary section, local attachments, secrets and backups.

## Preflight and checks

- Current `main` matches `origin/main` at `eec27a7` before release.
- Linked Supabase project verified as LanFlow `psxwhhwjmolqperxrlzj`.
- Reviewed remote dry-run contains only `20261031042000`, `20261031043000`, `20261031044000`.
- Fresh schema/data backups completed in the Git-ignored `supabase/cloud-backups/20261101-payroll-approval-release/`; SHA-256 recorded locally. Capture of Auth/profile counts and payroll financial-facts hash saved beside them. No secret or business-row backup contents are committed.
- Production environment preflight passed.
- Full `npm run verify` passed: lint, types, source/import checks, auth-outage check, 1,192 isolated tests passed / 2 existing skips, production build, Service Worker and bundle budgets.
- Full Local database suite passed: 76 files / 1,863 assertions. The earlier rubber-queue assertion also passed in this combined release run.
- Focused payroll/approval SQL suite passed: 247 assertions.
- Concurrent mutation suite passed: 27 tests.
- Combined real browser/API/Route suite: 142 passed / 1 initial payroll-page readiness timeout at 5 seconds. The isolated failing test then passed. An overlapping repeat attempt lost its shared test server when the first runner shut down; those connection-refused results are discarded as test orchestration failures. The full payroll/PDF suite subsequently passed all 8 tests on its own dedicated server without product-code changes.
- The staged source files match the tested source hashes. Staged contents were checked against configured production secret values; none were found.

## Deployment

Supabase Cloud migrations applied successfully before application push:

- `20261031042000_income_expense_approval_settings_access.sql`
- `20261031043000_income_expense_keyword_disable_timestamp.sql`
- `20261031044000_payroll_slip_outstanding_source_details.sql`

Post-push dry-run reports up to date; remote DB lint reports no errors. Five affected triggers are enabled, the four permissive configuration-write policies require `is_super_admin()`, existing restrictive SMS session gates are preserved, and the private payroll snapshot helper is not executable by anon/authenticated. An initial verification-script assertion incorrectly counted the restrictive session gates as write grants; correcting the read-only verifier established the expected policy state without additional database changes.

Before/after data invariants match: Auth users 54, profiles 54, payroll slips 57, financial transactions 433, keywords 4; the hash of original payroll amounts and existing snapshot fields is unchanged. All 57 active slips have the new source details with zero amount mismatches.

The CLI completed migration application with a warning that its optional pg-delta catalog cache could not find a temporary CA file. Direct catalog/data checks, subsequent CLI dry-run and remote lint succeeded.

Application commit is ready to push to `main`; Vercel's Git integration will deploy the matching code. Application deployment status and public HTTP smoke will be checked after push.
