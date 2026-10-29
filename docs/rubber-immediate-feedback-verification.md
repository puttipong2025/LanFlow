# Rubber immediate feedback — experiment ledger, 2026-10-30

Scope: the four-phase plan in codingDO `10_Daily/2026-10-30.md`.
Completed Local implementation and verification. All 18 Daily phase tasks checked
with evidence below. Cloud migration release authorized by user on 2026-10-30;
see the release receipt below. Earlier Local-only statements are historical.

## Release receipt — 2026-10-30

The user explicitly requested `push main` and `supabase db push`. Confirmed Git
target is `puttipong2025/LanFlow` main, initially equal to origin/main. Confirmed
linked Supabase project is LanFlow (`psxwhhwjmolqperxrlzj`, ap-south-1).

Dry run selected exactly `20261030010000` and `20261030011000`. Both were applied
successfully with `supabase db push --linked --yes` (exit0), and linked migration
history confirms both versions. These change the existing branch-feed projection
and search only; no reset, seed or Auth replacement was performed.

Before apply, a public-schema-only backup was saved under ignored
`output/rubber-feedback-cloud-before.sql` (1,234,712 bytes; SHA256
`761bae86d80e8781ad692ef47cafb9a6324687a4d622943d7c3bd9431d17129c`).
The CLI emitted an optional pg-delta catalog-cache certificate-file warning after
successful apply; it did not change the successful migration result. Post-apply
history and schema verification are recorded with the release logs.

## Final gates

- `npm run verify`: exit0; lint/typecheck/source/import/auth-outage checks,
  871 isolated passes/2 existing skips, optimized build, Service Worker and bundle
  guards. Initial load282.2/320kB. `output/rubber-feedback-complete-verify.log`.
- `npm run test:db`: exit0; 66 SQL files/1561 assertions and all14 concurrency
  cases. `output/rubber-feedback-complete-db.log`.
- Source diff review followed form/mutation -> durable preparation -> separate
  local presentation -> queue/approval handoff -> server feed -> table/PDF, plus
  failure/replay/tombstone paths. No unresolved finding in this review scope.
- Verdict: ship the Local-verified change with its forward migration before UI
  release; Cloud apply/deployment remains a separate authorized release action.

## Completed browser measurements

`output/rubber-feedback-browser-complete.log`: 2 browser cases passed, 1 PWA-only
case intentionally skipped in the desktop project. Twenty edit samples and twenty
delete samples hold transport independently of the local response. Each edit
holds feed GET for three more seconds after observing the local row; delete holds
feed/context for three seconds before releasing the command.

| Operation | Samples | Min | p50 | p95 | Max |
| --- | --- | --- | --- | --- | --- |
| Edit | 20 | 163 ms | 184.5 ms | 278 ms | 323 ms |
| Delete | 20 | 168 ms | 217 ms | 308 ms | 421 ms |

These are desktop Local development measurements from the Playwright final click
through visible row/control observation, after setup. The first sample is reported
in each raw array, subsequent samples are warm. This does not establish a cold
phone/PWA or Cloud latency guarantee. Raw arrays and percentile calculation are in
`output/rubber-feedback-timings.json`; all 40 observed responses were below 1s.

The same browser run tests a high-price edit requiring approval, waits for local
queue cleanup, reloads, and confirms the new proposed customer remains visible
with disabled actions. It also exercises eligible actual PDF downloads before
context/POST completion, approval-create suppression, offline create/reconnect,
no completion duplicate, and a controlled native File share boundary.

`output/rubber-feedback-edited-receipt.pdf` was rendered with Poppler to
`output/rubber-feedback-edited-receipt.png` and visually inspected: edited customer
ending `edit-20`, price 2, weight 100, payable 200, offline heading, device reference
and local eligibility label agree. No old Server approval metadata is displayed.
Physical OS share-sheet operation is not certified by the controlled API test.

## Reproduction and differential

