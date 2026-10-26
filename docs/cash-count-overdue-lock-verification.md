# Cash-count overdue lock — local implementation and verification

## Scope and simpler alternative

Use two optional hour settings and an off-by-default switch on existing count groups. Store the temporary grant on membership, not a second lock-state or approval-request table. Reuse the financial branch fence, shared alert dialog and existing offline queues. Browser approval identity rules remain unchanged. The initial implementation was local-only; the user subsequently authorized main push and Cloud migrations on2026-10-26.

## Verified trace

- Group mutation: manager auth → omitted-field-aware API → group advisory lock → all affected branch fences → old validation/membership update → settings update/explicit-disable grant reset.
- Financial mutation: existing OLD/NEW and parent/child branch discovery → sorted branch fences → existing active-count guard → overdue time/grant check. Existing direct RPC and sync callers cannot bypass the database guard.
- Unlock: active manager + existing branch access → branch fence → recompute status using server time → one membership grant, or return the existing grant without extending it. Submit holds the same fence and clears the grant in the session-submitted trigger.
- Count start remains subject to the pre-existing local-queue and database pending-work checks. Overdue does not add another count-start block. Pending work has an explicit temporary-unlock → resolve/sync → count escape path; it is never discarded or skipped to force a baseline.
- Group removal/deletion uses existing membership lifetime to remove grants. Explicit disabling clears grants. Legacy three-argument calls forward null settings and retain existing values.
- Read status is separate from acknowledged dialog state. Initial/scope/focus/visibility/online/mutation reads and one-shot server-time transitions refresh status; there is no new recurring lock poll. Cross-tab invalidation uses a non-sensitive storage event. Reads are scoped and old requests are aborted/ignored.
- Shared dialog/branch notice show unlock or eligible contact names. A temporary grant shows remaining time and no extension button. Queue handling recognizes only the dedicated `CASH_COUNT_OVERDUE_LOCKED` 409 as transient, keeping the original command until a confirmed receipt.

## Experiment ledger

