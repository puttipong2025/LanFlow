# ADR-0006: Approved Withdrawals and Payroll Slips Become Source-Linked Branch Expenses

- Status: Accepted (implementation in progress; verification incomplete)
- Date: 2026-07-20
- Owners: LanFlow team
- Decision scope: Time Tracking approval, branch expense assignment, Income/Expense feed, Relation Locks

## Context

Time Tracking currently approves pending financial transactions, leave requests, and payroll slips through `src/app/api/lanflow/time-tracking/admin/route.ts`. Approval changes the source status but does not assign the cash outflow to a LanFlow branch or expose it in the Income/Expense feed.

The product decision is that two approval events represent an immediate branch cash expense:

- approving a `financial_transactions` row whose type is `WITHDRAWAL`
- approving a `payroll_slips` row

Approving `DEBT` or `LEAVE` is not a branch expense. A withdrawal is already paid before payroll, so the payroll expense must use `net_pay`; using `gross_pay` would count the withdrawal twice.

The existing Income/Expense feed already derives locked rows from source-owned records such as money transfers, rubber bills, and OCR tickets. Copying Time Tracking approval rows into `income_expense` would introduce a second mutable financial record and require synchronization between copies.

## Decision

### 1. Source ownership

Keep each approved source as the only financial source of truth:

- withdrawal expense source: `financial_transactions`
- payroll expense source: `payroll_slips`

Do not insert a duplicate row into `income_expense`. Extend `get_income_expense_feed(...)` to return one derived expense row per qualifying approved source.

Each source stores the selected expense location and server approval time. The forward migration must use explicit names such as:

```text
expense_location_id -> locations.id
approved_at timestamptz
approved_by -> profiles.id
```

The migration must also add the soft-cancel/audit fields required to stop hard-deleting approved sources. Exact column names may follow the final schema convention, but source identity, selected branch, approval timestamp, and cancellation state must remain queryable.

### 2. Approval scope and amount

| Approval source | Creates branch expense | Amount |
| --- | --- | ---: |
| `financial_transactions.type = 'WITHDRAWAL'` | Yes | `amount` |
| `payroll_slips` with `net_pay > 0` | Yes | `net_pay` |
| `payroll_slips` with `net_pay <= 0` | No feed row; approval remains valid and is audited | `0` |
| `financial_transactions.type = 'DEBT'` | No | — |
| `leave_requests` | No | — |

Withdrawal and payroll expenses are separate rows. They must not be aggregated by day.

### 3. Branch selection

Pressing Approve for a withdrawal or payroll slip opens a confirmation modal before the decision is submitted.

- Show only active branches assigned to the approver through `user_locations`.
- Apply the same branch filter to every role that already has approval permission, including `admin`, `super_admin`, and a delegated system manager. This decision does not grant approval permission to ordinary `user` accounts.
- If exactly one branch is available, preselect it but still require confirmation.
- If no eligible branch is available, block approval with a clear Thai message.
- Reject does not request a branch.

The client list is only UX. The server/RPC must re-check that the authenticated approver can access the submitted `expense_location_id` and that the location is active.

### 4. Atomic online-only decision

Approval and branch assignment are online-only and occur in one database transaction through a security-definer RPC called by the authenticated Next.js route.

The RPC must:

1. lock the pending source row;
2. re-check role and target-user approval rules;
3. re-check active `user_locations` access to the chosen branch;
4. allow only the valid transition from pending to approved;
5. set `approved_by`, `approved_at`, and `expense_location_id` together;
6. write the audit event in the same transaction;
7. return an idempotent success for an already-completed equivalent decision or a conflict for a different decision/branch.

This prevents double-clicks or concurrent approvers from creating inconsistent assignment. The existing API must not perform a sequence of unrelated table updates for this decision.

### 5. Cash-basis date and display

The derived expense `txDate` is the server approval date in `Asia/Bangkok`, not the request creation date or the payroll month.

Recommended display values:

```text
WITHDRAWAL title: เบิกเงิน — {employee name}: {description}
PAYROLL title:    เงินเดือน — {employee name} — {slip month}
type:             expense
billOption:       ค่าใช้จ่าย
```

The feed row includes a stable relation source type and source ID. Suggested source types are `time_tracking_withdrawal` and `payroll_slip`.

### 6. Relation Lock and correction path

Derived Time Tracking expenses are read-only in Income/Expense. They cannot be edited, deleted, or enqueued from the destination module. The UI explains the lock in Thai and offers a route to the source when the viewer has source permission.

If the selected branch is wrong, an authorized actor uses `เปลี่ยนสาขาค่าใช้จ่าย` at the source. The actor must manage both the old and new branches. The server changes the assignment atomically and records an audit event; the amount does not require reapproval.

