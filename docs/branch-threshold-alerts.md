# Branch threshold alerts

## Contract

- Weight remains stored in `rubber_weight_alert_groups` and its memberships. Cash uses `cash_alert_groups` / `cash_alert_group_locations`; no weight data is migrated.
- Each branch has at most one group per kind. Groups cannot be empty. Existing inactive members are retained on edits; new inactive members cannot be added. RPC mutations use a transaction advisory lock per kind plus unique membership constraints.
- Cash thresholds are numeric values from 10,000 to 1,000,000 baht inclusive with at most two decimal places. Both API and database reject fractional cents instead of silently rounding.
- Cash checks `summary.netCashFlow < threshold_amount`; weight checks `summary.rubberRemaining.netWeight > threshold_kg`. Equality never alerts. Both use the existing Dashboard snapshot; Telegram settings and delivery behavior remain independent.
- `get_branch_threshold_alert_check()` reads both kinds in one statement. Scope includes active, configured, accessible branches only. Missing snapshots, non-ready status and missing/non-numeric metrics are reported in `unavailable`, never substituted with zero.
- `configuredCount` and `checkedCount` count branch-kind pairs. `checkedCount + unavailable.length = configuredCount`. `candidates` contains qualifying pairs only. Zero configured pairs means unconfigured, not all branches normal.

## API and authorization

- `GET /api/lanflow/threshold-alert` returns `{ config, candidates, unavailable, configuredCount, checkedCount }` with private/no-store headers.
- Candidate: `{ kind, locationId, locationName, groupId, groupOrder, value, threshold, calculatedAt }`.
- Unavailable: `{ kind, locationId, locationName, reason }`; reason is `missing_snapshot`, `not_ready`, or `missing_metric`.
- Admin reads assigned active branches; system manager and Super Admin read all active branches. User, inactive and anonymous accounts cannot read alerts. Database guards enforce this independently of the UI.
- `GET/POST /api/lanflow/cash-alert/groups`, `PUT/DELETE /api/lanflow/cash-alert/groups/[id]` are system-manager-only. Write body: `{ locationIds, thresholdAmount }`.
- Existing weight group endpoints keep `{ locationIds, thresholdKg }`; both sets delegate to `thresholdAlertGroupRoutes` and common validation. Existing weight-check RPC/API remains available for old clients.

## Browser behavior

- One hook/timer owns both kinds. Existing `rubberWeightAlertConfig` bootstrap/cache shape, interval column and `lanflow:rubber-weight-alert:last-checked:v1:<userId>` key are retained.
- Automatic attempts record their start time before fetching; acknowledgement does not change the timer. A manual request does not write automatic timestamps. Concurrent manual/automatic reads share in-flight work; an automatic due time is still recorded when it arrives.
- One retry for transient failures; no retry for cancellation/401/403. Cleanup aborts requests and ignores responses after account, access scope, connection or interval changes. A config interval update reschedules but does not clear a result already shown.
- Manual loading uses a guarded native button with `aria-disabled` to retain trigger focus. Offline uses native disabled. Errors appear beside the button; automatic errors additionally use the existing toast.
- Each page renders one bordered section per group, the threshold once in its header, and tinted branch rows with amounts/weights, matching the original weight dialog. Groups retain their order; within a group cash is lowest first and weight highest first.
- A single persistent native AlertDialog handles Escape, top layer and focus restoration. Cash is first when both kinds qualify; a single kind has no page buttons. Acknowledgement closes both kinds together. Each opening resets page selection.
- Manual empty/unconfigured/unavailable outcomes are shown. Automatic checks open only for qualifying candidates. Unavailable branches are identified without claiming the entire scope is normal.

## Verification and rollout

- Regression suites: `supabase/tests/branch_threshold_alert_test.sql`, `supabase/tests/rubber_weight_alert_test.sql`, `tests/branch-threshold-alert.spec.ts`, existing weight group/UI suites, and isolated threshold parser tests.
- UI covers bounded cash configuration through real API/RPC, equality, assigned branch scope, cash-first pages, focus return, mobile/landscape, offline, no-storage fallback and timer collisions.
- Deploy forward migrations `20261018010000_cash_threshold_alerts.sql` and `20261018011000_threshold_alert_value_order.sql` before the new web build. This document does not authorize a Cloud deployment.
- Rollback: restore the previous web build while retaining the additive cash tables/RPC and their data. Old weight endpoints/config remain usable. Do not drop cash tables to roll back the app.
- No ADR is required for this additive extension: existing storage is preserved, there is no costly schema consolidation or new background worker.

## Scan follow-up — 2026-10-18

- Group input canonicalizes valid UUIDs to lowercase before duplicate comparison and RPC forwarding, so the same branch cannot bypass duplicate validation by letter casing.
- Group handlers, interval settings and both check routes convert unexpected RPC rejections into a generic private/no-store JSON 500 response; no upstream diagnostic is returned.
- The shared hook resets loading when interval changes cancel a pending request, without clearing an already displayed alert or moving the automatic timestamp.
- Regression evidence: 17 targeted state/transport tests and 16 browser/API tests passed; TypeScript noUnusedLocals/noUnusedParameters, lint and source-size passed. No database schema changes were needed for these fixes.

## Shared branch cash status (2026-10-18)

- Branch selector cash status uses the cash alert group threshold. Ungrouped branches show unconfigured; Telegram thresholds remain separate. Group mutations invalidate branch summaries.
- Cash thresholds accept 10,000–1,000,000 baht inclusive, at most two decimals; equality is normal. The forward migration `20261018012000_cash_group_branch_status.sql` clamps older out-of-range values to the nearest limit.
- The manual check button follows Telegram in header action order.
- Migration explicitly flushes the deferred group-row membership trigger before the threshold update, then restores deferred mode after replacing the check constraint. Replaying against negative/over-limit/valid-cent fixtures passes six assertions in a rolled-back local transaction.
- Verified: browser suite 7 including setup, targeted isolated 18, full DB 1,203 followed by updated cash SQL 32 assertions (including maximum and independent Telegram control). This follow-up migration is applied locally; Cloud and main still have the earlier release.

## Branch-summary route scan follow-up

- Fixed unhandled RPC rejection in `GET /api/lanflow/dashboard/branch-summaries`. Returned RPC errors and malformed payloads now also use the same generic JSON500 with private/no-store; auth and success payload remain unchanged.
- Repro before fix: three new failure-mode tests failed while success/validation controls passed. After fix: targeted route/state/order suite 21 tests passed.

## Cash status Cloud rollout — 2026-10-18

- Applied `20261018012000_cash_group_branch_status.sql` to linked Cloud after schema/public-data backups in ignored `output/production-backups/cash-status-20261018/`. Post-push dry-run is up to date and local/remote history matches.
- Backup SHA256: schema `069732E3B301FE6CEEC6A1554BE8E43EDD0E5F0E1B84F4901652C2DDBD331B4A`; data `8B2D2134F3AD7B46D91216CE145405D8CBFEC507EDF59268E9C741DAD880A3C1`.
- CLI emitted SET CONSTRAINTS outside transaction warnings (statements run individually) and the known pg-delta CA-cache warning after apply; migration history and dry-run independently confirm application.
- Release verify passed 542 isolated tests, lint/typecheck, production build/SW/bundle; targeted DB suite 73 assertions passed. Earlier Local-only statements above are historical.
