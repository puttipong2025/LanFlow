# Rubber numbering — fourth Business/Route scan, 2026-10-31

Intent: verify online issuance remains usable when optional PWA preparation fails, and check the related business/Route call graph for unused code or new failure paths.

## Simpler alternative

Keep the existing readiness scheduler and registration single-flight/cache. Move registration before PWA prerequisites; do not add a save-time network request, new effect, queue, store or numbering version.

## Finding: PWA preparation failure blocks first online bill registration

- **Consequence:** on an unregistered browser, a manifest request failure or unavailable Cache API/service worker prevents obtaining an issuer. The online bill save still reaches the durable allocator, which requires a registered issuer and rejects the bill. An optional offline asset dependency therefore prevents online business use.
- **Trace:** `src/components/lanflow/OfflineReadinessStatus.tsx` previously checked Cache API/service worker and awaited `readOfflineManifest` before calling `prepareRubberBillIssuer`. This is the sole production registration call site. `src/hooks/useRubberBills.ts:266` calls `enqueueNumberedRubberCreate`, whose unregistered guard at `src/lib/rubber-bills/numbering-idb.ts:95` aborts before reserving or adding a command.
- **Reliable repro:** `tests/offline-readiness.spec.ts:172` runs the actual component effect and actual allocator/IndexedDB state, replacing only React rendering, browser asset APIs and HTTP registration. A throwing manifest leaves `rubberNumberingReady=false`. Healthy assets produce a durable registered issuer. Missing service worker and Cache API reproduce the same blockage.
- **Debugger:** a disposable Node V8 inspector breakpoint at the production component catch sees `online=true`, `issuerChecked=false`, `error="manifest unavailable"`, registration count 0 before the fix. After the fix it sees `issuerChecked=true`, count 1, with the same asset failure and offline readiness still false. No production debug probes were added.
- **Minimal fix:** `src/components/lanflow/OfflineReadinessStatus.tsx:33` registers eligible online users before asset prerequisites, then checks cancellation/generation before continuing asset work. Existing role/online checks, cached registration, transaction allocator and readiness errors remain in use.

## Hypotheses and disproof

Ranked after the failure was reproduced and the debugger narrowed its path:

1. The asset prerequisite prevents registration from being reached.
2. IndexedDB is unavailable in the affected browser/test.
3. The current profile is ineligible for registration.
4. The registration response or endpoint is invalid.

The healthy-assets control ran **before the production fix** using the same profile, HTTP response and actual IndexedDB allocator. It passed, disproving 2–4 for the reproduced input. Flipping only the asset prerequisite failed all three asset-error cases, consistent with 1.

## Experiment ledger

1. Initial test harness omitted the VM's `window.indexedDB`; its storage error was a harness defect, not product evidence. The isolated VM was corrected before using its results.
2. Corrected manifest repro failed with `ready=false` where registration was expected. Debugger confirmed registration had not run.
3. Healthy-assets disproof control passed against unchanged production code.
4. Expanded pre-fix regression: **1 passed / 3 failed** (manifest outage, missing worker, missing Cache API).
5. Moved the existing registration block before asset work. The same debugger now observes one registration and the same manifest error.
6. Focused regression covering readiness, immediate PDF, background deletion, numbering, recovery, queue, issuer Routes, receipt IDB, sync response and immediate mutation cache: **262 passed**, exit 0.

## Dead-code review

Cross-referenced exported functions/constants in `src/lib/rubber-bills` with callers in source and tests. Single-file hits such as `fairRubberQueueRound`, `matchesRubberQueueEvent`, `completeRubberCommand` and feed-cache helpers have live calls inside their defining modules; they are not dead code. No additional unused function/import/variable was proven, so none was deleted.

## Final verification

- Full verify: **1,071 passed / 2 existing skipped**; lint, types, source-size/import-direction, auth-outage, production build, offline manifest (159 assets), service-worker and bundle checks passed. The build was explicitly invoked with the local env. First load remains **294.7 / 320 kB**.
- Strict unused locals/parameters check: passed, exit 0, no diagnostics. The export-reference review above also found no proven dead code.
- Production browser/PWA/Route run: **113 passed** against that same verified build, covering setup, 107 route/middleware boundaries and five authenticated Admin/offline/PDF/lock journeys. The newly reproduced asset-error cases are covered by the isolated component/real-IndexedDB regressions; the browser run verifies the normal integrated journeys.
- `git diff --check` passed. No Route, SQL/schema, allocation counter or issued-number change. Database suites were not rerun for this component-only fix. No Cloud mutation, commit/push or deployment.
- Vault numbering note, Daily and hub were atomically saved with expected SHA-256 and exact read-back verification. The 99-note audit is identical before/after (no new issues), and backlinks were verified. Daily remains 29/30 complete; the conditional release step 4.6 remains open.

Verdict: **ship at the separately agreed rollout step** — the reproduced registration dependency is fixed and local verification passes.
