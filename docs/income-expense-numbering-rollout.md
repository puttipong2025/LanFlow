# Income/Expense numbered bills — rollout and rollback

Scope: general income/expense creates only. The plan uses the existing issuer registry and keeps rubber/sales/derived documents and all previously issued numbers intact. Preparing this runbook does not authorize a Cloud migration, commit, push, deployment or database reset.

## Dependencies and compatibility

1. Apply migrations `20261101010000_income_expense_device_numbers.sql` and `20261101011000_income_number_date_and_feed_lookup.sql` in order, after the existing rubber issuer/numbering and Income/Expense approval migrations. Use a forward migration for corrections; do not edit applied migration history.
2. Keep the numbered RPC `sync_numbered_income_expense`, durable create receipts, suffix counters/bindings, metadata validator and read projections available before a client can submit the new metadata. An old backend must reject the numbered RPC as unavailable rather than generating a legacy number.
3. Deploy the client only after backend capability and a small direct-create/approval/replay smoke pass. This client now opens IndexedDB v11: v10 added the owner/branch/identity-scoped acceptance store; v11 adds the separate bounded offline history copy. Upgrades preserve existing queue, receipts, registrations and rubber counters. See [offline history](income-expense-offline-history.md).
4. Existing payloads without numbering metadata keep their old synchronization path. Legacy pending work keeps its original local number when edited. New numbered work must carry its original metadata on update/delete and approval; an older client that omits it cannot mutate an issued numbered row.

## Controlled checks before enabling

- Verify the exact forward migration versions and definitions on the target, including the metadata lookup partial index. Do not infer a Cloud apply from the Local schema snapshot.
- Verify authenticated branch access, denied/closed actors, approval permission, report lock and cash-count lock using non-sensitive fixtures.
- Verify one numbered create, one create requiring approval, one rejection and an exact replay. No suffix is issued while pending; a committed row/final/binding appear together. Rejecting before the original acknowledgement arrives must not reopen a request on replay.
- Verify actual PWA offline save → reload → reconnect with one row per identity. Check I/E and rubber counters are independent, multiple tabs/accounts share the issuer scope, and damaged numbering state cannot restart the old code.
- Verify old outbox entries and previous number layouts are still present and sendable under their original contracts. Inspect the old-tab/upgrade behavior before changing the production client.
- For a new browser, wait until registration is durably prepared before going offline. The readiness indicator checks the shared issuer state, including the I/E allocator state.

## Stop conditions

Stop the rollout if a numbered response has the wrong base/identity/metadata, if an unsuccessful business insert leaves a binding, if a replay creates another approval, or if an upgrade clears/rewrites issued numbers or pending commands. Preserve uncertain local work and follow its original identity; do not delete/rebuild an outbox to make a check pass.

## Client rollback after numbers have been issued

- Keep backend support for numbered payloads, metadata, bindings and durable terminal outcomes. Never revert to a backend that silently ignores the new metadata.
- Do not downgrade IndexedDB, delete the v11 database/stores, recycle a retired issuer or reset counters under an old code. An old tab may be blocked by the version fence; ask the operator to finish/reopen it with a compatible client while preserving browser data.
- Prefer rolling back the UI change with a compatibility build that still reads/writes v11 and retains the numbered sender and validators. Returning to an unmodified older bundle is not a safe rollback for a browser that already has v11 work.
- Keep accepted snapshots and immutable pending payloads. Retired issuers remain valid for old queued bills under the existing authorization checks; new work obtains the new issuer when the browser learns of retirement.
- Approval history may be compacted under its existing policy. Do not remove the durable create receipt or number binding with disposable history. A deliberate fresh submission uses a new form-line identity, not the original network retry.

## Operator-visible behavior

One field is labelled `เลขที่บิล`. Before durable save it says `ออกเลขเมื่อบันทึก`; after local save each row has its base, e.g. `E-0001-261101-D03`; after business creation it has the final suffix. Editing the business date does not change the number date. Issued numbers are not reused after cancellation, deletion or rejection. Cloned/restored offline data may produce equal bases; the central suffix reconciles different identities after reconnect.

## Evidence boundary

Current Local evidence and any remaining gaps are recorded in `docs/income-expense-numbering-verification.md` and `codingDO/10_Daily/2026-10-31 4.md`. Mark a release as executed only after its target-specific checks and separately authorized publishing steps have actually completed.
