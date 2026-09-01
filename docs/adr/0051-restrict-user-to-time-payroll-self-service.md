# ADR-0051: Restrict User to Time/Payroll Self-Service

- Status: Accepted
- Date: 2026-09-01
- Owners: LanFlow team
- Decision scope: User role, application shell, business-module authorization, Time/Payroll self-service, offline queues
- Partially supersedes: ADR-0028 for User module access and no-primary-branch self-service
- Extends: ADR-0049 from elevated capabilities to the base User module boundary

## Context

LanFlow currently treats an active User with a branch assignment as a normal business operator for most modules. Hiding navigation alone would leave deep links, API routes, direct Supabase reads/RPCs, cached offline state, and pending business queues reachable. The product now needs a simpler two-tier boundary: User is an employee self-service role, while business operations require promotion to Admin.

## Decision

A `profiles.role = 'user'` account may use only its existing Time/Payroll self-service: read its own attendance, wage, debt, withdrawal and payroll-slip information; request a withdrawal; withdraw its own still-pending request; and open its own permitted documents. It cannot manage another employee or receive an elevated capability.

The User application shell opens Time/Payroll directly, renders no module navigation, and keeps only account identity, connectivity status, and logout in the header. It does not load branch Dashboard summaries. A User must have one active primary branch to enter self-service; otherwise the existing no-branch blocked state and logout are the only available UI. Offline User sessions remain in the Time/Payroll unavailable state and never fall back to a business module.

The boundary is authoritative at UI, deep-link, API, RPC/RLS, and direct Supabase access. Authentication/bootstrap plus the User Time/Payroll and ownership-checked document seams are the only User exceptions under `/api/lanflow`; forbidden application requests return `403`. Server and database denial takes effect immediately after demotion, while an already-open UI adopts the new shell on reload or the next bootstrap. No realtime logout or session-revocation system is added.

Existing User accounts are restricted immediately and are never promoted automatically. Operators who still need business modules must be promoted to Admin explicitly. Existing Admin, system-manager, and super-admin navigation and permissions remain unchanged.

After an online bootstrap confirms the User role, the device removes that account's unsent business sync events and prevents later replay. This cleanup does not delete Server data or Time/Payroll self-service data. No new role, capability flag, or granular module-permission framework is introduced.

## Consequences

- Promotion to Admin becomes the explicit gate for every business module.
- Existing User-created business records remain intact, but the User can no longer read or mutate them.
- Authorization needs one central server boundary plus a forward database migration that preserves the narrow ownership-based Time/Payroll exceptions.
- Direct Supabase hooks and security-definer RPC grants must be audited; navigation tests alone are insufficient proof.
- Demotion can discard unsent business work on each device after that device next confirms the User role online.

## Verification

Verify the User shell, active-primary requirement, offline state, deep-link canonicalization, API `403` matrix, direct table/RPC denial, self-service ownership allow/deny, Admin regression, demotion behavior, owner-scoped queue cleanup, fresh migration replay, pgTAP, database lint, TypeScript, production build, Service Worker gate, and authenticated browser flows before rollout.