1. Added the pending-background-edit regression in
   `tests/rubber-bill-local-feed-pagination.spec.ts`. It failed deterministically:
   proposed customer was undefined. Background merging retained Server values and
   exposed no proposed table summary. Authoritative identity was the control.
2. Source trace: mutation durable acceptance -> broad invalidation -> operational
   feed reads IDB then waits for GET -> background merge -> table. Different knobs:
   feed latency, context latency, approval eligibility, local storage failure,
   revision mismatch. Existing PDF acceptance already bypassed eligible context.
3. Competing explanations were PDF generation blocking UI, context latency, feed
   dependency, and absent approval guard. Held-context real-browser PDF sharing
   disproved a universal PDF bottleneck; the pure merge regression isolated missing
   proposal presentation independently of network latency.
4. Added compact proposed summary to background pending edits without replacing
   authoritative bill fields. The focused suite passed 44 cases. Later added
   cache handoff and revision-preservation tests; focused 69 passed before the
   handoff follow-up (latest exact totals belong to subsequent run logs).
5. Local forward migration `20261030010000_rubber_pending_update_display_summary.sql`
   enables only pending-update compact summaries outside manager approval mode.
   Five rollback-only SQL assertions pass: proposed/current values, approval lock,
   unchanged revision, and ordinary operator still denied approval mode.
6. Local full DB gate passed existing SQL tests and 14 concurrency cases. New
   summary SQL test also passed separately. Never infer Cloud state from these.
7. Initial full verification overlapped dev startup: generated Next type files
   disappeared during typecheck. Re-run sequentially. A later test type error in
   an inferred command result was corrected with object matching.
8. Full isolated run exposed four failures: an old source assertion for pre-marked
   delete, the old silent-delete-rebase expectation, and two hook mocks missing
   useQuery. Updated those for deferred durable preparation/current hook surface;
   retained the unchanged authoritative-value assertions for failed edits.
9. Matcher on a VM-realm rejected Promise returned an unexpected matcher Promise;
   capture its error result explicitly. This was test harness behavior.
10. Desktop browser baseline passed create/edit actual PDF before held context and
    POST, offline create/reconnect, approval suppression and controlled native API.
    The new edit case also holds feed GET and sees proposed values/disabled controls.
11. First 20-edit experiment: 159–285 ms visible local feedback, all 20 edits
    completed/sharing occurred. Whole test failed later because a remaining
    fixed download count expected 3 rather than samples+2. Fixed count; no product
    logic changed for this failure. Delete setup initially timed out waiting for
    the module after cold navigation; raised only setup wait, outside measured time.

## Current implementation boundaries

- Local-state query is separate from Server pagination data, preserving query
  cache shape. Current pending events project onto already loaded rows. Sort and
  editable scope remain explicit; sync-problem mode preserves its draft behavior.
- Table reads proposal summary only for presentation. Authoritative bill values,
  creation time/revision and confirmed receipt cache stay unchanged.
- Pending approval gets an explicit Rubber action guard. Mutation pending state
  blocks the active bill before the durable event is available.
- Pending-approval acknowledgement preserves display metadata in the current feed
  before removing its local event. Reload gets the summary from the existing RPC.
- Deferred delete retains the revision confirmed by the user. The worker keeps
  central stale-revision checks; UUID/prepared payload replay remains unchanged.
- Existing receipt pipeline/serial origin printer remains the sole automatic PDF
  path, including approval/unknown/nonpositive exclusions.

## Release and rollback

Apply the forward migration before releasing the new UI. The migration changes
only projection of compact fields in the existing authenticated branch feed;
tables/RLS/financial writes are unchanged. Keep the existing queue/receipt stores
and deferred-context resolver on rollback; do not downgrade or clear browser data.
Old UI ignores the additional pending-update summary. Roll back the UI first if
needed; leaving the compact summary projection in place preserves pending work.

## Scrutiny follow-up

### Fourth automatic rescan — command preparation and Route boundaries

- Traced preparation -> durable staging -> context completion -> central POST/GET
  -> receipt validation -> acknowledgement/recovery; also checked legacy delete
  restart and per-record/stock retries. Existing command identity, revision and
  branch/account checks remain in those paths; referenced helpers have callers.
