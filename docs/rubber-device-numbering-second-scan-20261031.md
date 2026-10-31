# Rubber numbering — second Business/Route scan, 2026-10-31

Intent: recheck the current numbering business/HTTP-to-client paths after the first scan, preserving frozen bases, finals, counters and uncertain-submission protection. Scope is this feature and its directly called modules, not all business modules in the repository.

## Simpler alternative

Keep the existing allocator root validator, direct failure recorder and permanent-error protocol. Reuse their recovery and retry behavior; no new numbering version, state store, queue, RPC or migration is needed. Remove code only when its references prove it unused.

## Findings and experiment ledger

### 1. A wrong-branch local issuer prevents recovery

- Red regression changes only the stored issuer's location; readiness correctly reports false, but normal preparation then reuses the otherwise-valid root and its cached registration. The next numbered enqueue fails rather than recovering under a fresh code. The outbox is unchanged.
- Ranked hypotheses: root validation omits branch ownership; registration cache ignores an invalid root; issuer response is malformed; counter/date state is invalid. The V8 debugger stops in actual `validState` with root key A and issuer location B, and observes only one registration call. A healthy lost-response retry and old-layout sequence continuation pass before the fix, disproving a general registration/counter failure.
- Fix: `src/lib/rubber-bills/numbering-idb.ts:18` now requires the issuer's branch to match the root key. The existing invalid-root recovery creates a fresh registration without rewriting queued proposals.

### 2. Direct numbering rejection releases the uncertain-submission lock

- Route failure → `sendRubberBillCommand` → `recordRubberSyncFailure` → local feed/action locks. A deterministic direct-path test records a known, command-bound `NUMBERING_REJECTED` response after submission started. The event becomes failed, but the generic failure recorder clears `serverSubmissionAttempted`; correction is then exposed despite an earlier result possibly being unknown.
- Ranked hypotheses: the failure recorder clears all failed events; a different command is being reconciled; the route's permanent rejection is malformed; IndexedDB overwrites the flag. The V8 debugger sees attempted=true, matching failure code and retryable=false immediately before the generic clearing line. Healthy ordinary business rejection still allows correction, and central-path rejection already preserves its lock; those controls disprove a blanket ban on corrections or an IDB defect.
- Three more red cases return the same error code for another command/client/operation. The old direct recorder treats each as a permanent failure, whereas the central path correctly requires identity binding. The direct recorder now requires the same command/client/operation binding, keeps unrelated replies pending, and retains the uncertainty flag for a bound numbering rejection. Other existing business-error correction behavior stays intact.
- Fix is contained in `src/lib/rubber-bills/sync-failure.ts:7` (identity binding), `:26` (permanent classification) and `:36` (uncertainty retention). Existing callers in `src/hooks/useRubberBills.ts:122` / `:294` and `src/hooks/usePerRecordSyncRetry.ts:122` use that recorder; local-feed correction eligibility at `src/lib/rubber-bills/local-feed.ts:95` now stays closed for an uncertain numbering rejection. No endpoint or server-number allocation changes.

## Verification

- Red evidence: one foreign-branch recovery test, one bound-direct lock test, and three mismatched direct rejection tests failed before fixes. Three healthy controls passed before fixes. V8 debugger confirmed the missing branch-root comparison and the exact flag-clearing path.
- Targeted isolated after fixes: **147 passed**, including old/new layouts, cached receipts, issuer recovery, lost registration response retry, direct/central failures and ordinary business correction controls.
- Disposable debugger after fixes: the foreign-branch root was replaced and prepared again (registration calls 1 → 2); readiness became true under the correct branch, and the bound direct rejection retained `serverSubmissionAttempted=true`. No production debug probes were added.
- Strict unused locals/parameters check passed before and after changes. No additional unused function, import or variable was proven in this round; framework Route exports remain entry points.
- Numbering SQL regression: **42 passed**. No SQL, schema or database mutation policy changed in this round; prior full database evidence (1,671 assertions / 15 concurrency passes) is retained as prior evidence, not claimed as rerun.
- Full verify: **1,067 passed / 2 existing skipped**; lint/type/source-size/import/auth-outage/build/offline assets/service-worker/bundle gates passed. Verification was explicitly invoked with the local env so the same verified production artifact can be tested without a second build. First load remains **294.7 / 320 kB**.
- Production browser/PWA/route run: **113 passed** using that verified local-target artifact, including setup, 107 route/middleware boundary checks and five authenticated Admin/offline/PDF/lock journeys. The direct uncertainty-lock regression is covered by actual IndexedDB unit tests and the production recorder; ordinary business correction controls still pass.
- Repros, debugger receipts and control logs remain in the chat work directory. No production instrumentation, SQL/schema change, Cloud writes, commit/push or deploy in this round. Vault atomic writes, SHA-256 and exact rereads verified the numbering/queue notes, Daily and canonical hub; audit remains 99 notes with no new issues, backlinks verified. Daily plan remains 29/30 with only conditional release 4.6 open.

Verdict: **ship at the separately agreed rollout step** — both reproduced gaps are fixed and local verification is complete.
