# Rubber Bill resume and status recovery — 2026-10-30

Scope: local implementation under codingDO `10_Daily/2026-10-30 2.md`.
No database migration, Cloud mutation, commit, push or hosting deployment.

## Findings and the smaller change

Successor action policy (2026-10-30): the user subsequently chose a delete-only
exception for never-submitted new local bills. Edits remain locked. This replaces
earlier blanket pending edit/delete statements only for this narrow local
cancellation case; accepted/uncertain/server-backed work retains all guards.

The central queue already owns accepted work. Read-only Local/Cloud diagnostics
found the same latest migration (`20261030021000`), matching hashes for admission,
receipt/list, worker/batch definitions and cron command, active two-second cron,
149 successful runs in the observed five-minute window, and no nonterminal backlog.
This is point-in-time health evidence, not a claim that a new Cloud command was
processed in this session. No second worker, scheduler, bulk endpoint or lease
recovery system is warranted by these findings.

Reproduction at the actual command/preparation/IndexedDB seam found:

1. A deferred OCR create with neither a supplied source nor an accessible context
   source remained pending forever, retried without a user-resolvable status.
2. A network context failure also retained pending work without explaining why.
3. Both create and background-update projections overwrote the server pause reason
   with a generic sending label.

`output/rubber-resume-red.log` records those three failures after correcting the
test harness to share the real IndexedDB boundary. An earlier runner-output
collision and missing VM IndexedDB injection were test infrastructure failures;
they were not used as production repros.

## Implementation and invariants

- Only a typed missing-OCR-source preparation failure on a staged create that has
  never been submitted or accepted becomes a local actionable failure. Automatic
  retry stops for it. Existing explicit retry clears failure metadata and retries
  the same identity. Existing confirmed discard is available only for this exact
  proven-local failure; full-record snapshot reconciliation protects the exit
  against a concurrent submitter. Other central failures retain central controls.
- Network, permission, malformed/unknown context and uncertain admission remain
  retryable. Payload/UUID are retained. Submitted envelopes are never rewritten
  to obtain a more favorable context. Corrected business drafts still use the
  existing replacement-command/version workflow.
- Pending status now distinguishes local waiting, uncertain admission, admitted
  work and server wait reasons. A changed nonterminal reason refreshes only the
  local-status query; an unchanged receipt refreshes no business query. The shared
  queue shows the last successful list-fetch time, not the last attempted request.
- Visible-tab resume/focus requests receipt recovery through the existing owner
  single-flight, at most once per five-second burst per tab. Hidden/offline scopes
  do not run it, handlers are removed on unmount. It preserves unknown-admission
  backoff and adds no interval or cross-tab protocol.
- Save/edit/delete acknowledgement paths, calculations, price/approval rules,
  offline restrictions and print eligibility remain unchanged. No server response
  is newly awaited by a successful local save. PDF delivery remains origin-scope
  local acceptance; receipt polling cannot trigger PDF delivery.

## Outcome and action matrix

The existing entry policy remains:

| Entry | Online | Offline | Immediate PDF |
| --- | --- | --- | --- |
| New bill with cached valid policy and eligible price/date | Durable local acceptance, then background context/admission | Durable local acceptance, later upload | Eligible positive-total local snapshot only |
| New bill needing approval or unknown eligibility | Existing validation/preflight/approval path | Existing cached-policy/price guards still apply | No eligibility bypass |
| Edit a confirmed bill | Existing revision/action guards, then local acceptance | Refused by the existing offline guard | Only when existing edit-window/approval criteria allow |
| Stock deduction | Existing stock validation | Refused | Existing eligibility still applies |
| Delete / manager approve or cancel | Existing confirmation, permissions and queue workflow | Existing online requirement | None |
| Unsent local new draft | Existing local-edit policy | Existing local-edit policy | Existing eligibility still applies |

Approval, report and transfer locks remain additional restrictions. Save-time
cache/validation cannot authorize a server write.