If an approved source is cancelled, the source is soft-cancelled and the derived expense disappears from the active feed in the same transaction. Audit history remains. Approved source records must not be hard-deleted.

### 7. Feed authorization

`get_income_expense_feed(...)` remains the read boundary. It returns a derived withdrawal/payroll expense only when:

- the source is approved and not cancelled;
- `expense_location_id = p_location_id`;
- the amount rule above is satisfied;
- the cash-basis approval date is inside the requested range.

The existing `can_access_location(p_location_id)` guard remains mandatory. No cross-branch write permission is granted to the Income/Expense module.

## Consequences

### Positive

- Each expense has one source of truth and cannot drift from Time Tracking.
- Withdrawal plus payroll `net_pay` represents actual cash paid without double-counting the withdrawal.
- Branch assignment is explicit and authorized at the point of approval.
- Cancellation and branch correction automatically change the feed without copying or replaying rows.

### Constraints

- Time Tracking approval must move from direct API table updates to an atomic RPC.
- Existing hard-delete paths for approved withdrawals and payroll slips must become soft-cancel paths.
- The Income/Expense type and UI must recognize the two new relation source types and route users back to Time Tracking.
- Approval remains unavailable offline.

## Alternatives Considered

### Insert a new `income_expense` row during approval

Rejected. It duplicates the source transaction and requires synchronization, uniqueness, rollback, and cancellation logic between two mutable records.

### Record payroll `gross_pay`

Rejected. Approved withdrawals already create branch expenses, so gross payroll would count those cash payments twice.

### Use request date or payroll month as the expense date

Rejected. The accepted accounting behavior is cash basis: the expense belongs to the server approval date in `Asia/Bangkok`.

### Let `super_admin` choose any branch automatically

Rejected. Every approver, including `super_admin`, may select only branches assigned through `user_locations`.

## Implementation evidence — 2026-07-20

- Database contract: `supabase/migrations/20260720010000_time_tracking_branch_expense_relation.sql` adds source relation fields, approval/correction/cancel RPCs, audit writes, and source-write guards. `20260720030000_fix_time_tracking_approval_status_cast.sql` is the forward fix for an enum/text comparison in the first RPC migration.
- Feed: `supabase/migrations/20260720020000_time_tracking_branch_expense_feed.sql` emits the two source-linked expense rows using `approved_at` in `Asia/Bangkok`, stable source IDs, and Relation Lock metadata. `20260720040000_fix_time_tracking_withdrawal_feed_title.sql` preserves migration history while aligning the withdrawal title separator with this ADR.
- App boundary and UI: `src/app/api/lanflow/time-tracking/admin/route.ts`, `src/components/TimeTrackingModule.tsx`, and `src/components/time-tracking/ExpenseLocationApprovalModal.tsx` submit the selected branch through the RPC and keep correction/cancellation at the source.
- Test coverage started in `tests/time-tracking-branch-expense.spec.ts` for approve → derived feed → soft cancel. The local Playwright global auth setup currently loses its dev server before finishing fixture creation, so this dedicated scenario is not yet accepted as passing evidence.
- Verified locally: `npx.cmd tsc --noEmit` and `npm run build` pass. `npx.cmd supabase db reset --local` replayed the migrations. `npx.cmd supabase db lint --local` has no Time Tracking finding; it still reports the pre-existing `sync_rubber_bill_core_20260716020000` temporary-table error.

## Verification Required Before Marking Implemented

- API/RPC tests for approval role rules and active branch assignment.
- DB tests for pending-to-approved transition, row lock, retry/idempotency, and competing approvals.
- Feed tests for withdrawal amount, payroll `net_pay`, `net_pay <= 0`, cash-basis date, and one-row-per-source identity.
- Relation-lock tests for edit/delete blocking in Income/Expense.
- Branch correction tests requiring access to both branches.
- Soft-cancel tests proving the active derived row disappears while audit history remains.
- UI tests for zero, one, and multiple managed branches and for offline blocking.
- `npx.cmd tsc --noEmit`, `npm run build`, and `npx.cmd supabase db reset`.

## Evidence

- `src/components/TimeTrackingModule.tsx`
- `src/app/api/lanflow/time-tracking/admin/route.ts`
- `src/app/api/lanflow/route.ts`
- `src/lib/server/auth.ts`
- `supabase/migrations/20260626000000_time_tracking.sql`
- `supabase/migrations/20260629073000_payroll_slips.sql`
- `supabase/migrations/20260714010000_income_expense_feed.sql`
- `docs/time-tracking-approval-expense-glossary.md`
