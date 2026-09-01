# ADR-0049: Restrict Elevated Account Capabilities to Admin

- Status: Accepted
- Date: 2026-08-31
- Owners: LanFlow team
- Decision scope: Admin account management, Money Transfer, Time and Payroll, system-manager access
- Partially supersedes: the Account capability subsection of ADR-0028
- Extended by: ADR-0051 for the base User module and active-primary self-service boundary

## Context

LanFlow currently accepts the three standalone capability flags on both `user` and `admin` profiles. This lets a User receive system-manager, Money Transfer, or delegated Time/Payroll authority without first becoming an Admin, while the intended account-management workflow now requires an explicit role promotion before any elevated capability is granted.

Users must retain Time/Payroll self-service and the existing suspend/restore workflow. The primary-branch scope, approval-payment behavior, and account-suspension authorization from ADR-0028 are unrelated to the role boundary and remain unchanged.

## Decision

The following stored flags may be true only when `profiles.role = 'admin'`:

- `can_access_super_admin_features`
- `can_access_money_transfer`
- `can_manage_time_payroll`

`super_admin` receives effective access from its role and is not a target of these flags. A system manager remains an Admin whose system-manager flag grants automatic Money Transfer and Time/Payroll access.

Only a `super_admin` or system manager may grant or revoke standalone Money Transfer and Time/Payroll access on an active Admin target. Only a `super_admin` may grant or revoke system-manager access. A User must first be promoted to Admin. Demoting an Admin to User changes the role and clears all three flags in one database statement so no invalid intermediate state can survive a concurrent request.

The database enforces the role/flag invariant. API routes use conditional updates against an Admin target and return `403` when the target role or state is not eligible. The Admin UI reflects the same state matrix: an active User can be promoted or suspended, but elevated controls are read-only with the reason `ต้องตั้งเป็น Admin ก่อน`; an inactive account exposes restore only; automatic system-manager capabilities are shown as read-only rather than as controls that the API will reject.

User Time/Payroll self-service remains available and does not depend on any elevated flag, subject to ADR-0051's active-primary and exclusive-module boundary. Payment destination rules and account-suspension authorization remain unchanged.

## Consequences

- A stale client or direct API/RPC call cannot make a User elevated because PostgreSQL rejects the invalid profile state.
- Role demotion is the single cleanup boundary for all delegated account capabilities.
- Existing User rows with elevated flags are cleared by one idempotent forward migration before the invariant is added.
- Admin UI and API behavior share one explicit state matrix without introducing a new permission framework.

## Verification

Verify User denial, Admin grant/revoke, system-manager automatic access, atomic demotion, inactive-account behavior, self-service preservation, migration replay, database lint, and authenticated UI/API flows before deployment.
