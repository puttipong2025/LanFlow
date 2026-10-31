# Rubber approval settings layout and date-rule access

User-confirmed scope, 2026-10-31:

- Keep pending approvals and group/ungrouped price-and-time settings visible.
- Start global settings collapsed on each modal opening. A single `ตั้งค่าระบบ` button reveals the central price and a shared maximum-price/date-rule card. Collapsing preserves in-progress form values during that opening.
- Central-price and group management retain their existing access rules. Exact active `super_admin` alone can change maximum allowances, date rules, and the existing automatic-reset controls. System Managers can read these protected settings.
- All three global settings run vertically at every viewport width: central price, maximum allowance, then the date rule; maximum allowance and date rule share the same card. This follows the user's subsequent layout correction.
- Use full-width form fields and readable approval summaries on small screens. Pending commands, confirmation dialogs, revision checks, and group conflict handling retain their existing behavior.

The date rule remains global, including ungrouped branches, and uses the existing Bangkok-date approval behavior. This change restricts who can edit it. The API checks exact role and the security-definer RPC checks active identity and exact role independently; authenticated users have no direct table-write grant.

Sources: `RubberBillApprovalModal.tsx`, `RubberApprovalPolicyPanel.tsx`, `RubberApprovalSystemSettings.tsx` under `src/components/rubber-bills/`; `src/app/api/lanflow/rubber-bills/approval-settings/route.ts`; forward migration `20261031010000_restrict_rubber_bill_date_rule_to_super_admin.sql`.

Verification (Local):

- Full isolated suite: 943 passed, 2 existing skips; focused approval-route checks: 92 passed.
- Database suite: 71 files / 1,629 assertions passed, including 10 date-rule authorization assertions. Database lint returned no errors.
- Browser/API cases passed across focused runs: default collapse, keyboard expansion, draft retention, vertical layout at 375px and 1280px, actual date-rule persistence, manager read-only UI/API, offline entry guards, maximum validation/conflicts, auto-reset controls, and group revision conflicts. Existing refresh tests now use the documented focus trigger instead of expecting periodic settings polling; mocked auto-reset reads reflect their mocked writes.
- Production build, full lint, TypeScript, source-size/import guards, login auth-outage check, service-worker checks, and bundle budgets passed. Initial route first-load JavaScript remains 292.0 kB under the 320.0 kB budget.

Migration `20261031010000_restrict_rubber_bill_date_rule_to_super_admin.sql` is applied locally. The changed function is synchronized in `supabase-schema.sql`. No Cloud deployment is implied.

Follow-up scrutiny: `docs/rubber-approval-settings-scrutiny.md` records the reproduced route/client validation errors, null-error fallback and unsaved-date reset, their minimal fixes, and the later full verification (970 passed / 2 existing skips, browser 4, database permission assertions 10).

Second scrutiny: `docs/rubber-approval-settings-second-scrutiny.md` records the online-only settings boundary, offline draft retention and shared browser/server response validation. Latest checks: 1,006 isolated passed / 2 existing skips, browser/API 11 passed, full lint/strict unused/type/build/PWA/bundle guards passed.

Third scrutiny: `docs/rubber-approval-settings-third-scrutiny.md` records immediate duplicate-action protection, pending form locking and offline error recovery without a paused read. Latest checks: 1,019 isolated passed / 2 existing skips, browser/API 15 passed, full lint/strict unused/type/build/PWA/bundle guards passed.