| Outcome | Local tracking / UI | Management and reports |
| --- | --- | --- |
| Local staged pending | Retain proposal; explain context/network wait | Edits stay locked; confirmed never-submitted new bills may be cancelled locally; uncertain submitted work stays locked |
| Local missing OCR source, never submitted | Retain actionable failed draft; explicit retry or confirmed local discard | No central blocker exists for this unadmitted draft |
| queued / retry_wait / paused | Retain tracking and confirmed server wait reason | Existing cash/rights/pending guards and central report blocker |
| correction_required | Retain correctable draft | Existing central correction workflow; no automatic discard |
| done + synced | Validate identity/result before acknowledgement | Re-evaluate all existing approval/report/transfer/offline guards |
| done + pending_approval | Preserve/display approval handoff | Approval remains locked; blocker transfers atomically |
| done + discarded | Preserve latest authoritative bill and display outcome | Not advertised as a successful business write |
| Unknown/mismatched result | Retain work and retry | No acknowledgement or unlock based on uncertain evidence |

Manager approve/cancel and deletes retain their dedicated result validation and
atomic tombstone cleanup. Queue `done` alone is never an instruction to unlock.

## Verification ledger

- Pre-change focused baseline: 71 isolated tests passed.
- Local database concurrency: 10 passed, including no-browser cron processing,
  per-attempt commit/deadline, killed connections, contention and report races:
  `output/rubber-recovery-db.log`.
- Local SQL: five existing pgTAP files, 156 assertions passed, including central
  queue/retirement, command replacement/OCR and history retention:
  `output/rubber-recovery-sql.log`.
- Targeted post-change regression set: 149 passed before the final local-status
  invalidation test; subsequent status/central set 40 passed:
  `output/rubber-recovery-final-isolated.log`, `output/rubber-recovery-status.log`.
- Full `npm run verify` completed: lint, types, source/import bounds, auth outage,
  884 isolated tests passed / two existing skips, production build, offline assets,
  service worker and bundle budgets. This preceded the last local-status-only
  invalidation change; final checks are recorded below when complete.
- Browser tests use separate output directories. The baseline PDF suite passed
  three tests with one production-PWA-only skip. The first candidate run required
  replacing the old `กำลังส่งคำขอลบ` expectation with the intended local-wait label
  and reopening an approval dialog dismissed during global alert acknowledgement.
  Its persistent-profile local/lost-response restart cases already passed. Final
  browser and production-PWA results are appended after completion.

## Performance gates and limits

Existing UI tests bound local feedback to one second while context/POST/feed are
held. Baseline delete feedback was 165 ms and edit feedback 254 ms, one sample
each (`output/rubber-pdf-before.log`). These are a small local smoke baseline,
not a Cloud latency distribution or a promise of faster saves. Final samples
and gates are recorded below. No worker, server endpoint, financial computation
or successful-save network path changed. Idle/repeated-receipt request bounds
are checked at the coordinator/uploader seam. No multi-device production load
benchmark or Cloud end-to-end timing was performed.

The implementation budget is no new save/edit request and no new interval; at
most one extra owner resume invocation per five-second focus/visibility burst
per tab, zero such invocations while hidden/offline, and zero business-query
invalidations for unchanged receipts. A changed server wait reason invalidates
only one local IndexedDB-backed query. These bounds are covered by regression
tests; they do not claim browser tabs share a single process-wide coordinator.

## Delivery and rollback

Review the local changes before publishing the compatible client. No migration
is needed. Keep all outbox rows, command receipts and tombstones on rollback;
never clear browser storage to recover sync. Reverting only the client changes
restores the earlier retry/message behavior without reversing accepted server
effects. The optional diagnostic script is read-only and prints aggregate health
and hashes only; both paths use explicit `BEGIN READ ONLY` and bounded timeouts.

Release authorization update: on 2026-10-30 the user requested pushing `main`
and running `supabase db push`. Preflight found HEAD identical to origin/main,
no changed migration files, and the linked Cloud database already up to date.
Earlier Local-only statements above describe the implementation/test stage;
the release receipt is recorded in codingDO Daily `10_Daily/2026-10-30 2.md`.

Post-deployment scheduler/backlog/latency observation is pending authorization to
publish the client. Local tests and the read-only Cloud snapshot cannot certify
the unpublished client on Cloud.

## Final verification

