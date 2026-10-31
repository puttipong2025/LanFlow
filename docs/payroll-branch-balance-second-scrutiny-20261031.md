# Payroll branch balance — second scrutiny 2026-10-31

## Intent and minimal approach

Verify the latest payroll/withdrawal balance changes through the actual dashboard history route, pagination and failure paths. Retain the existing branch-portion helper and full-cost separation: no new ledger, RPC, migration or refresh mechanism is needed in this pass. Reusing the existing `isIsoTimestamp` validator is smaller and more consistent than extending local date parsing.

## Findings fixed

- **History transport failures escape the route (P2).** `src/app/api/lanflow/dashboard/feed/route.ts` awaits `get_dashboard_money_history` without catching rejection. A deterministic mocked RPC rejection escaped GET instead of returning JSON. Added the same narrow catch used by the overview/snapshot routes: generic JSON500/no-store, no private diagnostic content.
- **Invalid date/timestamp filters reach PostgreSQL (P2).** The feed treated `date=` as absent for validation but sent the empty string to the RPC. Its local parser accepted calendar year 0000, while PostgreSQL rejects it. Feed and overview cursor parsing used `Date.parse`, which accepts strings such as `0` and normalizes invalid February dates. Both now use `src/lib/validation/primitives.ts:isIsoTimestamp`; feed validates every present date parameter. Invalid values return 400 before RPC.

## Dead-code/duplication cleanup

Removed the feed's redundant `isValidDate` function and `ISO_DATE` constant after migrating callers to the shared validator. They were used before replacement, so this is duplicate validation removal, not a claim that the original functions were unreachable. All remaining changed imports/helpers have callers; targeted ESLint reports no unused declarations.

## Trace and falsification ledger

No interactive application debug session was available; deterministic source-module route tests and direct PostgreSQL casts provide the failing signals and boundaries.

| Run | Observation | Conclusion |
| --- | --- | --- |
| 1 | Traced snapshot/overview fixes to real `useDashboardMoneyHistory` → feed GET → history RPC | Previous catches did not cover the actual history route |
| 2 | History RPC throw test fails; numbered-page/filter test passes | Ranked hypotheses: missing rejection handler, malformed filters, downstream SQL/pagination; valid input and mocked boundary disprove filters/SQL as causes of this rejection |
| 3 | Added catch; returned retention error stays 400, returned unknown error stays generic500, numbered and cursor paths pass | Handler changes transport failure behavior without changing business-error semantics |
| 4 | Added empty/year-zero date filters: test fails with status200 and RPC invocation | Validation gap reproduced independently of SQL or permissions |
| 5 | Direct PostgreSQL casts of empty date and 0000-01-01 both fail | Database rejects values that prior route validation forwarded; mock success alone was insufficient evidence |
| 6 | Added malformed cursor timestamps `0`, year0000, February30: overview and feed both fail expected400 checks | `Date.parse` acceptance/normalization, not base64 decoding or missing RPC data, causes the gap |
| 7 | Reused shared strict validator; targeted route/payment/history tests 56 PASS | Valid cursor and numbered requests are preserved; invalid date/cursor inputs stop before RPC |

## Other reviewed seams

- Numbered SQL history offsets already cast `p_page` to bigint before multiplication; no overflow fix needed (`20261020013000_money_history_numbered_pages.sql`).
- Canonical summary, compatibility balance correction, legacy/outside-system and operating-cost predicates are unchanged in this pass. No new monetary defect found. Prior full DB verification remains 74 files / 1,831 assertions; not rerun because this pass has no SQL change.
- New count sessions still call canonical live summary; thresholds and branch statuses read its snapshot. No new mutation/permission surface introduced.

## Verification

56 focused tests PASS (dashboard summary/history routes, payment allocation, payroll route failures, operator history); TypeScript, targeted ESLint, source-size/import-direction and diff whitespace checks PASS. Existing named RPC parameters were retained as public contracts. Local only; no database/schema change, Cloud apply, commit, push or deployment.

Verdict: fixes verified in the reviewed flow; no further blocker found in this pass.
