# Bill device code reuse — 2026-11-02

User confirmed [ADR0102](adr/0102-clear-device-registry-and-reuse-device-codes.md). Clear all active/retired/legacy registration rows, restart display codes at D01 and new local sequences at 0001, preserve frozen bills/outbox/approvals and suffix/replay bindings. Existing exact Super Admin, confirmation, snapshot, advisory gate and request receipt protections remain.

## Implementation and review trace

- `20261102010000_clear_bill_device_registry.sql`: preserve only SHA-256 membership proofs for previous issuer UUID + location + code; clear branch/device heads, issuer/device rows, legacy plaintext references and branch code counters atomically; reset global code counter and increment registry epoch. Number suffix counters, bindings, business rows, Auth and reset receipts remain untouched.
- Both numbering validators resolve live registrations or exact proof membership under the registry shared gate. Unknown IDs, altered codes, other branches and immutable-number changes remain invalid. Register/retire/reset use the existing gate and lock ordering.
- Registration returns an optional validated `registryEpoch`; browser persistence compares epoch before code to accept a lower recycled code and reject stale pre-reset responses. Replacing issuer UUID restarts new Rubber/Income/Expense counters; queued payloads and Rubber reservations remain frozen.
- Admin preview covers retired and legacy entries as well as live devices. Labels say registration entries rather than active devices. Receipt `retiredCount` remains a compatibility field containing the cleared-entry count. Retry looks up its original receipt before the current registry and never clears replacements.
- Simpler alternative considered: deleting registry rows alone breaks frozen numbering validators; accepting every missing issuer would accept forged IDs/codes. One private digest table reuses existing payloads and avoids a new signed-token format or retained plaintext registry.

## Experiments

1. Focused initial client/Route tests: 76 passed, including lower-code reuse, same-code counter restart, delayed higher pre-reset response and existing stale-response control.
2. Dedicated SQL: bulk reset 38, Rubber numbering/approval 42, Income/Expense numbering/approval 36, legacy references 7 and global issuer codes 16 assertions passed. New code reuse suite: 56 assertions passed through real Rubber/Income/Expense create and replay. It verifies suffixes 1/2/3, offline submissions after reset, repeat reset, plaintext removal, proof ACL, forged-code/branch/UUID rejection and rollback of registry/counter/epoch/proofs if receipt insertion fails after deletion.
3. Fixture adjustments: old tests expected retirement/high-water preservation; expectations now assert deletion/counter zero. A retirement racing behind a successful clear may return ISSUER_NOT_FOUND. Standalone SQL needs pgtap installed outside the per-file rollback. The new first-D01 fixture explicitly resets the empty test counter left by integration cleanup; product behavior was not changed for this fixture.
4. Final dedicated concurrency: 7 passed, including duplicate request, two competing requests, registration on either side of reset, individual retire/reset race, validation shared-gate handover to proof membership and bounded lock timeout rollback.

Multi-session and HTTP destructive tests target only `supabase_db_lanflow-bill-reset-test` / API55431. The ordinary Local standard SQL suite runs each file in a rolled-back transaction; no reset is committed there. Cloud is never a test target.

5. Full `npm run verify`: lint, types, source-size, import direction, auth outage, 1,363 isolated tests / 2 existing skips, build, 162 offline assets, service worker and bundle budget passed (first load 298.5/320 kB). Ordinary Local full SQL after the final forward fix: 84 files / 2,103 assertions passed.

## API-only failure and fix ledger