- Final full isolated gate: **885 passed, two existing skips**
  (`output/rubber-recovery-final-full-isolated.log`). Final preparation-only rerun
  after tightening the v2 local-discard guard: seven passed
  (`output/rubber-preparation-final.log`).
- Final browser suite: **seven passed, one production-PWA-only skip**, including
  full persistent-browser-process restarts before admission and after a committed
  response was withheld. Each recovered the same command and exactly one bill.
  Multi-device/manager, offline editing, pending controls and actual PDF bytes
  were exercised (`output/rubber-recovery-browser-final.log`).
- Production PWA gate: **two passed** (setup plus offline reload test). A real
  production build and service worker served an offline-reloaded page that saved
  a bill and generated a PDF; confirmed cash locks remained enforced
  (`output/rubber-recovery-pwa.log`). This closes the PWA skip in the dev suite.
- Final lint, typecheck, source-size, service-worker and bundle checks passed.
  PWA's build included the local-status invalidation change. The final v2
  predicate tightening was subsequently regression-tested and does not add a
  client/server wire format or storage version.
- Feedback times, milliseconds (three final samples each): edit 174/172/177,
  p50=174 and nearest-rank p95=max=177; delete 187/165/121, p50=165 and p95=max=187.
  All met the existing one-second local-feedback gate while requests were held.
  The one-sample baseline and three-sample candidate are not a rigorous
  distribution comparison, and no Cloud speed improvement is claimed.

The controlled Local comparison below subsequently closed the planned local
before/after measurements. Publishing the client and post-publish observation
remain unchecked. Production capacity and statistically strong latency claims
are not established by the small Local workload.

## Controlled before/after workload — passed

`tests/rubber-sync-resume-performance.spec.ts` is shared byte-for-byte with an
isolated managed worktree at the pre-change HEAD. Each revision uses the same
Local database/schema, credentials/setup, server port and browser workload,
sequentially: one and three simultaneous tabs, three independent synthetic-branch
rounds each, an eleven-second idle window, one save per tab through confirmed UI,
and a five-event focus burst per tab followed by a one-second observation.
No cron/configuration or database kernel is changed by the benchmark.

Before comparing results, the acceptance thresholds are: warm local-save p95
at most one second; warm page-open, admission and confirmed-UI p50/p95 at most
twice baseline with a one-second noise floor; aggregate API requests in each
phase at most 1.5 times baseline plus six requests per measured round. First
round startup is retained separately rather than silently excluded. These are
local regression thresholds, not production capacity or throughput guarantees.
The sample size is descriptive; a larger production load study is outside this
small client fix.

Baseline HEAD: `6c4999b23d0283dff18d41e9ac9d5024a4b669cc`. Both stages passed
three tests (setup plus one-tab/three-tab workloads). The initial baseline setup
failure was a multi-page selector race; both revisions were then measured using
the same explicit initial-branch selection and sequential page opening, followed
by concurrent saves. First-round timings remain in the raw data. The comparison
uses two warm rounds per workload, two one-tab saves and six three-tab saves.

| Warm measure, p50 / nearest-rank p95 (ms) | Baseline 1 tab | Candidate 1 tab | Baseline 3 tabs | Candidate 3 tabs |
| --- | ---: | ---: | ---: | ---: |
| Open all tabs into Rubber workspace | 2049 / 2442 | 2487 / 3235 | 7881 / 8171 | 7503 / 8546 |
| Local save feedback | 115 / 116 | 99 / 108 | 434 / 984 | 307 / 988 |
| Save click to central admission | 601 / 752 | 573 / 575 | 1613 / 2848 | 1389 / 2398 |
| Save click to confirmed UI | 1570 / 1624 | 1569 / 1578 | 2852 / 3560 | 2370 / 3050 |
| Database accepted-to-completed | 97 / 105 | 74 / 108 | 59 / 150 | 44 / 245 |

| Aggregate API requests across two warm rounds | Baseline 1 tab | Candidate 1 tab | Baseline 3 tabs | Candidate 3 tabs |
| --- | ---: | ---: | ---: | ---: |
| Open | 60 | 60 | 216 | 219 |
| Idle | 16 | 16 | 16 | 14 |
| Work | 34 | 34 | 121 | 122 |
| Focus burst | 4 | 4 | 12 | 12 |