- Smaller-alternative pass: keep the existing shared validators, single-flight
  and immutable retry logic; no new layer or cleanup justified without a finding.
- No additional reproducible defect found in this scan scope. Focused175 tests
  passed across local feed, background/queue/recovery, immediate PDF and the
  feed/context/queue Route error and authorization cases. Strict TypeScript
  unused-local/parameter scan exit0. No product code deleted or modified.
- Logs: `output/rubber-rescan4-focused.log`, `output/rubber-rescan4-unused.log`.
  Existing full875/build gate remains the prior full gate; no redundant build or
  database run and no new deployment/timing claim. Verdict: ship within the
  recorded Local evidence limits; no additional fix required by this rescan.

### Third automatic rescan — stale display overlays

- Reproduced an old pending local update overriding proposed table values even
  after a newer authoritative revision was loaded. A second assertion covers an
  authoritative pending request with its own current proposed summary. Regression
  failed before the fix (`output/rubber-rescan3-red.log`).
- Trace: local queue/query cache -> mergeRubberBillLocalEvents -> proposed summary
  -> table/search. The previous handoff fences were correct but the independent
  render-time overlay could bypass them.
- Hypotheses considered: late HTTP handoff, incorrect identity, and missing display
  precedence. Direct pure-function reproduction with identical identity and no
  network rules out the first two. Positive same-revision local-edit and pending
  action-lock tests provide controls. Source trace used because no attached
  debugger was available through the current tools.
- Reuse the existing merge: local pending proposal is displayed only for the
  matching authoritative revision and before Server pending approval. Otherwise
  keep the current Server proposal or current committed values. Preserve pending
  action blocking until the original command is acknowledged.
- Focused161 cases pass across feed/context/queue Route guards, queue/cache/replay,
  background mutations and local merge. Strict unused-local/parameter scan passes;
  no additional dead code proved unused. No Route/RPC/schema change or new timing
  claim. Evidence: `output/rubber-rescan3-{focused,unused,verify}.log`.
- Final full gate exit0: 875 isolated passes/2 existing skips, lint/typecheck,
  source/import/auth-outage, production build, SW and bundle guards pass
  (282.3/320kB initial load). No schema/Route changes required another DB suite.
  Verdict: ship the Local-verified display precedence fix; no unresolved reproduced
  finding remains in this scan scope. No commit/push/Cloud deployment.

### Second automatic rescan — stale approval cache receipts

- Intent: a pending-approval receipt may preserve the current matching row while
  the local command is acknowledged; it must not insert unrelated rows or revert
  an authoritative revision/request that has already advanced.
- Reproduction: two deterministic tests using a real QueryClient failed before
  the fix (`output/rubber-rescan2-red.log`): a receipt for revision1 overwrote a
  revision2 row/new pending request, and a create event inserted a row into an
  empty cached search page.
- Trace: validated central receipt -> preserveRubberApprovalInCache -> all scoped
  feed pages -> general merge. General merging inserts creates and lacked the
  revision/request fence needed for a late handoff. No debugger attachment was
  available in this tool session; source trace and the isolated real cache were
  sufficient to reach the seam without production instrumentation.
- Competing hypotheses: wrong owner scope, HTTP response validation, and cache
  merge semantics. Existing other-owner control stays unchanged; direct cache
  reproduction needs no HTTP. This isolates the latter and response ordering.
- Minimal fix: map existing rows only, require matching update/delete revision
  and pending request, and ignore create receipts when a confirmed Server bill
  already exists. Existing positive handoff remains tested. No Route/RPC/schema
  or queue identity change.
- Focused104 tests passed, covering feed/context/queue Route boundaries and queue
  integration. Strict unused-local/parameter scan passed with no new unused code;
  nothing was deleted solely for stylistic cleanup. No new timing claim.
  Logs: `output/rubber-rescan2-{focused,unused,verify}.log`.
