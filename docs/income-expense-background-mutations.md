# Income/Expense background update/delete contract

General income/expense edits and deletions use the existing queue/coordinator.
Creates, sales, transfers and unmarked legacy commands keep their existing paths.
The client checks authenticated context online, then atomically enqueues against an
empty record snapshot. Returning from acceptance only confirms durable local work.
The UI closes without awaiting submission, retains authoritative values and blocks
competing actions on that row. Pending deletion remains visible until confirmed.

## Command identity and Server receipt

New commands retain the legacy operation/client/revision idempotency key and add
`contractVersion: 2`, `background: true`, UUID `commandId`, `actorUserId` and
`expectedServerId`. UUID is new for explicit new intent, persisted and unchanged on
retry. Actor is the queue owner, not necessarily the original document creator.

`GET /api/lanflow/income-expense/background` accepts `serverId` and `locationId`.
It checks active identity/branch access and returns the exact physical record,
revision, status and pending approval. Missing/403/404 never proves deletion.
`POST` checks legacy payload validity and command identity before invoking
`sync_income_expense_background`. Database checks the current actor again, closing
the account-switch gap between context lookup and POST.

The private command ledger binds UUID, actor, branch, source, operation and full
payload fingerprint. Known commands resolve before inspecting the current row.
Thus lost responses can be acknowledged even after a later revision. Pending
approval replay returns its original request; an approval trigger persists terminal
approved/rejected outcomes before disposable approval history is removed. Missing
approval history does not authorize creation of a replacement request. The ledger
has no automatic retention and contains no proposal payload. No replacement or
Rubber command generation protocol is introduced.

Unknown commands lock key then source consistently with the legacy dispatcher,
check exact physical identity/revision, refuse pending approval replacement, and
use the existing business submission function. Existing validation, approval,
report/relation/cash-count locks and authoritative money calculation remain.
Confirmed deletion retires silently; a confirmed revision conflict retires only
that draft and records a deferred explanation. Unknown outcomes remain queued.

## Durable completion and quiet scope

IndexedDB version 6 adds `income_expense_outcomes` to the existing database; queue
and Rubber receipt/tombstone stores remain. Exact snapshot comparison, queue
removal and deferred explanation commit in one transaction. Aborting preserves
the queue and removes no draft; stale responses cannot remove another tab's work.
Explanations contain minimal command/account/branch/record identity and text, stay
until explicit acknowledgement and are never marked read merely because hidden.

Only the Income/Expense screen of the source branch loads these explanations,
checking current authenticated access before display. Other branches receive no
toast, modal, focus change or navigation. Transport failures of background POST
and failed-command probes do not change global service-health state; normal
foreground requests still disclose genuine service outages. Pending/failed rows
remain local status, not monetary projections.

The owner-level single flight reads owner work once, selects only marked commands,
and sends sequentially, at most 20 due commands per round. The existing coordinator
owns reconnect and 30-second polling; no timer per branch is added. Retry delay
backs off up to 120 seconds. Session/branch access is checked before each request,
with 8-second session/probe, 10-second acceptance-context and 15-second submission
timeouts so one stalled response cannot hold the owner round indefinitely.
and Server actor binding rejects a request sent with a different session. Failed
business commands are only submitted manually or after a positive changed/deleted
context; unchanged failures are probed at most every two minutes. A forbidden
branch does not prevent other authorized branch work. Local branch feed/status
invalidation occurs only after work changes; empty legacy rounds no longer trigger
broad refresh. Completed branches refresh their money history/snapshot, with badge
and shared branch summaries invalidated once per owner round. Failed rows retain
their physical Server ID/bill number in Sync Problems; explicit discard after a
confirmed rejection uses full-record snapshot comparison and an AlertDialog.
Logout pauses unsent work. Started requests may commit and are
reconciled under the original identity. Closing the browser pauses unsent work.

User-confirmed clarification (2026-10-29): a confirmed revocation of the current
login retains the existing immediate redirect to `/login`. Quiet cross-branch
processing does not suppress that account-wide authentication requirement. Network
failure alone is not a confirmed revocation. Unsent Income/Expense commands stay
in the original browser profile, bound to their owner; another device cannot
resume that local outbox. A committed result or pending approval is visible from
other devices according to existing access rules, even if the origin browser has
not yet received its acknowledgement. This clarifies existing behavior and adds
no queue migration or new authentication flow.