All declared regression gates passed; worker time is observational because its
implementation is unchanged. Opening one tab was slower in these samples, while
other metrics varied in both directions. This is not evidence of a universal
speedup. API counts include other app modules and background activity. Request
counts and database completion duration are bounded workload/load indicators,
not CPU, I/O or production-capacity measurements.

Evidence: `output/rubber-resume-perf-{baseline,candidate}-{1,3}.json`,
`output/rubber-resume-performance-summary.json`,
`output/rubber-resume-performance-{baseline,candidate}.log`.
`node scripts/summarize-rubber-resume-performance.mjs` verifies sample shape,
terminal results, percentiles and thresholds without contacting the database.

## Scrutiny follow-up — Business Logic and Routes, 2026-10-30

The smaller solution remains the existing coordinator and queue. This scan did
not add a scheduler, change the immutable submitted payload, touch SQL, or change
save/print/action policies. All five findings were reproduced before their fixes:

| Finding | Repro and control | Minimal fix |
| --- | --- | --- |
| Resume event ignored a rejected outbox read | Rejected queue promise had no handler; visible/hidden/cooldown controls exercise the same production hook | Catch the rejection and leave recovery to the existing interval |
| Successful deferred preparation retained the old context-wait label after a lost admission response | Real preparation completed, POST response was lost, persisted event was submitted but still displayed context wait | Clear only obsolete preparation error metadata at the conditional local commit and refresh the local query |
| Unchanged correction receipts invalidated every business query on each recovery round | An admitted failed/400 correction returned the same result yet invalidated the whole money-flow family; first transition remains a positive control | Compare pre-attempt status/error class before broad invalidation; keep receipt checks and correction notification deduplication |
| Context Route returned 200 with invalid queueVersion | null, negative, fractional, string and unsafe versions; zero/positive and omitted optional version remain valid controls | Validate the optional field before returning success; opaque retryable 503 on malformed RPC output |
| POST/PATCH reported failure for equivalent UUID casing | Canonical RPC receipt for uppercase command UUID produced 503; uppercase actor/location could produce 403 | Compare validated UUIDs semantically, preserving exact opaque client identity and submitted payload |

Evidence: `output/rubber-scrutiny-red.log` (three failing repros / 14 controls),
`output/rubber-scrutiny-correction-red.log`,
`output/rubber-scrutiny-uuid-red.log`, and
`output/rubber-scrutiny-final.log` (92 focused tests passed, including the first
correction transition control). The first UUID helper signature failed strict
typechecking because the validated envelope is typed as unknown-valued fields;
the helper now narrows both inputs with the existing UUID validator. This was
corrected before delivery, not counted as a pre-existing product bug.

Dead-code pass: strict TypeScript `--noUnusedLocals --noUnusedParameters` passed,
and the touched module exports/call sites were traced. No proven unused import,
variable or function in this scope needed deletion. Framework Route exports and
public queue contracts were retained. No debug instrumentation was introduced.

Final follow-up gate: `npm run verify` exit 0, **892 passed / two existing skips**,
lint/types/source/import checks, auth-outage check, production build, offline
manifest, service worker and bundle budgets passed
(`output/rubber-scrutiny-final-verify.log`). Strict unused checking also exited 0
(`output/rubber-scrutiny-final-unused.log`). Focused 92 passed, with an additional
central-queue Route rerun after the UUID input-narrowing fix. No SQL change,
Cloud write, deployment or repeated production load benchmark was performed in
this follow-up; prior browser/PWA timings remain evidence of the earlier stage.

## Delete-only offline cancellation — 2026-10-30

The user confirmed deletion of unsent new bills and explicitly selected keeping
edits disabled. The table and Module share an action-aware sync guard; existing
busy, approval, report, transfer and offline-server-record guards remain. The
existing confirmation explains that the local bill and pending upload will be
cancelled, with no future upload after reconnect. This is not a server delete.

At confirmation, the mutation rereads the owner/location partition, requires a
pending local create with no server identity, and checks every related event has
explicit `serverSubmissionAttempted: false` and is not centrally accepted. Removal
uses the complete-record IndexedDB snapshot condition. If another tab marks the
command submitted or adds dependent work, the delete fails and preserves the
outbox. An uploader holding an earlier snapshot cannot mark a removed command
current and therefore cannot submit it. No server request or migration is added.

