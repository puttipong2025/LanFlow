# ADR-0028: Delegate Time and Payroll Management by Primary Branch

- Status: Accepted
- Date: 2026-08-01
- Owners: LanFlow team
- Decision scope: Time Tracking, payroll, user locations, Admin permissions, derived expenses
- Supersedes: the global-only manager scope in ADR-0027 and the branch-choice restriction in ADR-0006
- Partially superseded by: ADR-0049 for the Account capability subsection; ADR-0051 for User module access and no-primary-branch self-service

## Context

Time and payroll data is stored per employee rather than per branch. An employee may be assigned to several branches, so using any shared branch as the authorization boundary would let several branch managers read and mutate the same complete payroll history.

The product also needs a trusted `user` or `admin` to use the existing manager workflow without receiving system-manager rights in other modules. Approvers must additionally be able to record a withdrawal or positive payroll payment as paid centrally outside LanFlow, with no derived Income/Expense row.

## Decision

### Account capability

> Superseded by ADR-0049. The primary-branch, approval-payment, and account-suspension decisions below remain in force.

Add one independent, default-off Time/Payroll manager capability for `user` and `admin`. `super_admin` and system managers retain automatic global access. Only `super_admin` and system managers may grant or revoke the standalone capability.

A delegated manager receives the existing Time/Payroll actions, including self-approval and central outside-system payment. The capability does not change the account role, Money Transfer access, or any other module.

### Primary-branch authorization

Reuse `user_locations.is_primary` as the employee's single payroll ownership branch. Do not add a second payroll-branch field.

A delegated manager may manage only active `user` or `admin` targets whose primary branch is an active branch assigned to the manager. A delegated manager cannot manage `super_admin` or a system manager. Global managers keep their existing target scope.

If an account has no branch, delegated manager scope for that account is empty while self-service and global-manager access remain. Changing the primary branch transfers manager visibility over the employee's complete Time/Payroll history immediately; already-derived branch accounting rows keep their recorded branch.

> ADR-0051 supersedes the self-service clause above for `role = 'user'`: a User without an active primary branch is blocked until reassigned. Global-manager access and the historical data-preservation rule remain unchanged.

The database enforces at most one primary assignment and requires exactly one when any assignments remain. The first assignment becomes primary automatically. Replacing or removing the primary while other assignments remain is one atomic operation with an audit record.

### Approval payment choice

For approved withdrawals and positive-net payroll slips, `expense_location_id` has two meanings:

- active location UUID: derive the existing branch expense;
- `null`: `ส่วนกลางจ่าย (จ่ายนอกระบบ)`, derive no Income/Expense or branch-report row.

This is unambiguous because debt, rejection, and non-positive payroll do not require an expense choice. No payment-mode column or duplicate Income/Expense row is added.

The approval UI orders choices as employee primary branch, every other active branch under the existing module-wide branch rule, then central outside-system payment. The employee primary branch is the default when available. Comment/reason remains optional.

An authorized manager may change between a branch and central payment until the existing report lock blocks the source update. Every change remains source-owned and audited.

### Account suspension

Only `super_admin` and system managers may see or call account suspend/restore. A system manager may suspend another system manager under the existing rule, but cannot suspend self or `super_admin`.

## Consequences

- Payroll privacy has one deterministic branch boundary without duplicating employee financial data.
- Revocation and branch reassignment take effect at the API/RPC/RLS boundary, not only in the UI.
- Central outside-system payment reuses the existing nullable expense relation and therefore stays absent from derived branch accounting automatically.
- Primary-branch mutation needs an atomic RPC and a deferred database invariant.
- Existing global Time/Payroll behavior and calculation rules remain unchanged.

## Verification

Verified on 2026-08-01:

- `user`/`admin` capability parity, primary-branch allow/deny, no-branch behavior, global-target denial, and immediate revoke;
- one-primary invariant, first-assignment default, atomic switch, explicit replacement, and allowed last-assignment removal;
- central withdrawal and positive payroll approval, branch ↔ central correction, and absence from accessible Income/Expense feeds;
- existing dashboard/report sources remain branch-derived only because every query requires a non-null matching `expense_location_id`;
- suspension toggle visibility and API authorization;
- migration replay, DB lint, semantic schema snapshot comparison, typecheck, and production build;
- 21/21 directly related regression tests, including actionable badges and the previous deduction/month-close workflow.

The repository-wide Chromium run reached 192 passing tests before 13 failures. Two failures caused by the new one-primary test fixture contract were corrected and reverified. The remaining failures reproduce independently from a clean reset because legacy branch-transfer/report tests require two active fixture branches while the current seed retires all but one; they are outside this decision's permission and runtime changes.
