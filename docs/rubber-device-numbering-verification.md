# Rubber device numbering — implementation and verification ledger

2026-10-31. Local implementation. No commit/push, Cloud schema change or hosted deployment is implied.

## Confirmed format amendment — sequence first

The user confirmed moving the existing sequence ahead of the date without resetting it:
`0015-261031-D03`, then `0015-261031-D03-1` when centrally created. An installation that issued
`2610310015-D03` next allocates `0016-261031-D03`; old issued bases, reservations and outbox commands remain frozen.
The metadata, daily counters, registration and IndexedDB version stay unchanged. Forward migration
`20261031023000_rubber_sequence_first_base.sql` validates both layouts against the same metadata,
retaining the existing immutable-number and suffix transaction guards. Only the new-base formatter changes.
Earlier receipts below describe the original layout; amendment verification is recorded separately at the end.

## Scope and implementation

- Device base allocated once in an IndexedDB v9 transaction with the reservation and outbox. Existing stores and owner scopes survive upgrades. Registry uses independent full installation/generation UUIDs; browser/account switches share only the numbering scope.
- Numbered core creates store a base and a server suffix final. Private registry, suffix counters and identity bindings retain issued identities. Legacy local uniqueness is partial; new-format finals have branch-scoped uniqueness. Approval allocates only when business creation actually succeeds.
- Numbered RPC names fence old backends. Frozen commands are not rewritten with a final suffix or current issuer. Numbered results must match the original base plus a positive suffix.
- Admin reuses effective manager capability and ModalShell alertdialog. List/status/branch/search/paging, exact retirement acknowledgement, nonrecycled codes and replacement registration are implemented.

## Experiments and debug breadcrumbs

1. Initial typecheck exposed a generic result losing the computed bill's required weigh-items shape, plus a callback narrowing issue. Keeping the original bill type generic and capturing the validated issuer before the callback fixed both. Source-size initially exceeded 500 by two lines; new logic stayed in the numbering helper, and the mutation remains within the existing limit.
2. Targeted test harness initially failed two `rejects.toThrow` assertions on promises from a separate VM context. Hypotheses: cross-realm matcher boundary; production promise hanging; wrong error text. Awaiting the same production promise directly returned the expected error, ruling out the latter two without changing production behavior. The targeted run subsequently passed 45 cases.
3. Real concurrent business creates produced six distinct finals. The first run failed only during fixture cleanup: deleting bills and the fixture location in one transaction fired a deferred dashboard event after its location was gone. Reading the six committed finals disproved a numbering race. Committing bill cleanup before location cleanup fixed the test fixture. The concurrent public-call test then passed, including two exact simultaneous retries and one business effect per identity.
4. First full verify: 1,018 passed, 2 existing skips, 2 failures, 14 not run because existing upgrade tests hardcoded IndexedDB version 8. Updated only expected current version/names to 9, preserving upgrade/data-retention assertions. Targeted compatibility/issuer/numbering run: 56 passed. Full verify must be repeated after latest source.
5. After resume, two deterministic regressions proved that numbering rejection was returned as 503 and left the event pending. A disproof test with an unbound command error passed before the fix, establishing that generic 400s must not fail arbitrary work. Structured rejection now binds command/client/operation, keeps payload and uncertain-submission locks intact, displays failed work and stops automatic retries. Manual retry may explicitly resubmit. All three rejection regressions pass.
6. A table regression and the production PWA both proved that a new pending base appeared twice. The shared table still rendered its legacy second reference. Restricted only that second line to legacy rows; the targeted regression then passed. New PDFs now also state `รอเลขท้ายจากส่วนกลาง` until a final exists, and cached same-revision receipts remove the notice when confirmed. Already-confirmed edits retain their known final.
7. Two existing production browser checks still searched for an old disabled-button label. The accessibility failure snapshots showed the actions present and disabled under the current pending-sync reason; `git show HEAD:src/components/rubber-bills/RubberBillsTable.tsx` confirmed that this label contract predates this task. Corrected only the selectors to assert the actual existing lock reason, retaining held-network, local feedback, money-row and share-count assertions. Fixture cleanup now removes the numbering records it creates.
8. A new real keyboard check reproduced Escape leaving the issuer confirmation open. `ModalShell` defaults `closeOnEscape` to false; opted this new form into its existing Escape behavior, preserving the pending close guard. No shared modal behavior changed. Removed the now-unneeded legacy TEMP-number preparation from the Rubber form: a new proposal starts without a number and receives the actual base only from the durable allocator.
9. The first complete PWA journey tried to reload offline before waiting for its service worker and assets. The existing PWA lock/reload control already waited for the controller and passed. The numbering journey now waits for the controller and the real 100% offline-readiness status before disconnecting. The PDF network-hold test also encountered a POST while its page-level context route was held after service-worker activation; its two controlled-network cases now block service workers so page routes own those requests. The independent numbering and lock/reload cases retain the real production service worker. Confirmation results are recorded below.