Verification:

- Seven targeted cases passed: delete-only UI policy, offline removal, submitted,
  accepted, unknown state, concurrent-submit and new-dependent-event protection.
- Final focused action/queue/background suite: 78 passed
  (`output/rubber-local-delete-final-focused.log`).
- Real browser: two passed (auth setup plus offline-create/delete/cancel/reconnect
  workflow), with edit disabled, no remaining local outbox command, no server
  queue or bill after reconnect/reload (`output/rubber-local-delete-final-browser.log`).
- Full isolated run: 904 passed / two existing skips. Lint/type/source/import and
  auth-outage steps passed before the build. The first build overlapped a dev
  browser runner using `.next`, causing an `_document` artifact error; it is not
  counted as a passing build. A separate final build is recorded after completion.
- An initial test passed a VM Promise into Playwright's native rejection matcher;
  it now explicitly awaits the outcome. The dependent-event fixture initially
  used an undefined inline IDB key; removing the key property created the intended
  concurrent row. These test-harness corrections did not drive product fixes.

Pending delivery: no new commit, push, Supabase migration or deployment for this
delete-only follow-up. Receipt PDF behavior is unchanged; this does not revoke a
PDF the user has already shared or downloaded.

Final standalone production build exited 0 after the browser server stopped
(`output/rubber-local-delete-build.log`). Service-worker and bundle checks passed;
first load 283.3 kB / 320 kB. Final focused 78 passed includes the tightened
pending-only mutation check. No product fix was needed for the shared-build
artifact collision.

## Delete-only scrutiny follow-up — 2026-10-30

Two reproduced boundary defects were fixed without adding a Route or changing
the existing save/PDF policy:

1. A stale local-create confirmation could fall through to the server-delete
   path if another tab had already removed the create (cancelled it or acknowledged
   its server result) before confirmation. With no create in the outbox and the
   old local row still in the dialog, online deletion queued a new delete with an
   unverified target. The mutation now requires an existing Server-backed record
   before entering that path; stale callers must reload. The control test confirms
   a verified Server bill still queues its normal delete. Evidence:
   `output/rubber-local-delete-scrutiny-red.log` (one failing repro, one passing
   control before the fix).
2. The local feed collapsed an absent submission flag to false and ignored
   central acceptance when projecting a new create. The delete-only exception
   therefore exposed a delete action without explicit never-submitted proof,
   although confirmation would later reject it. The projection now preserves
   unknown submission and treats acceptance as submitted; the status message also
   distinguishes unknown from waiting to send. Normal explicit-false creates
   remain deletable, edits remain blocked. Evidence:
   `output/rubber-local-delete-projection-red.log`.

The focused queue/action/Route/PDF regression set passed 129 tests after both
fixes (`output/rubber-local-delete-scrutiny-green.log`). Strict unused checks and
full verification results are recorded below after completion. No debug probes,
schema changes, Cloud writes, commit, push or deployment were introduced here.

Final `npm run verify` exited 0: **907 passed / two existing skips**, lint, types,
source/import bounds, auth-outage, production build, offline assets, service worker
and bundle budget passed (`output/rubber-local-delete-scrutiny-verify.log`). A
strict-unused invocation during Next's generated-type rebuild encountered missing
`.next/types` artifacts; it is rerun after build rather than treated as dead code
or fixed by changing application types. The final strict-unused receipt is in
`output/rubber-local-delete-scrutiny-final-unused.log` and the Daily record.

## Delete-only release authorization — 2026-10-30

The user requested pushing `main` and database push only if new migrations exist.
Preflight found the source checkout on `main`, identical to `origin/main`, with
only the reviewed delete-only code/docs/tests modified. Full verification passed
907 tests with two existing skips; the final read-only rescan passed 184 tests
and strict unused checking. Linked Supabase dry-run reported the remote database
up to date; there are no new or changed migration files. Therefore this release
does not execute a mutating database push. The final Git/CI receipt is recorded
in codingDO Daily `10_Daily/2026-10-30 2.md`; earlier unpushed statements above
describe the implementation stage before this authorization.
