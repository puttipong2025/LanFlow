# Bill device code reuse release — 2026-11-02

The user authorized `push main` and `supabase db push`. Target: LanFlow `psxwhhwjmolqperxrlzj`, initially main/origin at `cdd949b`. This releases the [ADR0102](adr/0102-clear-device-registry-and-reuse-device-codes.md) implementation and its cross-version guards. Deploying the feature does not invoke the global reset.

## Database release

Dry-run listed exactly these four pending migrations; all four applied successfully before publishing the corresponding web code:

- `20261102010000_clear_bill_device_registry.sql`
- `20261102011000_bill_device_clear_safeupdate.sql`
- `20261102012000_bill_device_reset_mode_contract.sql`
- `20261102013000_guard_legacy_bill_device_reset.sql`

Temporarily suspended authenticated execution of the legacy three-argument RPC and confirmed no active reset call before applying. After verifying its replay-only guard, restored exactly its previous authenticated execute privilege. Registration, business synchronization and Auth remained available. Read-only authenticated preview returned `mode=clear_registry_v1`; no actual reset was invoked.

Post-apply dry-run reports up to date; public/private remote lint reports no errors. All nine affected function definitions match Local. The modern explicit-mode RPC is authenticated-only; anon and client access to private proof storage/resolver remain denied. Registry epoch and proof count remain zero; the three pre-existing reset receipts remain preserved with their legacy operation marker.

The CLI emitted its previously documented optional pg-delta catalog-cache CA-file warning after completing the push. Migration history, function definitions and subsequent dry-run/lint independently confirm success; no migration was repeated to address the warning.

## Data verification on the live database

Seven recoverable schema/data/Auth/storage/migration/cron backup files, with byte counts and SHA-256 receipts, are in Git-ignored `output/production-backups/bill-device-code-release-20261102/`. No backup or credentials are committed.

The immediate cutover comparison covered91 protected tables:83 fingerprints stayed identical. Auth users/identities54, sessions59, profiles54, Income/Expense2327, financial transactions436, bill devices70, legacy references85 and reset receipts3 had unchanged counts and fingerprints at cutover. Added schema fields were excluded from the corresponding data fingerprint.

Eight Rubber/registration tables changed while users continued working: one new bill/item/binding appeared by the immediate cutover checkpoint. Read-only row comparison against the backup later confirmed all backed-up bill/item/binding/projection rows remained present and unmodified, while three new bills/items had arrived. Issuer changes were additional registrations and increasing last-seen timestamps; branch-code counters increased; a branch head advanced from a previously retired registration to a higher matching registration for the same installation/generation/branch. No old rows were deleted.

The first strict hash-equality diagnostic intentionally stopped on live activity. Its raw checkpoint and row-level explanation were retained. Follow-up comparisons used that fixed immediate checkpoint rather than moving the target during subsequent real-user logins and registrations. No live records were reverted or repaired.

## Verified source

- Full verify:1368 isolated passed /2 existing skips; lint/types/source-size/import/auth-outage/build/SW/bundle passed.
- Full SQL:85 files/2116 assertions. Focused Route/numbering104, dedicated reset concurrency7 and production PWA/browser9 passed.
- Additional release checks: generic database concurrency30 and Route authentication108 passed; configured deployment environment complete; source/staged-secret scan found no configured non-public credentials.
- Production dependency audit remains at the documented November exception baseline:18 records,0 critical/4 high/12 moderate/2 low, within the existing build-tool paths. No dependency upgrade or forced audit fix.

The matching source is published on main after database verification. Exact Git/CI/hosting receipts are recorded in codingDO `LanFlow_Bill_Device_Code_Reuse` and the project hub after publication. The prior [scan ledger](bill-device-code-reuse-route-scan-20261102.md) and [implementation ledger](bill-device-code-reuse-verification.md) record the pre-release checks and failure-path fixes.
