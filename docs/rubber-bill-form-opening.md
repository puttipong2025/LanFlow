# Rubber Bill form opening

## Verified regression — 2026-10-27

The production Add Rubber Bill button waited for `refreshPolicyBeforeOpeningBill()` before showing the form. Commit `b6f48a6` introduced this wait on 2026-10-14 to refresh policy after automatic price-allowance resets.

Two observations on the same authenticated production branch:

| Run | Click to visible form, upper bound including browser control | Approval-settings request to response |
| --- | --- | --- |
| First open | 1,514 ms | 1,144 ms |
| Reopen | 2,363 ms | 1,998 ms |

The repeated request rules out an explanation limited to initial form-code loading. Stock requests started after the first policy response; they were not the pre-open blocker in these observations. These measurements establish a blocking client dependency, not the internal cause of API latency. No bill was submitted during production diagnosis.

## Confirmed behavior

- After the existing branch-create guard succeeds, Add Rubber Bill opens without awaiting the latest approval policy. Customer, weight, and price inputs remain editable.
- Loading or failed policy refresh blocks both the submit button and form submission, including Enter. A failed refresh offers an explicit retry and preserves input.
- Successful refresh updates the current price reference and existing approval decision. A price above the latest cap still requires approval; the entered price is not silently replaced.
- Closing invalidates the pending gate result. Reopening starts a new gate; old completions cannot release a newer gate. A different user/branch scope cannot reuse another scope's ready state.
- Offline creation retains its existing cached-policy behavior. Edit and OCR review retain their blocking policy refresh before opening. Server policy, approval rules, and database schema remain unchanged.

## Verification

- `tests/rubber-bill-policy-loading-ui.spec.ts`: real local browser, holds the policy response while asserting the form is visible and editable; covers blocked submission, persistent failure, explicit retry, retained input, a lowered price cap, and close/reopen during a pending refresh. No bill is submitted.
- `tests/rubber-approval-policy-refresh-contract.spec.ts`: preserves the branch-create guard and edit/OCR refresh contracts.
- Focused policy, cache, and validation tests: 15 passed. Browser regression tests: 2 passed.
- Initial browser runs exposed an unrelated startup alert and test assumptions about automatic retries and five-decimal input formatting; the harness now handles those existing behaviors.
- Initial build ran concurrently with a dev server and failed while collecting page data. Verification was repeated sequentially after stopping that exact dev server.
- Final sequential production build, TypeScript, ESLint, and source-size/diff checks passed.

Implementation: `src/hooks/useRubberBillPolicyGate.ts`, `src/components/rubber-bills/RubberBillsModule.tsx`, `RubberBillModal.tsx`, and `RubberBillSaveActions.tsx`.

Status: local implementation; production timing improvement requires deployment and a new production measurement. No new ADR is needed for this reversible change to when an existing check runs.

## Scrutiny — client policy response boundary

The read-only trace covered Add → branch guard → policy query → form submit → mutation/queue → `/api/lanflow/rubber-bills`, together with GET/PUT approval-settings and their RPC error handling. The simplest correction was to reuse the existing offline-cache validation at the live query boundary rather than add a second validation model or change routes.

The real client query was exercised through `loadSourceModule`, replacing its React registration and HTTP boundaries only. A valid current-branch response passed as a control; four HTTP 200 cases incorrectly resolved as successful data: empty object, another branch's policy, inconsistent price cap, and HTML converted to an empty object by JSON-error recovery. All four failed their new rejection assertions before the fix.

`isRubberBillApprovalSettings` now provides the shared live/cache predicate for branch identity, rule source, numeric policy fields, date-rule boolean, and central-plus-allowance consistency. The query rejects unvalidated data before React Query or local storage can treat it as a successful policy refresh. Cache timestamp checks remain at the cache boundary. The unsafe response type assertion and duplicated inline validation were removed; strict unused-local/parameter checks found no unused runtime code to delete.

After the fix: 95 focused policy/cache/validation/management-route tests passed, followed by 31 sync-response tests. Three local browser tests passed, including malformed-200 blocking, valid retry, delayed refresh, retained input, latest-cap approval, programmatic submission blocking with otherwise valid input, and close/reopen. No new in-scope server-route defect was found in the traced/tested cases. These tests do not establish that every route in the repository is defect-free.

Final post-scrutiny production build, strict TypeScript unused checks, changed-file ESLint, source-size, Service Worker, bundle budget, and diff checks passed. Local changes remain uncommitted and undeployed.
