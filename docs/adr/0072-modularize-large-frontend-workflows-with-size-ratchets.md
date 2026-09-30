---
status: accepted
date: 2026-09-30
---

# Modularize large frontend workflows with workflow boundaries and size ratchets

`src/components/TimeTrackingModule.tsx` grew to 2,011 physical lines and combined employee self-service, manager operations, payroll, audit history, attendance, settings, and payroll-period controls. The size made unrelated behavior easy to couple and forced source-contract tests to depend on function order inside one file.

## Decision

Use Time/Payroll as the pilot for incremental frontend modularization. Keep `src/components/TimeTrackingModule.tsx` as the public named entrypoint and reduce it to permission routing between employee and manager workspaces. Extract workflow owners in this dependency direction:

```text
TimeTrackingModule -> EmployeeWorkspace | ManagerWorkspace
ManagerWorkspace -> EmployeeWorkspace | PayrollModal | AuditLogsModal
EmployeeWorkspace -/-> ManagerWorkspace
PayrollModal -/-> ManagerWorkspace
AuditLogsModal -/-> ManagerWorkspace
```

Move behavior as-is before introducing new abstractions. A controller hook is allowed only when measurement shows that a workflow still exceeds the source-size limit or has independently testable request orchestration. Such hooks may own loading, mutations, and stale-request generation guards, but not rendered nodes, form state, modal state, or focus state.

Production TypeScript and TSX files have a hard limit of 500 physical lines. Existing files above the limit are grandfathered at their exact baseline and may not grow; a grandfathered file leaves the allowlist as soon as it is reduced below the limit. New files cannot be grandfathered. Files above 350 lines require a manual responsibility review, but 350 is not a CI failure threshold.

The existing `/` initial-load budget remains authoritative. A separate stable check identifies the inactive Time/Payroll dynamic chunk by module sentinels. The pre-refactor measurement was 120,810 raw bytes and 26,972 gzip bytes. The verified modularized payload is 125,754 raw bytes and 28,776 gzip bytes (+4,944 raw / +1,804 gzip); this exact result becomes the ratchet. The small boundary cost is accepted because the initial route is unchanged and adding nested lazy loading would change modal-loading behavior outside this behavior-preserving pilot. The initial route must continue to exclude Time/Payroll code.

## Compatibility constraints

- Preserve API payloads, permissions, Thai wording, modal ordering and focus restoration, financial semantics, Report Lock behavior, error semantics, refresh-on-focus, badge invalidation, and stale-response protection.
- Keep all three runtime entry paths: employee self-service, manager without a primary location, and manager business tab with assigned locations.
- Keep browser behavior tests, pure-function tests, and justified static absence checks. Replace source slicing by function order with assertions against the owning module or folder.
- Do not change API routes, database schema, migrations, Supabase Cloud, Vercel, or business data in this pilot.

## Acceptance evidence

Accepted on 2026-09-30 after the following checks passed:

- Every Time/Payroll production file is at or below 500 physical lines; the public `TimeTrackingModule` entrypoint is 18 lines.
- The source-size ratchet passes for new files and the 21 grandfathered files outside this pilot did not grow.
- The import-direction checker passes across 24 Time/Payroll modules with no cycles.
- Focused static and pure-function checks pass 25/25, focused browser checks pass 49/49, and the isolated repository suite passes 140/140.
- `npm run verify` passes lint, typecheck, source-size and import checks, auth-outage behavior, isolated tests, production build, service-worker checks, and bundle budgets.
- The initial `/` route still excludes Time/Payroll code. The modularized dynamic chunk is ratcheted at 125,754 raw bytes and 28,776 gzip bytes.
- No API route, database schema, migration, Supabase Cloud state, Vercel deployment, or business data changed.

## Post-acceptance scrutiny

The acceptance evidence above describes the behavior-preserving extraction itself. A subsequent
2026-09-30 scrutiny pass fixed independent defects exposed by broader route and database tests:

- the employee input dialog had been mounted twice after extraction;
- Time/Payroll action routes accepted malformed payload shapes and optional fields before RPC calls;
- the existing approval guard rejected the supported central/outside-system payment mode when
  `expense_location_id` was null.