Mixed edit/create forms retain accepted line identity, skip accepted lines on a
partial retry and make them read-only. New lines inside an edit keep their line
UUID rather than generating another UUID on every form retry. Pure creation and
sale submission keep their original behavior.

## Rollout and rollback

Apply migrations `20261028020000`, `20261028021000`, `20261028022000` before releasing
the client; current work applies them locally only. Existing clients use the old
RPC unchanged. Retain command ledger and terminal approval capture during rollback
to prevent delayed submissions resurrecting completed work.

IDB 3/4/5 data upgrades without clearing existing queue/receipt stores. New clients
close connections on versionchange; blocked upgrades surface a close-old-tabs
message. Once an installation opens IDB 6, rollback must retain a version-6-capable
database opener/outcome store. An original client pinned to IDB 5 cannot open an
upgraded database and needs an application refresh. Never delete local storage or
downgrade the database to perform rollback. Old tab/browser compatibility and
actual device recovery are not implied by local unit tests.

Verification: `tests/income-expense-background.spec.ts`,
`tests/income-expense-background-browser.spec.ts`,
`supabase/tests/income_expense_background_test.sql`, operational feed/route tests,
receipt upgrade regressions and the project quality gates. Daily checklist and
actual results are maintained in codingDO `10_Daily/2026-10-28 3.md`.

## Local evidence and review — 2026-10-28

The real authenticated browser test delays POST, observes form closure and
authoritative pending values, navigates modules and branches, submits a competing
edit, confirms quiet conflict retirement outside the original branch, then sees
the deferred explanation on return and tests deletion. Captured screenshots are
`output/income-expense-background-pending.png` and
`output/income-expense-background-conflict.png` (local, ignored).

The focused command suite covers owner-round limits (empty = 0 requests; 25 due
commands = 20 POST/session checks with 5 retained), coalesced shared refresh, exact
cleanup/abort rollback, blocked IDB5 upgrade, concurrent acceptance, unbound
acknowledgements, account change before the next command/after session precheck,
stalled response timeouts, legacy exclusion and mixed form partial retry.
Database tests exercise terminal rejection/history deletion and durable receipts
after later revisions. Real multiple connections verify exactly-once application
of identical replay and one winner for competing commands at the same revision.

The simpler-alternative review retained the existing queue, scoped single flight,
conditional queue primitives and coordinator timer. Two new RPCs and a private
receipt table are necessary for exact deletion evidence and terminal replay that
the existing sale-detail GET and temporary approval history cannot provide. A
single IDB store provides deferred explanations without Rubber receipt machinery.
No general-purpose worker, command replacement protocol or additional UI timer is
introduced. Review also corrected empty-round invalidation, account-switch retry
classification, deferred-notice scope and failed-row physical identity.

All evidence describes Local. No Git commit/push, Supabase Cloud apply or hosting
deployment is included; do not claim recovery of a particular customer's device.

## Follow-up review — 2026-10-29

Tracing the shared session-check transport exposed a gap in quiet background
processing: session prechecks still tracked global service health. Reproducing an
HTTP 503 and a network exception both changed the global banner, while the same
failures in the command POST/context probe were already quiet. Both the branch
session check and the owner-only fallback now pass the existing background option.
Authorization and retained immutable commands are unchanged.

Four regression cases execute the production worker, auth helper, network wrapper
and service-health state with controlled transport failures. All preserve queued
work without changing the global banner; a foreground control still marks the
service unavailable. Focused Income/Expense and Rubber regressions: 108 passed.
The complete `npm run verify` gate passed with 817 isolated tests and 2 existing
skips, including lint, typecheck, source-size, build, service worker and bundle
checks. First load is 279.7 kB against the 320 kB limit. Log:
`output/income-expense-resume-verify-20261029.log`.

This follow-up changes no SQL or UI structure. Database/concurrency and actual
browser evidence above retain their original run dates; they were not rerun for
this transport-option fix. The implementation remains Local only.

## Verification plan execution — 2026-10-29