- Final gate completed with exit0: 874 isolated passes/2 existing skips,
  lint/typecheck/source/import/auth-outage/build/SW/bundle checks passed. No database
  behavior changed, so prior SQL/concurrency gates were not redundantly rerun.
  Verdict: ship the Local-verified cache fences; no unresolved reproduced finding
  remains in this scan's Rubber feed/context/queue scope.

### Automatic rescan — proposed-value search

- Reproduced client search returning false for the displayed proposed customer
  while the authoritative customer is different. The Server RPC test also failed
  (search returned zero rows). Controls preserve original-name matching and reject
  unrelated text. This isolates matching from PDF, queue admission and network.
- Trace: input -> Module's second filter -> list filter -> feed Route validated
  search -> existing branch RPC concat. Both filters and SQL inspected only
  authoritative fields although the table now displays proposal summary fields.
- Competing hypotheses: rendering delay, local-only filter mismatch, and Server
  search mismatch. Pure function reproduction excludes rendering/network; the
  rollback-only SQL failure independently proves the Server mismatch.
- Reuse one search predicate across both client filters and include the compact
  proposed customer/date/type. Forward migration
  `20261030011000_rubber_pending_update_search.sql` adds those same fields to the
  authenticated branch RPC without changing branch/manager guards or mutations.
- Removed the unreachable delete-success approval toast branch: every mutation
  return is `{ approvalPending: false }`; the background result owns approval
  feedback. Strict TypeScript unused-local/parameter scan found no unused symbols.
- The immediate local-state query now reads queue events only; it no longer loads
  all cached receipt snapshots that its consumer does not use. Offline fallback
  continues loading snapshots where required.
- Evidence: client failing assertion and `output/rubber-scan-search-red.log`;
  after correction, focused84 passed and SQL6 passed
  (`output/rubber-scan-focused.log`, `output/rubber-scan-search-green.log`).
  Full gates from the rescan are recorded after completion below.
- The first full rescan gate failed one source-contract assertion that named the
  old private search function. Update that assertion to the shared predicate;
  retain its requirement that the online merge reapplies search. Added controls
  for original-name matching/unrelated text and a read-counter assertion proving
  online feed reads no receipt snapshots while offline fallback still reads them.
- Final rescan gates: `npm run verify` exit0, 872 isolated passes/2 existing skips,
  lint/types/build/SW/bundle passed (282.2/320kB initial load). Full database66 files,
  1562 assertions and14 concurrency cases passed; strict unused-local/parameter
  TypeScript scan exit0. Logs: `output/rubber-scan-{verify-final,db,unused-final}.log`.
  Verdict: ship the verified Local fixes with both forward migrations before UI
  release. No additional Route bug reproduced in feed/context/queue review scope;
  no Cloud apply/deploy or new phone/Cloud performance claim.

- Reused existing presentation-summary type and renderer; no new table, browser
  store, PDF renderer or share lifecycle was introduced.
- Found and corrected a new local-query cache key that would have overlapped the
  paged Server feed root: local state now has its own query key and invalidation.
- Found the render-time merge could reorder ascending work views and weaken the
  editable filter's authoritative-page fence. Restore existing sort/filter logic
  and preserve the sync-problem draft view unchanged.
- Refetch now rereads current queue events after the network response, so an
  event captured before a slow GET cannot be resurrected after terminal cleanup.
- Pending summary never spreads the draft's synthesized revision or creation
  timestamp into the authoritative bill. The table alone chooses proposed values.
- Confirmed same-render submit refs remain in the existing edit/delete dialogs.
  The mutation state also blocks the target table row before IDB acceptance.
- During the expanded delete measurement, fixture creation times aged out of the
  configured edit window near sample 17. The retained row correctly required
  approval. Refresh only fixture creation times before each sample; do not change
  the product approval window. Use a separate approval scenario for that branch.
- A second concurrent setup revoked the first test's authenticated session.
  Later runs reuse one stored session with `--no-deps`; do not diagnose that
  interference as a production uploader failure.