The database correction is an append-only forward migration,
`20260930020000_allow_central_time_payroll_approvals.sql`; it keeps the approval-RPC requirement and
the adjustment expense-location constraint. The combined result passed 89 focused integration tests,
722 pgTAP assertions, the strict unused-code scan, and the full `npm run verify` gate. No Supabase Cloud
state, Vercel deployment, or production business data changed during this local scrutiny pass.

### Second scrutiny pass

A second 2026-09-30 call-graph and dead-code pass added route-level guards for non-finite JSON
numbers and invalid calendar dates/months before any Time/Payroll RPC runs. It also removed the
duplicate active-manager query from the admin summary, an unused employee-slip wrapper, and inactive
employee-row rendering that the route contract can never return. The employee debt form now requires
the effective date and rejects non-finite amounts before submission.

The new route regression passed with the complete 14-test hardening suite. The full Time/Payroll
integration group passed 89/89, the isolated suite passed 140/140, and pgTAP passed 722 assertions.
A stale generated `.next` cache initially produced inconsistent missing-page errors; rebuilding from a
clean generated cache confirmed every affected API route and the production build. No Cloud state,
deployment, or production data changed.

### Third scrutiny pass

A third 2026-09-30 end-to-end route review reproduced two high-volume failures that were not visible
in the smaller fixtures. The admin summary and payroll-slip list relied on Supabase's default 1,000-row
response limit, so active employees, pending transactions, and pending slips could be silently omitted.
Those reads now use the existing `readAllSupabaseRows` helper with deterministic ordering. Employee
detail already paged adjustment history, but loaded all referenced withdrawal-source IDs through one
`.in(...)` request; 1,051 sources produced `URI too long`. The route now reuses `chunkUniqueIds` and
merges the checked chunk results.

The same pass tightened the HTTP boundary to reject year zero (`0000`) in effective dates and payroll
months before an RPC can run. Regression teardown now deletes fixture IDs in checked 100-ID batches;
this fixed a test-only cleanup path whose oversized `.in(...)` calls had leaked local fixtures. The
targeted regressions passed 5/5 row-cap tests and 14/14 route-input tests, the full focused Time/Payroll
group passed 91/91, the isolated repository suite passed 140/140, and the full `npm run verify` gate
passed. A post-suite Local database check found zero matching fixtures. No additional removable
production dead code was found; legacy `UPDATE_WAGE` remains because its migration documents a
backward-compatibility contract. No schema, Supabase Cloud, deployment, or production-data change was
made in this pass.

### Fourth scrutiny pass

A fourth 2026-09-30 call-graph pass reproduced a pending-visibility defect in employee detail. The
route returned only the 50 newest debt/withdrawal rows, so an older pending item disappeared when 50
newer approved rows existed even though the manager summary still counted it. The route now keeps the
bounded recent-history window, reads every actionable pending transaction with the existing paged
helper, and merges pending rows first without duplicates.

The same pass removed two unused audit-filter inputs. `target_user_id` had no production caller and
incorrectly treated an audit `record_id` as a profile ID even though that field may identify a
transaction or slip; `action_filter` also had no caller. The remaining `admin_user_id` boundary is
validated directly. The live withdrawal-document route no longer queries retired `time_segments`; it
requires the current `EXCEPTIONS` attendance response and fails closed on any other mode. Historical
payroll-slip snapshots retain their legacy-segment compatibility in the shared document builder.

The focused regressions passed 6/6 row-cap tests, 14/14 route-input tests, 3/3 document-route tests,
and 16/16 exception-attendance tests. The complete Time/Payroll group passed 146/146, the isolated
repository suite passed 140/140, strict unused TypeScript and scoped ESLint passed, and the full
`npm run verify` gate passed. A post-suite Local database check found zero named fixtures. Account
suspension was investigated but deliberately left unchanged because the documented contract requires
it to block access immediately and independently of payroll state. Legacy `UPDATE_WAGE` also remains
for documented backward compatibility. No schema, Supabase Cloud, deployment, or production-data
change was made in this pass.