The follow-up plan in codingDO `10_Daily/2026-10-29.md` preserves the existing
implementation. New regression coverage executes the real worker/auth/network
path for a session timeout and confirmed `SESSION_REVOKED`: the latter redirects
to login, starts no business POST and retains both branches' immutable commands.
Focused command/projection checks: 34 passed.

Actual browser verification passed the delayed edit/delete, cross-branch conflict
retirement and deferred explanation scenario. A separate browser profile sees no
local outbox and can query the authoritative revision through its authenticated
API. A second scenario simulates a revocation response through the actual client
coordinator and verifies login navigation plus retained payload after reload.
Each browser run passed its feature scenario and setup (two scenarios total).
Logs: `output/income-expense-plan-browser.log` and
`output/income-expense-plan-revocation-browser.log`. The revocation response is
controlled test input, not an actual administrative revocation of a real account.

Scrutinize traced acceptance (`background-sync.ts:17`), per-owner session guards,
authenticated POST, bound receipt comparison (`background-command.ts:39`), atomic
queue/notice completion and scoped UI. The simpler option is to retain these
existing paths: the approved login exception already exists in `auth-fetch.ts:22`.
No production source, UI layout or SQL change was needed in this execution.
Existing AlertDialog, inline errors and authoritative pending rows remain.
Database evidence retains its earlier run date; this execution does not claim a
fresh database suite or a Production deployment.

Final gate for this execution: `npm run verify` exit 0, 819 passed / 2 existing
skips; lint, typecheck, source-size, import direction, auth-outage, production
build, service worker and bundle checks passed. First load 279.7/320 kB. Log:
`output/income-expense-plan-final-verify.log`. Diff whitespace check and visual
inspection of the current conflict screenshot passed. Verdict: deliver the Local
verification; the existing production behavior satisfies the confirmed contract.

## Subsequent scoped scan — 2026-10-29

Scope: background Income/Expense business helpers, route, queue/receipt boundaries
and automatic/manual callers. Removed the unreferenced exported
`IncomeExpenseBackgroundIdentity` type after repository-wide reference search;
strict unused-local/parameter compilation found no further unused symbols.

Two deterministic regressions failed before correction:
- A valid uppercase UUID context query returned 503 because PostgreSQL returns a
  lowercase UUID. The existing numeric/lowercase control passed, excluding the
  auth/RPC/required-field hypotheses. Canonicalize GET identifiers before the RPC
  and exact comparison, retaining the UUID validation and access checks.
- Manual retry of a failed command behind twenty due commands was excluded by
  the bounded batch, despite being eligible. Existing single-item and batch-limit
  controls passed, excluding missing storage or transport hypotheses. Prioritize
  the explicitly requested ID in the existing sort before taking the same
  twenty-command batch; retain automatic ordering for other entries.

Evidence ledger: `output/income-scan-red.log` has both failing regressions;
`output/income-scan-green.log` has 36 passing command/projection tests after the
minimal corrections. Scoped ESLint, strict TypeScript unused checks, source-size
and diff checks passed. No SQL or UI change. No full build/browser/database rerun
is claimed for these subsequent fixes. Verdict: deliver these verified Local
corrections; existing queue and route boundaries remain the simpler solution.

## Second scoped scan — 2026-10-29

Followed route/auth responses through the sender, retry state, discard guard and
next-branch iteration. A deterministic 403 race exposed that the sender treated
permission denial as a discardable business rejection and stopped every branch.
The failing two-branch control keeps the owner session valid, ruling out an
account-wide logout as the reason to stop. Corrected only the sender: retain 403
work as pending/uncertain with the existing bounded backoff, recheck owner identity
quietly, then let each next branch pass its own access check. A second control
changes the account after 403 and proves no next POST starts and both commands
remain pending. Existing 401/ACTOR_CHANGED stop behavior stays unchanged.

Ledger: `output/income-scan2-red.log` reproduces the stopped second branch;
`output/income-scan2-green.log` passes all 40 background/projection/single-flight
tests, including uncertain-payload retention and the account-change control.
Scoped lint, strict unused TypeScript checks, source-size and diff checks passed.
Reference search found no additional dead declarations in these scoped helpers.
The simpler solution keeps the current session guards and queue, with no new
worker or route contract. No SQL/UI changes or new full browser/build/DB result
is claimed. Verdict: deliver the verified Local correction.
