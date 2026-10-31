# Withdrawal adjustment third scrutiny — 2026-10-31

Scope: adjustment business logic and its employee/admin routes, traced through the report/cash guards and pending-request withdrawal. Existing unrelated Rubber work is preserved.

## Intent and smaller alternative

Preserve adjustment/report balances and authorization when callers wait or fail. Reuse existing error mappers and add the missing post-wait account check in the existing withdrawal RPC. No new endpoint, table, policy or lock layer is necessary.

## Findings reproduced before fixes

### Inactive employees can withdraw a waiting pending request

- Entry: employee POST WITHDRAW_WITHDRAWAL_ADJUSTMENT → public.withdraw_time_tracking_withdrawal_adjustment → initial active-account check → SELECT FOR UPDATE → owner/status guards → DELETE + audit.
- Failure: another connection holds the adjustment row, deactivates its owner and commits. The waiting owner passed the initial check and still deletes the request after the row is released. The security-definer function has no later active check; the pending-row delete triggers do not supply one.
- Proof: tests/time-payroll-adjustment-concurrency.spec.ts requires observing the waiter in pg_stat_activity with wait_event_type=Lock before checking the outcome. Before the fix, the RPC fulfilled and deleted the request although rejection was required. The original one-second attempt returned an early authentication rejection under parallel test startup and was not proof of a post-wait guard; the stronger barrier exposed that false positive.
- Fix: forward migration 20261031035000_withdrawal_adjustment_withdraw_account_fence.sql rechecks private.is_active_user immediately after the row lock/not-found check. Ownership and PENDING/cancellation guards remain intact; failure leaves the request PENDING and preserves the balance/audit transaction.

### Read routes misclassify authorization failures as server failures

- Entry: user/admin GET → requireAuth succeeds → parallel database reads/RPCs → an RPC returns Authentication required or Forbidden after the earlier auth snapshot → catch.
- Failure: user GET only maps 403, so an authentication failure becomes 500. Admin GET maps neither authentication nor authorization errors, so both become 500. This loses the actual reason and prevents the client from treating the response as an auth/access failure.
- Proof: execute the actual exported GET handlers, substituting only the auth/database boundary. Before fixes, user401, admin401 and admin403 tests returned500; user403 and generic-error500 controls already passed.
- Fix: both catch blocks pass only recognized401/403 results through their existing RPC error response; all unexpected failures still return redactedJSON500. The admin mapper now supplies the same Thai sign-in instruction as the employee mapper instead of a generic business-error message.

## Trace and falsification ledger

The database workflow does not provide a PostgreSQL step debugger. Inspected the live RPC definition and its actual triggers, then varied one timing/account/input axis at a time. The route tests execute production GET functions with the smallest boundary substitutions.

| Run | Result | Conclusion |
| --- | --- | --- |
| T1 | Strict noUnusedLocals/noUnusedParameters scan passes | No unused TypeScript symbol demonstrated; retained actual wrapper/lazy/error-mapper consumers |
| T2 | GET repro: three failures, three passing controls | Problem is catch/error semantics, not malformed input or every error becoming an auth response |
| T3 | Initial withdrawal probe returns an authentication rejection | Insufficient evidence: parallel startup can put the call after deactivation commits |
| T4 | Require observed row wait; RPC incorrectly fulfills | Confirms stale active-account check; rules out early rejection as protection |
| T5 | Migration350 + route fixes: 14 isolated route/error tests and 6 actual adjustment concurrency tests pass | Inactive waiter is rejected and pending request survives;401/403/500 controls correct; existing cross-branch/report/delete races retained |

Ranked hypotheses: (1) GET catch clauses discard late auth failures — confirmed by T2; (2) existing downstream pending-delete guards prevent inactive withdrawal — disproved by T4; (3) the first withdrawal result proves a safe post-wait check — disproved by observing the exact wait state; (4) all database errors should use the business-error mapper — rejected by generic500 controls. No broad error-status remapping or additional permission was introduced.

## Verification

- Strict unused scan passes with no diagnostics; no unused function, import or variable proved in the traced scope, so none removed.
- Full application gate passes: 1,089 isolated tests / 2 existing live OCR skips; lint/type/source-size/import/auth-outage/build/SW/bundle checks pass. Time/Payroll remains119.4kB raw/27.8kB gzip within its existing budget.
- Full database gate passes: 73 SQL files / 1,715 assertions and21 actual concurrency tests. Adjustment concurrency includes6 tests, including the observed-row-wait regression.
- Real adjustment API/RPC integration passes4 tests including setup: explicit-null settlement, latest-ID deletion, Dashboard history and closed-slip floor remain correct.
- Local ledger records350. Fresh public/private schema dump matches the repository snapshot after whitespace normalization. Fixed-ID fixture locations and temporary scheduling function/trigger are absent after tests.

Broad logs: output/adjustment-third-verify.log, output/adjustment-third-db.log, output/adjustment-third-api.log, output/adjustment-third-unused.log.
 Focused logs: output/adjustment-third-read-repro.log, output/adjustment-third-withdraw-repro-confirmed.log, output/adjustment-third-route-fixed.log and output/adjustment-third-db-focused.log. Local schema snapshot matches a fresh public/private dump after whitespace normalization. No Cloud migration, commit, push or deployment.


Verdict: fixes verified for local review; no remaining actionable finding in the traced adjustment scope. No Cloud release.