| Run | Experiment and result | Conclusion |
|---|---|---|
| R1 | New DB fixture tried to create a second Super Admin; unique-role constraint rejected fixture before assertions | Reuse the existing Super Admin within rollback-only test; not a feature failure |
| R2 | New pgTAP suite:29/30 passed; recreated legacy RPC still had default PUBLIC execute | Three ranked causes: recreated default grant, inherited role grant, or stale catalog. Private helper denial and new function grant inspection narrowed it to recreated wrapper default |
| R3 | Applied forward grant migration;30/30 assertions passed | Authenticated-only compatibility contract restored; body permission checks remain intact |
| R4 | Real concurrent connections: existing branch/count/review test and new unlock/submit/disable race both passed | No extension or restoration of stale grants in the tested interleavings |
| R5 | Route/logic regression18 passed | Role denial, malformed scope, safe outage, omitted settings, and dedicated business response preserved |
| R6 | Dedicated logic/queue suite7 passed using real sync functions with remote/IDB boundaries replaced | Both queues retain the exact command on lock and remove it once on success after unlock; unrelated409 remains permanent |
| R7 | Authenticated browser suite14 passed | Shared dialog acknowledge does not remove branch lock; contact-only count entry available; no extension button during grant; group hours required; existing camera/history/delete flows preserved |
| R8 | Full DB suite58 files/1359 assertions and both concurrency tests passed; later focused DB suite32 assertions passed | Added proof that a grant permits an actual financial write and grace changes shift the lock boundary immediately |
| R9 | Login outage check twice timed out with zero upstream requests; logs showed the dev port bound before server-ready and cold page compilation | Ranked causes: server boot included in page timer, slow compile, or real auth wait. Zero upstream requests disproved auth wait. No leftover workspace Next process was found; no service/cache/database reset performed |
| R10 | Wait for Next's ready signal before starting the unchanged30-second page timer; login rendered in21966ms with zero Supabase requests | Corrected test readiness without weakening the page/auth assertions; full verify must be rerun |
| R11 | Grant-expiry browser test passed, but standalone Admin cold load exceeded30s before the disable-form assertions | Give this standalone browser scenario60s to load the Admin chunk; business timing assertions remain unchanged |
| R12 | Form repro reached POST with lockEnabled=false and hidden graceHours=0; assertion failed | Source trace: hidden input unmounted but its state was still serialized. Ranked causes were stale hidden draft, native validation, or API mutation; actual outgoing payload isolated hidden draft. Send hours only when enabling, preserving server-side values when off |
| R13 | Final feature browser suite6 passed, including grant expiry and hidden-invalid-hours regression; earlier camera/history regression suite14 passed | Count entry, shared status and explicit disable remain usable;390px screenshot inspected with no horizontal overflow |
| R14 | A proposed concurrency fixture tried changing an immutable income-expense location and was correctly rejected by the old guard | Keep that invariant; changed the fixture to a transaction writing two branches under the existing sorted fences while group settings change. Both concurrency tests then passed |
| R15 | Full DB suite58 files/1361 assertions, both final concurrency tests, and authenticated/anonymous route audit100 cases passed | Local schema and route boundaries verified; no Cloud claim |
| R16 | Full verify passed lint/type/import/readiness gates; one new manual-retry test hit Playwright's async throw-matcher error while608 other cases passed | Assert the exact rejection message explicitly, retaining state/queue/payload assertions. Dedicated suite8 passed, including manual lock retry and ordinary conflict controls; full verify rerun required |
| R17 | Final `npm run verify` completed with609 isolated tests passed,2 live opt-in OCR skipped, production build/SW/bundle guards passed | Login-outage rendered in23182ms with zero Supabase requests; initial first load267.9kB remains under320kB |
| R18 | Extra reconciliation suite initially39 passed/7 failed because auth mocks omitted canSyncCurrentSession, already present in HEAD before this feature | Source trace and HEAD comparison disproved a new production sync regression. Pin the authorized-session I/O boundary in that harness while keeping all queue/receipt assertions; all46 reconciliation cases then passed |

Source trace was used for the VM harness and database exceptions because no debugger was attached to those runtimes. Reproductions are runnable tests, not hypothetical findings. No debug probes remain in production code.

## Artifacts and checks

- Migrations: `20261026020000_cash_count_overdue_lock.sql`, `20261026021000_cash_count_lock_rpc_grants.sql`, applied locally only.
- `supabase-schema.sql` was regenerated from local public/private schemas.
- Database: `supabase/tests/cash_count_overdue_lock_test.sql`.
- Concurrency: `tests/cash-counts/cash-count-overdue-concurrency.spec.ts`, registered only in the database gate.
- Logic/routes/queue: `tests/cash-counts/cash-count-overdue-logic.spec.ts`.
- Browser: `tests/cash-counts/cash-count-overdue-ui.spec.ts` plus camera/refresh regressions.
- Full DB58 files/1361 assertions and concurrency2 passed; auth-route audit100 passed; dedicated feature UI6 and earlier browser regression14 passed.
- `npm run verify` passed with609 isolated tests/2 opt-in skips, lint/typecheck/source/import rules, login-outage, production build, SW and bundle guards. Extra reconciliation suite46 passed with the session-boundary fixture aligned to the current production contract.
- Mobile390px screenshot inspected in `output/overdue-ui-final/`; no horizontal overflow. These are local automated/fake-camera checks, not physical-device or production acceptance.

## Rollout and recovery preparation

1. Keep new group switches off during initial rollout. Read/API changes, grants and the matching application must be deployed together only on explicit instruction.
2. Before Cloud changes, retain schema/data recovery backups outside tracked source and verify the linked target and pending migrations. Preserve Auth and browser-approval state.
3. Smoke-test disabled groups/legacy edits, manager self-unlock, pending-work resolution, counting while overdue, shared notices and re-lock after expiry before enabling a group.
4. If the feature needs to be suspended, turn off group locking using the authorized API so grants clear; this does not disable the existing active-count movement fence. Use a forward fix or matched recovery point rather than editing applied migrations.

