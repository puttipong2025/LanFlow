# Rubber settings scrutiny — 2026-10-31

Scope: the current approval-settings UI, its hooks, settings/group routes, shared validators, and the date-rule RPC boundary. Existing global-price/maximum/group semantics and exact-super-admin date-rule access remain the contract.

Simpler-alternative pass: retain existing components, mutation paths, validators, and error helpers. Tighten the existing boundaries; a new settings service or a new state framework is unnecessary.

## Debug ledger

1. Strict TypeScript unused-local/parameter scan passed. Traced the changed component exports and hook methods to their real callers; `refreshSettings` is used by the bill-opening policy gate, so it is not dead code.
2. Deterministic isolated repro before fixes: 22 failures / 2 positive controls passed. Thrown auth/RPC failures escape the route, date-rule save accepts malformed RPC acknowledgements, the client accepts malformed HTTP-200 saves, and an unrelated policy refresh overwrites an edited checkbox. Valid save payload and a real date-rule change remain positive controls.
3. Debugger probe attaches a Node inspector session with pause-on-exceptions to the actual transpiled settings route. Follow-up trace: request -> auth/RPC -> no exception boundary; PUT -> pre-read -> unchecked save acknowledgement -> post-read; client -> unchecked mutation response -> query cache; form -> effect depending on the entire policy object -> checkbox reset.
4. Ranked hypotheses and disproofs: (a) missing boundary catches vs invalid requests — test thrown failures independently of body validation and retain 400/403 controls; (b) missing save-response validation vs overly strict validation — valid-current-branch control succeeds; (c) object-level synchronization vs actual rule change — unrelated-price update loses the draft while a clean form correctly follows a date-rule change. Database state, timers and networking are absent from these isolated form/client repros, ruling them out as necessary causes.

5. After boundary fixes, the focused suite passed 116/116 in 5.8 seconds, including all 24 new repro/control cases and the existing route/refresh/action-guard cases. Failures now yield opaque JSON 503 with no-store; malformed save acknowledgements stop before the second read; malformed client responses cannot reach query-cache success handling; unrelated price refreshes retain the edited date rule.
6. Follow-up null-error-body differential: two failing tests with HTTP 503/null versus one passing explicit HTTP 403/message control. Trace reaches `data.errorMessage` before the fallback, causing a TypeError. Guarding the message's type preserves actionable server errors and friendly fallback messages for load/save failures.
7. Actual-browser verification passed 4/4: vertical layout and draft retention on 375px/1280px, unsaved global date checkbox surviving a real ungrouped-defaults save/refetch, and manager read-only UI/API. Date-rule database permission regression passed 10/10 assertions. The review adds no database migration.

## Fixes

- Catch unexpected rejections in all 11 handlers under approval-settings and approval-groups, including dynamic group routes. Existing validation and business-error statuses stay intact.
- Require the date-rule RPC acknowledgement to equal the submitted Boolean before post-save reads.
- Validate current-branch policy shape and the submitted date value in the client mutation before query-cache updates.
- Synchronize the date checkbox only when the authoritative date Boolean changes, rather than whenever the whole price/time policy object changes.
- Preserve public load/save errors when a failed HTTP response contains JSON null instead of an error object.

## Verification and verdict

- `npm run verify`: 970 isolated tests passed / 2 existing skips; full lint, TypeScript, source-size/import guards, auth-outage login check, production build, service-worker checks and bundle budgets passed.
- Browser: 4 passed, including the real save/refetch draft regression.
- Database date-rule access regression: 10 assertions passed; no additional migration was needed for the review fixes.
- Strict `tsc --noEmit --noUnusedLocals --noUnusedParameters` passed. No unused import, variable, or private function was found in the reviewed code, so none was deleted.
- Route/client/form sources: `src/app/api/lanflow/rubber-bills/approval-settings/route.ts` (acknowledgement and exception guards), the adjacent settings/group routes (exception guards), `src/hooks/useRubberBillApprovals.ts` (validated save and error messages), and `src/components/rubber-bills/RubberBillApprovalModal.tsx` (date-only synchronization).

Verdict: fix-then-ship, now passing Local verification. The previously unchecked success/error boundaries were the largest risk. No commit, push, Cloud migration, or deployment was performed during this review.
