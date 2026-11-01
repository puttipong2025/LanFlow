# Legacy registration removal and deployment compatibility

Status: accepted by the user on 2026-11-01; implemented and verified locally. Extends ADR0096.

## Decision

During rollout, a legacy registration response without `deviceId` remains supported. A response that advertises `deviceId` must supply a valid UUID. The shared issuer validator enforces this optional-field contract at both the registration Route and browser persistence boundary. Existing cached issuers without that field remain usable, preserving counters and frozen proposals. No new requirement blocks the old backend before the shared-device deployment is ready.

The user subsequently requested actual removal of obsolete registrations, rather than merely hiding or retiring them. The cleanup applies when the migrations are deployed; production remains unchanged until then.

## Removal scope

`20261101022000_retire_legacy_bill_issuers.sql` marks historical unlinked registrations retired. The subsequent `20261101023000_remove_legacy_bill_issuer_registry.sql` removes **all registry rows with `device_id IS NULL` and their head links** in an explicit transaction. Modern device/branch usage links, devices, global high-water marks, bill bindings, outboxes and business rows are retained.

Before removal, the transaction retains only `(issuer UUID, location UUID, code)` in private `legacy_bill_issuer_refs`. This is not a device registration or an Admin history row. It stores no browser/platform/user/contact data. Both existing numbering validators resolve either a current registration or this immutable historical reference and retain their original branch/number/metadata checks. It is necessary because old bills and offline commands still contain the removed issuer UUID. Client/anonymous roles cannot create or modify these references.

The Admin page and its HTTP list endpoint default to active devices. Explicit retired-device history remains available for modern devices; obsolete unlinked registrations no longer appear even when querying history because they are absent from the registry. This is registration cleanup, not deletion of any bill or its number.

## Evidence

- Before Local cleanup: 313 obsolete rows, including 312 active. After removal: **zero obsolete registry rows**, with 313 minimal reference rows retained. Counts of modern active usage links were unaffected by the cleanup itself; tests may create additional isolated fixtures.
- SQL targeted: **101 assertions passed**. `legacy_bill_issuer_refs_test.sql` proves real Rubber and Income business commits after the legacy issuer is absent, frozen final numbers, rejection of a wrong branch and denied client reference insertion.
- Full SQL: **1,922 assertions / 79 files passed**. Three concurrency tests passed for shared codes, retirement, registration replay and both bill modules' business replay.
- A reproduced validator gap accepted a malformed advertised `deviceId`. A disposable V8 debugger using the HEAD contract reproduces accepted/ready=true for `deviceId="invalid"`; the current contract rejects it and leaves a fresh browser unregistered. The same current code accepts legacy responses without `deviceId`, as requested.
- Focused registration/readiness tests passed 72 cases before the later default-filter regression was added. Final full verify passed **1,245 tests / 2 existing skips**, including that filter regression; lint/type/source-size/import/auth-outage/build/offline/service-worker/bundle checks passed. First load **298.7 / 320 kB**; offline manifest 161 assets.
- Production browser/PWA/Route run passed **114 tests** against the locally targeted verified build, including default-active Admin filtering, retired modern-device history, shared codes on branch switching, offline issuance/exact replay and PDF/lock journeys. Strict type/unused check and targeted ESLint passed. The two trailing spaces introduced by the generated validator lookup were normalized in the secondary schema snapshot.

## Rollout and rollback

The numbering note, Income/Expense note, original user-requested Daily and canonical hub were saved atomically with readback verification. The post-write 103-note audit matched the baseline with no new issues.

Apply the shared-device migrations first, then 22000/23000, with the updated validators and reference copy committed together. Do not directly delete historical issuer rows without the reference migration. Rollback must retain the reference table and validator lookup as long as old bills/offline commands can reference those UUIDs. Do not delete bill bindings or lower the global counter. These changes were applied only to Local; no Cloud mutation, commit/push or deployment is implied.
