# Shared-device Business/Route rescan — 2026-11-01

Intent: validate device registration through authorization, browser persistence, offline allocation, retirement and legacy-reference lookup without expanding the current feature.

## Simpler alternative

Reuse the shared `isRubberBillIssuer` guard. One string-type check fixes the Route and browser boundaries together; no new endpoint, helper, schema change or number reallocation is needed. Existing backend responses without `deviceId` remain supported during rollout.

## Finding: array-shaped codes pass the issuer contract

**Finding:** `src/lib/rubber-bills/numbering-contract.ts:7` accepted `code: ["D01"]` because `RegExp.test` coerces its input. The Route returned HTTP 200 for this malformed registration.

**Why it matters:** the contract claims `code` is a string. `src/lib/rubber-bills/numbering-idb.ts:83` calls string methods on it inside the persistence transaction. Admitting an array violates that boundary before the client can safely persist or use the response. The normal SQL registration emits a string; this finding concerns rejection of a malformed response, not evidence that the current SQL emits arrays.

**Trace:** registration POST at `src/app/api/lanflow/rubber-bills/issuers/route.ts:23` → shared issuer validator → HTTP response → `prepareRubberBillIssuer` validation at `src/lib/rubber-bills/numbering-idb.ts:74` → persistence transaction → string-method use. Both entry guards used the same coercive regex. Income/Expense's allocator uses that same guard at `src/lib/income-expense/numbering-idb.ts:42`.

**Change:** require `typeof x.code === "string"` before the existing regex. No formatting or numbering rules change for valid codes.

## Debug ledger

1. Added a Route regression using an authenticated, mutation-authorized request and an RPC response containing `code: ["D01"]`. Before the fix: HTTP 200 instead of expected 503; one failure and three existing compatibility controls passed. Runnable command: `node node_modules/@playwright/test/cli.js test --config=playwright.isolated.config.ts tests/rubber-issuer-route.spec.ts --grep "array masquerading|compatibility" --workers=1`.
2. Attached a V8 inspector session to the actual transpiled `numbering-contract.ts` and paused at its return expression. The array had JavaScript type `object`, `Array.isArray=true`, and regex result=true. This narrowed the fail path to the guard before changing runtime behavior.
3. Ranked hypotheses: (1) implicit string coercion; (2) the Route bypasses validation; (3) fixture response transformation; (4) auth/error fallback returns success. Disproof controls ran before the fix: string `D01` accepted, empty/two-element arrays, number and null rejected by the same production guard. The unchanged Route rejected malformed `deviceId` and accepted both valid shared and legacy responses. These controls refuted bypass/fallback/general-array acceptance; only the coercion hypothesis explains every observation.
4. Added the type check and reran the debugger matrix. String `D01` remained accepted; single-element array became rejected. All other controls retained their results. A new browser-storage test rejects the malformed response, leaves readiness false and prevents issuing a bill.
5. Focused Route/IDB/Income-numbering/offline-readiness tests: **75 passed**. Strict TypeScript unused-local/unused-parameter check: exit 0 with no diagnostics.
6. Full Local-target verification: exit 0, **1,261 passed / 2 existing skips**, lint/type/source-size/import/auth-outage/build/offline/service-worker/bundle checks passed. No new source changes followed this run.
7. Numbering memory, original Daily and hub saved atomically with exact readback/SHA-256 verification. Post-write Vault audit matched the pre-write audit; no new issues introduced.
8. A diff-check invocation overriding Git's normal CRLF conversion misclassified CRLF endings as whitespace. No files were changed by that diagnostic. Repeating `git diff --check` with repository settings passed (exit 0).

The scratch debugger and logs are under the task's `work/shared-device-rescan-*` artifacts; no diagnostic probes were inserted into product code.

## Other traced paths

- `issuer-installation.ts:7` → `numbering-idb.ts:45`: one installation root is written in the same IndexedDB transaction; losing previously used branch state rotates generation instead of restarting that code's counters.
- `numbering-idb.ts:98` → number reservation and outbox insertion in one transaction: commit/rollback stays atomic. Existing parallel/retry/old-response tests ran in the focused suite.
- Admin GET/PATCH → manager and mutation-origin guards → list/retire RPCs. Default-active and exact retirement acknowledgement tests passed in the focused suite.
- `20261101021000_branch_independent_bill_devices.sql`: registration and retirement serialize on the same installation/generation advisory lock; unique device codes and the locked global counter protect allocation.
- `20261101023000_remove_legacy_bill_issuer_registry.sql`: reference copy, both validator rewrites and legacy registration/head deletion occur in one transaction. Existing branch checks and client privilege boundaries remain. No SQL changes were required in this rescan.
- No additional unused function/import/variable was proven in the reviewed path. The shared validators and installation helper all have live callers; strict unused checks passed. This is not a repository-wide proof that every exported symbol is live.

## Verification status

Full verification passed. The offline manifest contains 161 assets; initial load 298.8/320 kB. This rescan does not apply migrations, delete more registrations, push or deploy.

Verdict: **ship at the agreed rollout step** — malformed code types are now rejected by the existing shared boundary without changing valid numbering behavior.
