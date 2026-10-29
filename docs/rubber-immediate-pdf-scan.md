# Rubber business/Route follow-up scan — 2026-10-29

Scope: the current Rubber local receipt changes and their callers, command
preparation/uploader, cash-lock cache, admission/context Routes and replay guards.
No supplied snippet extended the request to unrelated modules. Reused the existing
uploader and error/retry boundary; no new queue mechanism is needed.

## Reproduction ledger

- Strict TypeScript unused-local/parameter scan passed before changes
  (`output/rubber-scan-unused.log`). Checked print/command exports and active call
  sites. Follow-up call graph review found the old normal-bill view fallback
  unreachable: the table invokes `onView` only for failed/conflict drafts or
  inbound branch receipts. Removed the `openEdit` fallback/unused async wrapper
  and the normal-bill-only disabled expression on that hidden view button.
- Candidate failure: connectivity changes after the uploader's initial online
  check while awaiting session validation. Alternative explanations considered:
  session rejection, HTTP failure retaining the proposal, or context failure
  retaining the staging marker. A controlled accepted session and transport
  separate these cases. No live paused debugger was attached; the executable
  source-module harness exposes each transport/session boundary directly.
- Control first: stable online session reads generation 7/version 9, durably
  prepares and POSTs once. Differential: only flip navigator offline during
  successful session validation. The create branch skipped context, removed the
  staging marker, marked attempted and POSTed generation/version 0. Regression
  failed at unexpected POST count 1 (`output/rubber-scan-race-red.log`). A failed
  POST could subsequently preserve that incorrect prepared payload for replay.
- Minimal fix: completion of a locally staged create now requires online context
  preparation, matching staged updates. Existing uploader catch retains the exact
  staged proposal/UUID with backoff and no attempted marker. Initial offline
  create acceptance remains available through its existing deferred path.

## Review trace

Form eligibility → durable outbox → frozen local receipt → serial origin share;
independently uploader owner/branch checks → context preparation → conditional
replacement → attempted marker → admission Route → authoritative worker → receipt
cleanup. Route POST validates bounded JSON, actor identity, action/UUID/version
shape and rejects staging markers before RPC. Read/PATCH validate receipts and
versions; database authorization remains authoritative. Existing renderer,
approval policy and Server rules are retained.

Verification results are appended after commands complete.

## Completed verification / verdict

- Focused command/admission/serialization tests: 50 passed
  (`output/rubber-scan-focused.log`).
- Final regression includes stable-online control, disconnect during successful
  session validation, retained unattempted proposal, then restored connectivity
  reading generation 7/version 9 before first POST with the original UUID.
  UI guard/cleanup and receipt suite: 26 passed (`output/rubber-scan-cleanup.log`).
- `npm run verify` exited 0: 835 passed / 2 existing skips; lint, typecheck,
  source-size/import checks, login outage, production build, Service Worker and
  bundle budget (280.0/320.0 kB) passed (`output/rubber-scan-verify.log`).
- Final strict unused-local/parameter check, scoped ESLint and `git diff --check`
  exited 0. The UI cleanup occurred after initial lint; final scoped lint and
  production build checks cover those final files.

Verdict: ship locally after the verified fix. Offline preparation can no longer
turn an unchecked staged create into an immutable attempted command. No further
Route defect was reproduced in this scoped scan. No SQL/schema change or deploy;
the existing database suite evidence belongs to the earlier delivery.

## Second scan — context-failure round cost

Review followed owner/branch isolation, malformed receipts and session transitions
through uploader/context/admission/cleanup. No new renderer, storage abstraction
or retry mechanism is needed. The preparation-failure branch omitted the existing
`deferredBranches` mechanism used for session and POST failures.

Reproduction/control: three staged creates, two in branch A and one in branch B.
Only A's context read fails; B reads valid context and POSTs. The test expects one
context attempt per branch in the round, retains both A proposals with original
identity/unattempted markers and verifies B's POST. Before the fix, the observed
context calls were A, B, A (`output/rubber-scan-second-red.log`). This rules out
global session rejection, lost local data and total cross-branch blocking; the
defect is repeated slow work in the same failing branch. With up to 20 entries
and a 10-second context timeout, repeated failures can lengthen a round materially.

The minimal fix adds the failing branch to the existing round deferral set before
the existing conditional backoff write. Subsequent rounds retain the established
retry policy; no proposal is deleted or marked attempted by a context failure.
No debugger attached; controlled transport boundaries make the failure deterministic.
Verification follows below after commands complete.

Second-scan verification: focused uploader/Route/receipt tests 51 passed
(`output/rubber-scan-second-focused.log`); full isolated suite 836 passed with
2 existing skips (`output/rubber-scan-second-isolated.log`). Strict unused-local/
parameter TypeScript, scoped ESLint, source-size ratchet and `git diff --check`
all exited 0. No additional dead code was established in this pass. No database
or Route contract changed, so prior build/DB evidence is not represented as a new
run. Verdict: ship locally; repeated same-branch preparation failure now uses the
existing round deferral, preserving the queue and progress for other branches.

## Third scan — no additional reproduced defect

Followed local feed merge (Server values versus failed proposal), command identity
comparison/conditional cleanup, receipt validation, origin-scoped notifications,
context GET and queue GET/POST/PATCH boundaries. Checked mismatched identities,
malformed outcomes, oversized/invalid requests, account changes during upload,
lost responses, changed drafts and deleted receipt resurrection through the
existing regression cases. Reusing these boundaries remains simpler than adding
another processor or validation layer. No additional confirmed dead code or
reproduced business/Route defect was found; production source was left unchanged.

Verification: 105 targeted receipt/uploader/Route/recovery tests passed
(`output/rubber-scan-third-regression.log`); strict TypeScript unused-local and
unused-parameter checking exited 0 (`output/rubber-scan-third-unused.log`). These
are scoped Local checks, not a new browser/Cloud/physical printer verification.
Verdict: ship within this Local scope; no new finding requiring a code change.