## Current status

### Follow-up scrutiny — 2026-10-26

- Scope: group/status/unlock routes, membership and financial-write guard, lock refresh and sync retry callers. Existing shared database guards remain the smallest enforcement layer; no parallel lock workflow was added. No unused production function/import was confirmed in this pass.
- Reproduction: a mocked RPC `XX000` error through the real group POST/DELETE handlers returned400 and exposed the raw diagnostic. The new route regression failed before the fix (expected503, actual400).
- Trace/hypotheses: the response serializer returned `error.message` directly; auth rejection and JSON-validation paths already returned safe messages. No debugger was attached to the source VM. Compared transport errors, explicit permission exceptions and known business exceptions rather than treating every RPC error as an outage.
- Fix: one local group error mapper shared by GET/POST/DELETE. Unknown diagnostics become private503; denied RPC permission becomes403; known missing/conflicting groups remain actionable404/409 and invalid settings400. No database rule or queue behavior changed.
- Disproof/regression: six RPC error variants across all three methods exercise unknown SQL errors, unknown `P0001`, revoked permission, missing group, branch conflict and constraint violation. Known public messages remain visible; private diagnostics are hidden. The cash-count logic/route suites passed22 tests. Repository diff check also exposed trailing blank lines in the generated schema; trimmed without changing SQL.

### Deployment preflight — 2026-10-26

- User explicitly authorized `push main` and `supabase db push` after the local gate. The latest rescan passed610 isolated tests (2 live-OCR skips),1361 database assertions,2 concurrency scenarios and lint.
- Cloud guard inspection revealed CRLF body text, whereas the existing patch matches LF. Added prerequisite `20261026015000_normalize_cash_count_guard_line_endings.sql` without modifying previously applied migrations. It replaces CRLF pairs only and preserves the existing function permissions/logic. Replaying the actual Cloud function body followed by the prerequisite and patch in a local rollback transaction returned `crlf_guard_patch_passed=true`; the32 overdue database assertions still pass.
- Initial simultaneous CLI initialization produced temporary login-role authentication failures; the subsequent serial migration listing/dry-run succeeded and shows exactly the three intended migrations. Future CLI initialization should be serialized.
- A first Cloud rollback rehearsal waited behind the data-backup snapshot and hit statement timeout; it did not apply the migrations. Complete the backup before repeating DDL rehearsal/deployment.

Scrutinize verdict: ship locally. Traced membership/settings → write guard → unlock → queue retry → count submit/reset and alert acknowledgement/scope/expiry. No unresolved blocker remains in the verified local paths. Reused guards/queues/dialogs instead of introducing another approval workflow, persistent lock boolean or recurring polling loop. No debug probes or newly orphaned production imports remain.

Implementation and required checks are complete locally. The unrelated user-edited image remains untouched and excluded from this commit.

### Cloud migration receipt — 2026-10-26

- Linked target: `psxwhhwjmolqperxrlzj`. Pre-change public/private schema and public-data backups completed under ignored `output/`; backup data is not tracked in Git.
- After backup completion, the three-migration Cloud transaction rehearsal returned `guard_patched=true` and rolled back successfully. The earlier timeout was not repeated.
- `supabase db push --linked --yes` applied20261026015000,20261026020000 and20261026021000 successfully. Postflight catalog checks confirm all three history rows, both movement guards, index, reset trigger, all three settings columns, authenticated RPC access and anonymous/private RPC denials. Enabled groups=0.
- A follow-up linked dry-run reports `Remote database is up to date`. CLI emitted a nonfatal pg-delta catalog-cache certificate warning after migration application; independent catalog/history verification passed, so no repair/reset was performed.
- Main push follows this database receipt. Application hosting rollout and physical-device acceptance are separate from the verified database migration and Git push.