1. Initial production-browser run: 3 passed / 5 failed. One strict locator also matched an unrelated employee-list error toast. The remaining reset calls returned 503 even though SQL tests passed. This is a real API-path failure, not evidence of a passing release.
2. Ranked hypotheses: PostgREST session restrictions, lock timeout, foreign-key dependency, receipt validation after commit, stale schema cache. No SQL debugger extension was available, so traced Route result/error branches through RPC to DML. No waiting reset backend and no additional receipt committed ruled against lock/acknowledgement causes.
3. Direct authenticated REST reproduction in the dedicated instance: register200, preview200, reset400 with SQLSTATE21000 / `DELETE requires a WHERE clause`. Authenticator role configuration loads `supautils, safeupdate`; direct psql sessions do not. This explains the SQL/API differential.
4. Disproof/control: loading safeupdate as ordinary postgres was denied. As local supabase_admin, in a rolled-back transaction, a DELETE without predicate failed while the same DELETE with WHERE true succeeded. Role, table and connection otherwise matched.
5. Forward `20261102011000_bill_device_clear_safeupdate.sql` adds explicit predicates to all six authorized registry deletes. No permission or guard is relaxed. Exact direct REST reproduction then returned reset200 with its receipt. Both new migrations must be installed together before exposing the button.
6. Browser rerun after SQL fix: 7 passed / 1 timed out. Screenshot showed the offline reload opened Rubber (the default offline module), while the expanded test waited for an Income button without changing module. Navigating back to Income/Expense fixed the fixture. A narrow fixture stub for unrelated employee-list GET prevents the known SMS-hook error toast from covering or matching reset dialog content; all reset/registration/auth/business calls remain real.
7. Final production browser/PWA: **8/8 passed**, 55.2s. Includes save/reload offline, clear from another online context, create another old-code bill while still offline, reconnect/sync/exact replay, receive new epoch, new Income sequence1 and cross-branch shared code. Also desktop1280/mobile375, typed confirmation/focus/Escape, real conflict, double submit, lost response and unrecognized409 after commit.

## Rollout and recovery

Apply both `20261102010000_clear_bill_device_registry.sql` and `20261102011000_bill_device_clear_safeupdate.sql` after existing 040000/041000/shared-device migrations, then deploy the updated client. Refresh clients before triggering the first clear: older cached clients assume codes only increase. Installing the migrations never clears registrations. Read preview to smoke-test; only an explicit Super Admin confirmation executes the clear.

Take a schema/data backup before an intentional Production clear if historical device metadata must remain recoverable outside the active database. After a clear has issued replacement codes, restore/reenabling old registrations would conflict with the new namespace; prefer a forward fix. Keep proof, suffix and request-receipt data when disabling the button or rolling back UI. Do not revert the database to a pre-proof validator after clearing.

## Delivery state

Both forward migrations installed on ordinary Local; public/private schema snapshot refreshed. Before/after: devices531, code high water873, reset receipts0; device/issuer/legacy full-row fingerprints identical. New registry epoch0/proofs0 confirm installation did not execute a clear. Full public/private DB lint reports no errors.

Memory saved and exact checksum/readback verified in codingDO: new canonical `LanFlow_Bill_Device_Code_Reuse`, old bulk-reset note marked superseded with successor link, Rubber/Income-Expense contracts updated with the new decision, and hub routing/verification updated. This records Local verification and explicitly leaves Cloud rollout pending.

Final strict unused-variable/parameter TypeScript check and scoped ESLint passed. A targeted real-browser UI rerun passed after isolating the unrelated toast; inspected the clean 375px dialog screenshot with full description, confirmation field and both buttons visible. Vault audit106notes and successor backlinks passed for this change; pre-existing metadata/link/source-path warnings and two unrelated component conflict groups are unchanged.

Review verdict: ready for release with **both** new migrations and updated client; no remaining finding in reset/numbering/auth/replay paths after the API-only fix. No Cloud migration, Production reset, commit or push has been run for this change.

## Subsequent Business/Route scan

The follow-up [scan](bill-device-code-reuse-route-scan-20261102.md) found a cross-version operation-identity gap. Its forward migrations `20261102012000_bill_device_reset_mode_contract.sql` and `20261102013000_guard_legacy_bill_device_reset.sql` are now required too: deploy all four feature migrations before the current client. A clear uses the explicit-mode four-argument RPC; the old three-argument RPC is replay-only. Preview/request/receipt mode markers prevent a retire-only backend or legacy receipt being reported as a clear. This updates the earlier two-migration release verdict; previous experiment counts above are historical evidence.

Production follow-up: the user subsequently authorized main publication and Cloud migration. All four migrations and the temporary legacy-RPC suspension/restoration were executed and verified; see the [2026-11-02 release record](bill-device-code-reuse-release-20261102.md). No actual Production reset was invoked. Earlier Local-only statuses above describe their verification phase.
