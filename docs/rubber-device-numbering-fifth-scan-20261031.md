# Rubber numbering — fifth Business/Route scan, 2026-10-31

Intent: check issuer retry/lifecycle failures and the related numbering, sync, branch and Route call paths without changing numbering semantics.

## Simpler alternative

Reuse the current readiness timer, cancellation/visibility checks and issuer registration single-flight. A per-attempt flag restores the existing two-second retry when registration fails before the asset manifest is available. No new scheduler, effect, endpoint, queue or state store is needed.

## Finding: a first registration outage stops automatic recovery

- **Impact:** an online browser without a registered issuer cannot issue a numbered bill after a temporary registration failure until another visibility/storage event or a manual readiness check occurs. The network may already be healthy again.
- **Cause:** the fourth scan moved registration before asset preparation to preserve online use during asset outages. Its retry condition still required a loaded manifest or a changed service-worker generation. A rejected first registration therefore leaves both conditions false and schedules no retry. This was an omission in that ordering fix.
- **Trace:** `src/components/lanflow/OfflineReadinessStatus.tsx:35` → `prepareRubberBillIssuer` → durable root initialized → HTTP failure → readiness catch → finally with `manifest=undefined`, unchanged generation → no timer. The allocator continues to reject an unregistered root. The registration module itself can retry the same root correctly when called again.
- **Fix:** `src/components/lanflow/OfflineReadinessStatus.tsx:32` tracks whether registration is still awaiting success. The existing retry condition at `:63` includes that flag and uses its existing two-second delay. The flag clears after successful registration, so asset-only errors retain their previous behavior. Existing cancellation and hidden-tab guards still apply.
- **Regression:** `tests/offline-readiness.spec.ts:208` executes the production component effect and real allocator/IndexedDB with an initial HTTP failure followed by success. It drives the captured scheduled callback, confirms durable readiness, checks both registration bodies are identical and verifies timer cleanup.

## Debugger, hypotheses and disproof

A disposable V8 inspector breakpoint at the production retry condition observes `online=true`, `issuerChecked=false`, `manifest=false`, `cancelled=false`, equal generations and no timer before the fix. After the fix it sees `issuerRetryNeeded=true` and one scheduled delay of 2,000 ms. No production instrumentation was added.

Ranked hypotheses after reproducing and narrowing the failure path:

1. The retry condition depends on a manifest not yet loaded.
2. The registration single-flight remains stuck after rejection.
3. Profile/online checks prevent another registration.
4. IndexedDB failed to initialize or cannot retain the registration identity.

Disproof ran before the production fix: three existing controls passed — healthy online registration, lost first registration response retried with the same identity/code, and manifest timeout recovery triggered by visibility. They rule out a general single-flight, eligibility or storage failure for this input. The debugger and the failing timer assertion identify hypothesis 1.

## Experiment ledger

1. Deterministic pre-fix regression: no timer is scheduled after the first HTTP failure; the expected recovery callback is absent. **1 failed**.
2. V8 debugger confirms the false manifest/generation retry condition; delays `[]`.
3. Healthy registration/lost-response/manifest-timeout disproof controls: **3 passed** against unchanged production code.
4. Minimal local retry flag added. The same debugger now records delays `[2000]`.
5. Targeted numbering/readiness/sync/resume/background/issuer/queue Route suite: **199 passed**, exit 0. The new test confirms recovery without user interaction and preserves the same installation/generation request.

## Dead-code review

No new export/import or number allocation path was introduced. The reviewed registration, readiness, sync request/result, queue and issuer contracts have live callers; framework Route exports are entry points. No additional dead function/import/variable was proven, so none was removed.

## Final verification

- Complete isolated suite: **1,072 passed / 2 existing skipped**, exit 0.
- ESLint with zero warnings: passed. Strict TypeScript with unused locals/parameters and incremental cache disabled: passed, exit 0, no diagnostics.
- Source-size/import-direction and diff checks passed.
- The prior fourth-scan build/PWA/Route results are prior evidence, not a new run for this flag-only fix. No SQL/schema, stored counter, issued number, Route, Cloud mutation, commit/push or deployment change.
- Vault numbering note, Daily and hub were atomically saved with expected SHA-256 and exact read-back verification. The 99-note audit is unchanged (no new issues), and backlinks were verified. Daily remains 29/30 complete; conditional release 4.6 remains open.

Verdict: **ship at the separately agreed rollout step** — deterministic retry recovery and the complete isolated suite pass.
