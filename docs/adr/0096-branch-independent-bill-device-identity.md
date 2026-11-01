# One browser device code across all branches

Status: accepted by the user on 2026-11-01; implemented and verified locally. Supersedes the branch component of issuer identity in ADR0091/0094/0095.

## Decision

Device identity is `(installation UUID, generation UUID)` for one browser/profile. Branch is removed from that identity. One device receives one globally unique `D...` code, shared by Rubber, Income and Expense across every authorized branch. Browser tabs/accounts share that identity. Bill authors, access rules, outboxes and local bill counters remain partitioned by their existing branch/account rules.

`private.bill_issuer_devices` owns the unique code, lifecycle and installation/generation. `private.bill_issuer_device_heads` binds the current device to that UUID pair. Existing `rubber_bill_issuers` rows become branch usage links with a `device_id`; the registration response retains a branch-specific issuer UUID for frozen metadata and authorization, and adds the shared device UUID. These usage links do not allocate another device code. Validators continue checking their branch; removing branch from device identity does not authorize another branch's business writes.

The existing global counter still allocates codes atomically and never recycles them. Its previous per-registry global unique index moves to the device table, since multiple branch usage links intentionally share the same code. A unique device/branch index prevents duplicate usage links. Registration and retirement serialize on the same installation/generation advisory lock, and repeated requests remain stable.

## Browser storage and recovery

`issuer-installation.ts` keeps a single `bill-issuer-installation` root in the existing number store, in the same IndexedDB transaction as branch preparation. No localStorage identity, new store or database version is added. The root tracks branches previously initialized. New branches reuse the same UUID pair; branch states retain their own counters/reservations.

Lost/corrupt installation state creates a fresh identity. Lost/corrupt state of a previously initialized branch rotates the shared generation so that its counter cannot restart under a previously issued code. Other branches pick up the new identity on preparation. Existing branch outboxes and accepted submissions remain unchanged. Missing state for a genuinely new branch does not rotate the device. Old registration responses still use the existing generation/code downgrade guards.

## Migration and compatibility

Latest lifecycle/rollout amendment: [ADR0097](0097-legacy-device-registry-cleanup.md) allows the legacy backend to remain usable until deployment, validates an optional advertised device UUID, and removes obsolete unlinked registry rows while retaining minimal bill references outside the device registry. It supersedes retaining those obsolete rows in Admin history.

Forward migration `20261101021000_branch_independent_bill_devices.sql` follows `20261101020000_global_bill_issuer_codes.sql`. Old registrations/bills/PDFs/queued proposals retain their numbers and remain accepted. A new shared browser root and next online registration transition new work to the branch-independent device. Legacy UUID pairs from different branches cannot be inferred to be the same physical browser centrally; the new shared browser root supplies that relationship going forward.

Admin lists one row per device, aggregating the names of branches using it. The existing branch filter filters usage; it is not an identity component. Retiring any device usage link retires the device and every linked branch registration. Future registration creates one replacement code, reused across branches. Retiring a historical unlinked row retains the historical per-row behavior.

Branch bill counters remain separate: the same browser can issue `0001-261101-D300` in two branches. Final-number uniqueness and financial relations retain their branch scope and existing suffix/binding rules. This decision removes branch from device identity, not from business data. Cloned/restored browser storage can still repeat an offline base and uses the existing central reconciliation.

## Verification and rollout

SQL targeted: **94 assertions passed**; full SQL **1,915 assertions / 78 files passed**. Concurrency: **three tests passed**, including 12 independent devices, one UUID pair concurrently registered in four branches, exact retries, retirement from one branch and shared replacement in another. Browser allocator tests cover parallel tabs/branches, missing shared/branch roots, queue retention and both bill modules.

Full verify: **1,213 passed / 2 existing skips**, with lint/types/source-size/import-direction/auth-outage/build/offline/service-worker/bundle checks passing. The production artifact was explicitly built with the local environment; first load **296.8 / 320 kB**, offline manifest 161 assets. The production browser/PWA/Route run passed **114 tests**, including actual browser branch switching with one durable installation/generation/code, Admin desktop/mobile, offline issuance/exact replay and immediate PDF/lock journeys. Additional targeted ESLint passed after the browser regression was added. No production instrumentation.

Catalog checks confirm the installed migration, unique device code and device/branch indexes, and denied client table mutation privileges. The public/private schema snapshot was refreshed from Local. Vault numbering/income notes, original Daily and hub were atomically saved with expected SHA-256 and exact read-back verification; the 102-note audit has no new issues and backlinks were verified.

Deploy server capability before the updated browser allocator; older clients can keep their historical branch scopes until upgraded. Rollback must retain the device registry/links/global counter and accept already-issued metadata. Do not restore the old unique-per-registry-code index or branch allocation function. No Cloud deployment is implied.