## Verification receipts

- Local migrations: `20261031020000_rubber_device_bill_numbers.sql`, `20261031021000_rubber_issuer_management_guards.sql`, `20261031022000_rubber_numbered_transport_fence.sql` applied.
- Full `npm run test:db`: **1,657 assertions / 72 SQL files**, followed by **15 passing concurrency tests**. Follow-up targeted pgTAP: **32 passed**, adding a real duplicate-base search and forced failure after bill INSERT that leaves neither binding nor suffix consumption. No migration changed after the full DB run.
- Final `npm run verify`: **1,043 passed / 2 existing skipped**; lint, typecheck, source-size, Time/Payroll import direction, auth-outage containment, production build, offline assets, service-worker and bundle gates passed. Initial first load **294.6 / 320 kB**, route **109.4 kB**. Strict unused locals/parameters typecheck passed separately.
- Authenticated development browser: **3 passed** including setup; real Admin registration/retirement at 1280/375 and offline save → final → exact replay, one business row and one download.
- Allocator edge evidence includes independent daily/branch counters, multi-account saves, out-of-order registration responses, root/counter loss, replacement, atomic outbox abort, unchanged old queues, positive final validation and missing numbered-RPC refusal without legacy fallback.
- Real registration concurrency follow-up: four same-installation requests return the original issuer; four independent installation/generation requests receive distinct D02–D05 codes. The expanded public business concurrency case passed again, including six independent same-base finals and two exact retries.
- Generated `supabase-schema.sql` from Local `public,private` scopes after migrations. Export whitespace normalized on three newly moved blank lines and EOF; migrations remain authoritative. Existing business-cache definitions moved into their normal dump positions without a semantic change.

## End-to-end scrutiny

Intent: allow offline local acceptance with one base allocation, then give every committed new bill a unique final within its branch. Reusing the existing outbox, core, approval, scheduler, authorization and modal/table primitives is smaller than adding a second queue or renumbering business records. Only the registry, durable allocator and suffix/binding state require new storage.

- New manual/OCR: `RubberBillModal.tsx` requests numbering without preparing a legacy TEMP reference → `useRubberBills.ts:266` → `numbering-idb.ts:77` commits counter/reservation/outbox before returning the numbered receipt. Neither IDB transaction nor PDF path waits for registration/network. Context staging and OCR ownership remain in the existing command path.
- Actual create/approval: migration `20261031020000` patches only the new-metadata branch of the existing core to call `private.allocate_rubber_bill_suffix`; the legacy date allocator remains in `elsif`. Price approval remains pending without a binding, then its actual create gets the suffix. Tests exercise both actual core and the public numbered RPC, not only the private helper.
- Replay/update/delete: immutable metadata/base guard plus retained bindings and branch final uniqueness prevent renumbering or recycling. Existing branch/command serialization is retained. Real concurrent same-base creates and exact retries, and forced insert rollback, verify transaction boundaries.
- Reads: explicit pending projection includes metadata; actual rows retain it. Feed search includes local/final numbers and preserves UUID work identities. Actual duplicate-base search returns both rows. Receipt cache changes only numbering presentation on matching business revision; business totals remain frozen.
- Admin: manager capability is checked by parent/UI, API and RPC. Registration independently checks active bill-writer role and branch access. Retire preserves actor/time/history and can be repeated; reconnect gets a new code without touching queued proposals. Runtime result validation contains malformed acknowledgements.
- Recovery: IDB9 upgrade preserves the existing stores. Missing/inconsistent root requires fresh UUIDs/code; later old registration responses cannot downgrade a replacement. A missing numbered backend retains work rather than creating through the legacy allocator. Numbering-specific rejection is command-bound and stops automatic retry while preserving the uncertain-submission lock.

No unresolved implementation blocker was found in the final traced paths. Local release candidate; hosted rollout remains conditional on release scope. Physical phone share sheets/printers were not certified; browser download and the controlled native API boundary are covered separately.

## Compatibility and rollout contract

Apply additive database migrations before the new client. New browser requires the numbered RPC/registry capabilities; missing backend RPCs cannot fall back to a legacy create. IndexedDB 9 preserves legacy commands and fences older versions after an upgrade. Legacy ingress remains supported for already-offline older clients; operational rollout must refresh old tabs for new work. Do not reinterpret a client timestamp as proof that a command predates activation.

Rollback retains numbered RPCs, number metadata/bindings/counters and an opener capable of reading IndexedDB 9. Never clear queues, recycle codes or suffixes, downgrade the local database, or renumber old bills. Historical bills and branch-to-branch Rubber receipts retain their old numbering. A complete rollback to a pre-numbering backend is intentionally unsupported once new bases have been issued; the client retains work until compatible service returns.