### Fifth scrutiny pass

A fifth 2026-09-30 end-to-end visibility review reproduced two role-boundary defects in rejected
Time/Payroll history. The user-detail route intentionally returned rejected debt and withdrawal rows
to payroll managers, but the employee-workspace transaction filter hid those rows for every role. The
filter is now role-aware: self-service still excludes rejected operational rows while managers retain
the administrative history. Conversely, the same route returned rejected payroll slips to employees
as well as managers. Response assembly now filters rejected slips from self-service while preserving
them for payroll managers.

The production action audit found no additional removable path. Dynamically selected withdrawal,
adjustment, transaction, and payroll actions all have callers; legacy `UPDATE_WAGE` remains for its
documented backward-compatibility contract. A document-route IDOR hypothesis was also falsified: the
route uses the request-scoped Supabase client, database RLS enforces self-or-payroll-manager access,
and the existing outside-requester regression returns 404.

The two new RED/GREEN regressions pass with the combined access and attendance UI group at 36/36.
The complete Time/Payroll group passes 148/148, the isolated repository suite passes 140/140, strict
unused TypeScript and scoped ESLint pass, and the full `npm run verify` gate passes including the
production build and bundle budgets. The rejected-slip fixture count is zero after the run. This pass
made no schema or migration change and did not write Supabase Cloud state, deploy, push, or modify
production business data.

### Sixth scrutiny pass

A sixth 2026-09-30 route-failure review reproduced an information leak in the Time/Payroll admin and
employee GET handlers. Unexpected database failures were returned to authenticated clients with the
raw PostgreSQL/Supabase diagnostic, including internal relation names. The admin mutation catch also
returned the unstable string `Unknown error` for non-`Error` database failures. These unexpected
catch paths now keep the original error in server logs while returning stable Thai 500 responses.
Known domain and authorization failures still leave through the existing `rpcFailure` mapping with
their 400, 403, or 409 semantics.

The production action and export audit found no additional removable code. All dynamic withdrawal,
adjustment, transaction, payroll, attendance, and period actions have callers; legacy `UPDATE_WAGE`
remains for its documented compatibility contract. A candidate double-submit issue was deliberately
not changed: a forced synthetic duplicate event could issue two debt requests, but a real browser
double-click issued one because the control became disabled, so the hypothesis did not survive the
disproof step.

Three route-response regressions now cover admin reads, employee reads, and admin mutations. The
focused route/access/document group passes 28/28, the complete Time/Payroll group passes 151/151, and
the isolated suite passes 140/140. Strict unused TypeScript, scoped ESLint, the 24-module import graph,
source-size ratchet, production build, service-worker checks, bundle budgets, and the full
`npm run verify` gate pass. No schema or migration changed, and this pass did not write Supabase Cloud
state, deploy, push, or modify production business data.

### Seventh scrutiny pass

A seventh 2026-09-30 audit-visibility review reproduced a retained-history gap in the manager
summary. The central Audit dialog can query one administrator at a time, but its actor list was derived
from active operational users and then limited to super admins or current system managers. Audit rows
created by branch payroll admins, and rows belonging to an inactive or revoked admin, therefore remained
in the database but could not be selected in the UI.

The summary now derives the Audit actor list from every retained `admin` or `super_admin` profile while
keeping the operational employee list active-only. The response field remains gated by
`canAccessSystemManager`, so branch managers do not gain central Audit access and inactive profiles do
not re-enter payroll operations. A route-level RED/GREEN regression covers that separation.

The focused route/access/UI group passes 40/40, and the complete Time/Payroll group passes 151 tests
with one intentional skip. Strict unused TypeScript, scoped ESLint, the 24-module import graph,
source-size ratchet, the isolated 140-test suite, production build, service-worker checks, bundle
budgets, and the full `npm run verify` gate pass. No additional removable production dead code was
found; legacy `UPDATE_WAGE` remains for its documented compatibility contract. This pass made no
schema or migration change and did not write Supabase Cloud state, deploy, push, or modify production
business data.
