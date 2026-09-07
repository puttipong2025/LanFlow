# ADR-0063: Delegate Rubber Export Management Within Assigned Branches

- Status: Accepted
- Date: 2026-09-07

Admin accounts already have basic Rubber Export access within their assigned branches, while verification and deletion require system-manager authority. The confirmed scope is a per-Admin capability that provides system-manager-equivalent operations within Rubber Export, limited to the branches assigned to that account and subject to the existing document-state and relation-lock rules. This keeps the capability separate from system-manager access, whose authority extends across branches and other modules.

Disabling this capability preserves the Admin's existing basic Rubber Export access, including viewing, creating, and editing drafts in assigned branches. It removes only the additional management authority provided by the capability; verification and deletion remain unavailable to an ordinary Admin without it.

Super Admins and system managers may grant or revoke the capability, consistent with the existing Money Transfer and Time/Payroll delegation controls. Receiving Rubber Export management authority does not authorize the recipient to delegate it to other accounts.

Suspending an Admin prevents authentication and permission changes but preserves the stored capability for restoration. Demoting the account to User clears this capability atomically with the other elevated flags. Verification and deletion are authorized inside their database functions from the locked export's current branch; an idempotent deletion retry uses the deletion audit's branch. Deletion-history RLS exposes only `rubber_export` audit rows to delegated Admins and does not extend Report Batch or Cash Count deletion visibility.

The implementation and acceptance criteria are recorded in [Rubber Export delegated access plan](../rubber-export-delegated-access-plan.md). The capability was implemented and verified on 2026-09-07 through the Admin UI and API, branch-scoped database authorization, deletion-audit RLS, focused Playwright tests, the full pgTAP suite, and a production build.