## Final handoff receipts

- Final `npm run test:routes`: **107 passed**, including the new issuer registration and Admin management endpoints, anonymous/invalid-session containment and middleware routing.
- Final production build/PWA run: **6 passed**, including authentication setup, real Admin desktop/mobile and Escape/focus return, a real service-worker offline reload with the numbered outbox, final assignment/exact replay, real PDFs/download and controlled native-share boundary without duplicate handoff, and retained known cash locks across offline reload.
- The two held-network PDF timing cases intentionally block service workers so page-level network gates remain authoritative. The separate numbering/reload and cash-lock/reload cases use the real production service worker. Their successful rerun confirms the interception/readiness hypotheses without changing business command timing.
- Controlled local feedback measured delete **139 ms**, edit **206 ms** (one sample each), both below the existing one-second regression gate. These samples are not a broad performance benchmark.
- Source diff whitespace check passed. Source changes do not include a commit, push, Cloud migration or hosted deployment. Track the release-only conditional task 4.6 separately in `codingDO/10_Daily/2026-10-31 1.md`.
- Vault write-back verified with atomic writes, SHA-256 receipts and exact rereads: the target Daily checklist is **29/30** complete with only conditional release 4.6 open; the new numbering contract, existing Printing/Queue notes and canonical hub are synchronized. Obsidian backlinks confirmed the hub/Printing/Queue relationships. Project audit scanned **99 notes**, with **no new issues** compared with its pre-change baseline.

## Sequence-first amendment — verification complete

- Targeted isolated: **81 passed**, including old-layout sequence 15 → new-layout sequence 16 with the same issuer and all 15 previous outbox commands unchanged. Receipt/cache/edit checks cover both layouts. Five-digit sequences remain untruncated.
- Final `npm run verify`: **1,045 passed / 2 existing skipped**, plus lint/type/source-size/import/auth-outage/build/offline/SW/bundle passed. Initial first load remains **294.6 / 320 kB**.
- Full `npm run test:db`: **1,668 assertions / 72 files**, then **15 concurrency tests passed**. The numbering SQL file has **39 assertions**, retaining old-layout acceptance/immutability and adding new-layout create, duplicate-base suffixes, exact replay, search and invalid/reformatted-number rejection. Public business concurrency now uses the new layout.
- Production PWA: **3 passed**, including setup, unchanged Admin desktop/mobile/keyboard behavior and new-layout offline save → real service-worker reload → final → exact replay with one business row and one download.
- Schema snapshot refreshed from Local public/private; the amendment changes only the numbering validator. Existing API/auth/financial handlers are unchanged; the prior 107-route gate is retained as prior evidence, not claimed as rerun for this amendment.
- Scrutiny: the formatter is called only when no reservation exists. Existing reservations, feed/export/dashboard reads and receipt paths use the frozen string; the validator accepts both metadata-consistent layouts and preserves the existing-row identity guard. No counter reset, re-registration, payload normalization or data rewrite was added. The server still appends only a suffix. Local verified; no commit/push/Cloud apply/deploy.

## Business/Route scrutiny follow-up — 2026-10-31

See [the scan and experiment ledger](rubber-device-numbering-scan-20261031.md). Removed the unused receipt `numberingVersion` marker and reproduced/fixed damaged reservation/issuer recovery, permanent numbering errors across queue/direct transports, uppercase retirement acknowledgement, empty branch filters and page bounds. Forward migration `20261031024000_rubber_numbering_validation_guards.sql` is applied Local only; existing base/final/counter and actor/business contracts remain unchanged.

Final evidence: **1,062 isolated passed / 2 existing skips**, full verify/build/SW/bundle passed; strict unused check passed; **1,671 SQL assertions / 72 files**, **15 concurrency tests passed**, and **113 production browser/PWA/route checks passed**. An existing worker/report race test now verifies eventual bounded ticks rather than assuming a locked branch drains immediately. Local-target integration was rebuilt explicitly rather than reusing the production-env build. No Cloud release is claimed.

## Second Business/Route scrutiny — 2026-10-31

[Second scan ledger](rubber-device-numbering-second-scan-20261031.md): fixed wrong-branch issuer-root recovery and direct numbering-rejection identity/uncertain-submission retention. Reused existing validation/recovery and failure handling; no SQL/schema, numbering format, counter or business-policy change. No further dead code was established.

Current verification: **1,067 isolated passed / 2 existing skips**, full verify/build/SW/bundle and strict unused passed; numbering SQL **42 passed**; production browser/PWA/routes **113 passed** from the same verified artifact built with explicit local env. Prior full database/concurrency evidence is unchanged and was not rerun for these TypeScript-only changes. No commit/push/Cloud/deploy.
