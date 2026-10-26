Release authorized 2026-10-26: user requested push main and supabase db push. The local-only/hold statements below record pre-release verification. Actual Cloud migration, commit and hosting results are recorded in codingDO/10_Daily/2026-10-26.md after verification.

# Browser approval — local implementation

Status: local implementation verified (2026-10-26); release remains on hold. No push, Cloud migration,
deployment or SMS send is authorized by this work. Production remains on SMS
until a separately authorized rollout. Daily checklist:
`codingDO/10_Daily/2026-10-26.md`.

## Contract

Supabase keeps phone/password authentication. `sms_account_security.required`
and its generation/revocation timestamp are retained internally to avoid replacing
the established session/RLS gates. `OTP_REQUIRED` is an internal compatibility
code rendered as a browser-approval screen. It no longer offers SMS.

The server issues a random 256-bit HttpOnly cookie (`Secure` in production,
SameSite=Lax, path=/), stores only its SHA-256 hash, and scopes trust to user and
generation. No IP, raw user-agent or fingerprint is stored. Browser/OS labels
are approximate, untrusted display information. The cookie lasts up to 400 days;
server approval has no scheduled expiry. Browser eviction or clearing cookies
requires approval again. Do not claim permanent physical-device identification.

`POST /api/auth/browser` accepts bootstrap/resubmit after verified Supabase claims
and password AMR. Cookie issuance is serialized using Web Locks across tabs;
unique(user_id,secret_hash) and the account row lock deduplicate later requests.
`GET /api/auth/browser` never creates a request. Both may idempotently bind an
already approved browser to the current Supabase session. The database gate
checks that binding, browser state and generation on business requests, including
direct PostgREST calls. A browser cookie by itself never bypasses the gate.
Cancellation persists until explicit resubmit. Pending requests have no TTL.

The waiting page checks every ten visible, online seconds with countdown and a
manual button. Profile-load failures after approval remain retryable. Business
queues retain owner/branch checks and are never deleted by this feature.

## Authorization

Toggle remains Super Admin only, using the existing capability. Enable invalidates
old sessions/trust immediately; disable preserves still-valid sessions. Re-enable
does not resurrect previous generations. Super Admin is exempt. Approval of a
system-manager target requires Super Admin. No one may approve themselves.

For ordinary targets, actors need effective system-manager access. Existing
`get_my_effective_active_location_scope` gives system managers all active branches;
do not silently replace that with their explicit user_locations assignments.
Targets with no active branch are actionable by Super Admin only. Plain admin
role alone grants no browser-approval actions. Recheck actor/target state at write.

`GET/POST /api/lanflow/admin/browser-approvals` use authenticated actor identity,
then service-only list/manage RPCs. Client-supplied actor IDs are ignored.
List/count/actions share the same authorization predicate.

## UI and counting

One shared React Query request refreshes visible online approver UI every 30
seconds, on focus/reconnect, and after writes. The admin-tab total is independent
of selected branch and includes branchless requests accessible to Super Admin.
Branch badges include only each target's active primary location. Rows show
pending requests, approximate browser/OS, request time, approve/cancel actions,
latest successful approver/time, and revoke-all. A pending-only filter uses the
same data. No device count/list or per-approved-device revoke UI is added.

The same browser/account across tabs needs one request. Different profiles,
incognito rounds, browsers or cleared site data need a new request. Sharing a
browser does not share approval between accounts.

## Migration and rollout boundary

Local forward migration `20261026010000_browser_approval.sql` adds one browser/request
table and a minimal session-binding table linked to existing Supabase sessions.
It revokes old required non-Super-Admin sessions and disables legacy SMS reserve/
verification RPCs. Keep applied migration history, shared phone-change guard and
existing pre-request/restrictive RLS gates. `/api/auth/sms` returns authenticated
HTTP410 rather than sending. Provider code and opt-in real-SMS test tools are removed.

Before Cloud rollout: inspect existing pre-request hook, confirm backup, local
upgrade and DB regression, then coordinate application/database deployment in a
maintenance window. New application on old schema fails closed; old application
on new schema cannot complete SMS. Never leave versions mismatched as a normal
rollout. Keep Super Admin available and verify current session/login before pilot.
Rollback must retain or explicitly replace the gate; do not drop security tables
or restore an old app alone. An authorized recovery may temporarily disable the
requirement per account using the Super Admin toggle while investigating.

Credential-change policy confirmed by user: phone changes and all password changes/resets revoke all browser trust and active sessions. The self-password UI returns to login after success. Promotion of a required ordinary account to system manager also revokes trust so the new manager must obtain Super Admin approval.

## Verification and debug ledger

- Local migration applied; `node scripts/verify-browser-approval.mjs`: 50 checks
  passed through real Auth/PostgREST, including multiple callers, manager target,
  direct access denial, cancelled resubmit, remembered session, revoke and ACL.
- Final isolated suite: 601 passed, 2 skipped; focused new route checks: 7 passed.
- Waiting UI: 3 passed (countdown/non-creating polls, explicit resubmit, outage).
- Real browser acceptance: one test passed covering two tabs, approve in real
  management UI, latest approver, logout/login trust and revoke-all; existing
  admin-control UI tests 2 passed.
- Initial browser-test failures were test locator ambiguity (Next route announcer)
  and navigating at the same time as the app's correct revocation redirect; fixed
  locators/waiting for the actual redirect. No security bypass was observed.
- Unique Super Admin constraint rejected a second test Super Admin; test now
  reuses the existing local fixture without changing its credentials.

Final evidence: database pgTAP 1329 assertions passed (57 files); real concurrency
suite 1 passed; route-boundary audit 99 passed; browser acceptance 17 passed
including setup; post-review reopening/waiting/mobile/keyboard checks 6 passed
including setup; PWA offline queue/reconnect 5 passed including setup. Local
migration dry-run reports up to date. No results imply Production changed.

Additional forward migrations: 20261026011000_browser_approval_hardening.sql
(profile locking, approver index and required metadata),
20261026012000_browser_password_revocation.sql (atomic password revocation), and
20261026013000_browser_approval_role_boundary.sql (manager promotion and deleted
approver fallback). All four browser migrations are local only.

Review fixes with regression evidence:
- Returned database connection errors were incorrectly reported as stale-request
  HTTP409. A failing route regression reproduced it; unexpected errors now return
  retryable HTTP503. Revoke ignores unrelated request IDs instead of sending an
  invalid UUID to PostgreSQL.
- Reopening employee management restored stale checkbox/phone props after saving.
  A failing UI regression reproduced it; successful saves now update parent user
  state via a callback, and closing/reopening preserves the saved values.
- Legacy pgTAP business fixtures impersonated the live Super Admin without a
  session. Password revocation exposed that incomplete fixture (7 failures).
  Three test files now create a transactional auth session; all 1329 pass without
  weakening the production gate.
- Local production-mode tests must build AND start with explicit .env.local
  settings. Next's .env.production.local otherwise compiles Cloud public Auth
  configuration. Failed fixture logins were not proof of an approval bug.
- Self-phone-change acceptance intentionally revokes the saved Super Admin test
  session. Rerun global setup before later suites; do not reuse stale auth state.
- Revoke UI tests await the mutation response before asserting immediate server
  denial, and explicitly reload to test startup revalidation without depending
  on unrelated background polling.
