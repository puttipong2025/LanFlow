# Bill device Business/Route scan — 2026-11-02

Scope: the uncommitted code-reuse feature, registration/reset Routes, DTO validators, browser numbering persistence, frozen Rubber/Income/Expense validation, advisory gates and reset receipts. Intent: clear old registrations/restart display codes while preserving existing bill numbers, offline work and exact command replay.

Simpler-alternative pass: keep the existing proof/epoch/gate design; deleting it would break frozen work or allow stale registrations to win. An explicit operation parameter on the mutation RPC protects deployment order without an extra preview read on every POST or a new endpoint.

## Finding: reset operations were indistinguishable across versions

Old ADR0100 retires registrations and preserves high water; ADR0102 clears registrations and restarts codes. Both used the same request and preview/receipt shape. Trace: UI -> reset Route -> legacy RPC -> ordinary receipt -> validator -> HTTP200 and a misleading clear-success message. A cached legacy UI could also submit the newly destructive operation without displaying its new meaning.

Fix: require `mode=clear_registry_v1` in preview, browser request, mutation RPC argument and successful receipt. New calls select the four-argument RPC; the three-argument legacy RPC permits completed-receipt replay only and rejects all new commands. No extra preview/snapshot check is added to POST, so exact replay still works after replacements or an empty registry. Forward `20261102012000_bill_device_reset_mode_contract.sql` persists mode per receipt; existing untyped receipts remain legacy_v1. `20261102013000_guard_legacy_bill_device_reset.sql` separates new mutation from old replay. Existing authorization, origin, typed text, snapshot validation, locks and replay ordering stay in place.

## Debug ledger

1. Before edits: focused Route regressions **3 failed / 29 passed**. A legacy preview, legacy acknowledgement and legacy client command each incorrectly returned200. Repro is recorded as tests in `tests/bill-device-reset-route.spec.ts` (working tree only).
2. Ranked hypotheses: missing operation semantics; wrong authorization branch; transport/RPC failure; timestamp validation; concurrent re-registration. The existing29 controls passed for auth/origin/errors/timestamps. Fixed-response tests exclude concurrency and network effects.
3. Attached V8 inspector to the actual transpiled DTO validator. Initial URL breakpoint did not bind; a scriptId breakpoint paused at isDeviceResetPreview's return. Locals had count/snapshot without mode, and another had explicit mode=retire_v1. Both were accepted; invalid count was rejected. This disproves a generic shape-validation failure and confirms operation identity is missing. No runtime instrumentation was left in source.
4. First Route-only fix: **35 passed**, including a temporary preview preflight. Further disproof in SQL found the DB-first rollout was still vulnerable: the previous server could call the three-argument RPC without the new Route. A rollback-only dedicated pgTAP probe failed because no exception was raised. This disproved sufficiency of the Route-only fix.
5. Initial strict unused locals/parameters check passed. No unused runtime function/import/variable has been found in the traced feature paths; no deletion is justified so far.
6. Direct authenticated REST with the explicit fourth parameter against the prior backend returned404/PGRST202 and executed no reset; after the RPC guard migration, the same request returned200 with clear_registry_v1. This proves new clients cannot accidentally select the legacy RPC. Legacy new commands are rejected in SQL even behind an old web server.
7. Final focused Route **34 passed**; SQL operation-contract **13 assertions passed**, including legacy new-command rejection, unchanged registry, wrong explicit mode, legacy receipt replay, persisted operation and current exact replay. Removed the temporary extra preflight call and its mock-only tests in favor of the database-level guard and real HTTP differential.

## Final verification

- Final `npm run verify`: **1,368 isolated passed / 2 existing skips**; lint, types, source-size, import direction, auth outage, build, service worker and bundle budget passed. First load298.6/320kB, offline assets162.
- Final full SQL: **85 files / 2,116 assertions passed**; focused operation contract13, Route34, production browser/PWA9 and dedicated concurrency7 passed. The added real browser case rejects legacy client commands and legacy preview responses without changing the registry. Existing offline/reload/sync/replay/branch-switch and uncertain-result cases remain passing.
- Final strict TypeScript unused locals/parameters check passed; exported Routes, compatibility RPC and shared validators traced to actual framework/client/legacy callers. **No dead runtime code removed**: no unused function/import/variable was established in scope.
- Ordinary Local has all four feature migrations; public/private snapshot refreshed and DB lint has no errors. Devices531/highwater873/receipts0/epoch0/proofs0 remain unchanged; no reset committed there. Multi-session/HTTP reset tests use only the dedicated instance.
- Canonical code-reuse note and hub updated through atomic checksum-guarded writes with exact readback. Vault106-note audit and successor backlinks verified; pre-existing unrelated warnings/conflict groups unchanged.

Verdict: ship with all four migrations, the guarded client, and the temporary legacy-RPC suspension below. No Cloud/Production reset, commit, push or deploy in this scan.

## Rollout order

Cloud already has the retire-only button, so applying only part of the four forward migrations must not expose an intermediate clear implementation. At release time, temporarily suspend authenticated execution of the legacy three-argument RPC before the first feature migration:

```sql
revoke execute on function public.reset_all_bill_devices(uuid,text,text) from authenticated;
```

Apply all four feature migrations in order, verify that the three-argument entry point is replay-only and the four-argument entry point requires clear_registry_v1, then restore legacy receipt inspection and deploy the updated client:

```sql
grant execute on function public.reset_all_bill_devices(uuid,text,text) to authenticated;
```

If migration stops midway, keep the legacy entry point suspended until the final guard is installed. Registration, numbering, business synchronization and Auth remain available. This is a release procedure only; no Cloud privilege change has been executed in this scan.

## Second independent scan — 2026-11-02

Re-traced reset/registration/admin list/retirement Routes through exact-role and origin guards, DTO operation validation, three-/four-argument RPC dispatch, actor/snapshot-bound receipts, registry gates, digest-based frozen-number validation, IndexedDB reservations/counters and offline readiness refresh. Simpler-alternative pass found no justified replacement for the existing guards or proof/epoch mechanism.

Fresh checks: **104 focused Route/numbering tests passed**, **208 SQL assertions across seven feature suites passed**, **7 dedicated concurrency cases passed**, and strict TypeScript unused locals/parameters passed. Catalog confirms the legacy RPC contains no registry deletes, the modern RPC guards p_mode, and anon lacks execute permission. Source-size/build/PWA were not rerun because this scan changed no product code; their preceding verified results remain historical evidence.

No new bug reproduced, unused runtime code established, or speculative fix applied. Only this verification ledger was extended; no product/schema/migration change or Cloud operation. Verdict: ship under the rollout procedure above; no additional finding in the audited scope.

Release follow-up: [2026-11-02 main/Cloud publication](bill-device-code-reuse-release-20261102.md) records the later authorized deployment, including the prescribed temporary legacy-RPC suspension. This scan's Local-only statements above are historical; no actual Production reset was invoked in either phase.
