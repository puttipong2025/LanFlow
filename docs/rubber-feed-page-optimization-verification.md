# Rubber feed page decoration — 2026-10-30

Local delivery and Cloud feed rollout complete after the separate actor-helper
release. Production peak-load performance remains unmeasured; the short natural
traffic observation is recorded separately from controlled Local SQL evidence.

## Root cause and design

Nested EXPLAIN ANALYZE on the offline real-data clone found the default latest
page constructing item JSON and transfer/report metadata for 2,509 active bills
before returning 100. Item/transfer subplans each looped 2,509 times; the traced
request took 3,330.58 ms with instrumentation. This is diagnostic timing,
not an uninstrumented latency benchmark.

Migration 20261030021000 keeps candidate identity, sort timestamp and the exact
selected pending approval ID before cursor/filter/order/page selection. It then
constructs the original JSON for visible rows only, joining the same bill and
approval IDs in the same statement snapshot. All membership-affecting predicates
remain before pagination. No response, permissions, search, refresh interval,
cache, client component or mutation behavior changes.

## Regression and differential

- New pgtap test seeds 220 synthetic bills and instruments the real report-lock
  decoration in a rollback transaction. Before: one failure/9, 220 decorations
  for a ten-row page. After: 9/9, exactly ten. Includes page order, cursor,
  duplicate exclusion, search before page and report filter behavior.
- First exploratory offline differential: 158 complete JSON responses equal
  across largest three branches, latest/unpriced/pending modes, four document
  filters, missing search and cursors. Sum SQL times 32,774.655 → 12,734.245 ms.
  This initial sample lacked synthetic pending approvals and used the older
  clone baseline, so it is not the final current-contract gate.
- Final harness scripts/measure-rubber-feed-pages.mjs explicitly installs the
  current pre-change definition inside the rollback transaction, adds mixed
  pending create/update/delete fixtures, proposed-value and missing searches,
  and compares complete JSON including pages/cursors/summary fields. Reversed
  order is a separate run. Both leave the clone untouched.
- SQL suite after Local apply: 68 files / 1591 assertions PASS.
- Superseded current-contract differential: 237 complete JSON cases matched,
  but rollback rehearsal caught a missing cursor-work-identity parameter in the
  draft control restore. It created an unintended overload in the rollback-only
  transaction, so that ordering comparison cannot establish performance or a
  current-control equivalence gate. Fixed the signature, proved exact original
  definition and ACL restoration, and reran both orders. Original failed/
  superseded output is retained in the ledger; no Cloud feed change occurred.
- Candidate nested plan on the same large branch: item and transfer decoration
  loops exactly 100 instead of 2,509; 11,371 total buffer hits instead of
  110,150 in the earlier traced request. Instrumented request 140.35 ms versus
  3330.58 ms control. These isolated traced runs demonstrate reduced work,
  not a controlled Cloud before/after speed promise.

No request coalescing or refresh interval change is included: the measured
SQL over-decoration is independently sufficient to justify this bounded change.
Current refresh/invalidation is left intact to preserve freshness. Broader
request changes would require their own race/freshness evidence and are not
silently bundled with this migration.

### Corrected final comparison

After exact seven-argument control-restore verification, both fresh offline
runs pass all 237 complete-JSON comparisons. Control→candidate total SQL
36,283.649→13,258.463 ms (63.46% less); candidate→control ordering yields
control33,417.632/candidate13,287.583 ms (60.24% less). Latest mode totals
35,141.741→12,168.986 and 32,345.043→12,253.498 ms respectively. Unpriced
and approval-mode aggregate times do not regress in these corrected runs.
These are fixed-condition SQL sums, not click-to-DOM or Cloud percentages.

Artifacts: output/rubber-feed-differential-fixed{,-reversed}-run.log and
output/rubber-feed-page-differential{,-reversed}.json. The earlier incorrect
ordering samples remain in separate superseded logs. Exact Local rollback
restoration and owner/ACL/STABLE/security-definer/search_path checks pass;
only the seven-argument public function exists after the rehearsal.

## Ledger and scope limits

- Initial count-test fixture attempted a second super_admin and correctly hit
  the singleton constraint; changed fixture to elevated admin.
- Initial mixed approval fixture had a non-null original payload for create;
  shape constraint correctly rejected it. Fixed the fixture, not the schema.
- Exact rollback verification caught the draft signature mismatch described
  above. Both source and caller use the full seven-argument signature now;
  Local rollback rehearsal restored the exact old function and left no overload.
- Candidate mixed HTTP: 40 clients confirmed80/80, median/p95 279.55/1057.24 ms,
  no read retry/errors; 80 clients160/160, 381.97/4771.73 ms, one retained raw
  ECONNRESET recovered by the existing query retry policy, zero final errors.
  Compared with the post-actor/pre-feed r3 control samples, no tail regression
  was observed in these runs. Fixtures have100 seeded headers, so these are
  compatibility/load evidence, not the large-branch SQL gain measurement.
- No failure is counted as a successful run. Raw output remains ignored under
  output/. No copied customer values or production rows belong in this report.
- Local tests, mixed logical-client loads and offline SQL results are separate
  from production peak-load and click-to-DOM claims. Actor release remains the
  independent baseline; no changes to its helpers are part of this migration.

Rollback: scripts/rollback-rubber-feed-page-decoration.sql. It restores only
the old function definition and preserves owner/ACL, data and command receipts.

## Final Local gate and Cloud preparation

- Browser five cases pass: two devices/branch leave/manager/PDF ordering,
  offline editable draft/reconnect, and three click-to-confirm saves
  1320.78/1587.25/1348.95 ms. Those saves are not a40-browser load result.
- Concurrency14 pass after the feed change. Offline clone verification again
  confirms93 unchanged table fingerprints, zero FK violations, network none
  and cron off. Current Local snapshot synchronized from actual pg_dump.
- Exact rollback compares the complete previous definition and security
  attributes, then rolls that rehearsal back to leave the candidate installed.
- Cloud preflight matches the tested original feed, preserves the already
  deployed actor helper hashes, and selects only20261030021000. Strict-TLS
  read-only public/private schema backup:1616200 bytes, SHA256
  a281801fae0a696bc4916d3445134680e1f2b56164a31e937c2eea3e8c322ea1.
- Preflight is preparation only; successful actual apply/parity and read probes
  must be recorded separately before claiming a Cloud feed release.

## Cloud release receipt

- After full verify875pass/2existing skips, build/SW/bundle282.3/320kB,
  SQL1591, concurrency14 and browser5 passed, applied only20261030021000.
- Actual Cloud feed MD5 matches the tested Local candidate; owner/ACL/STABLE/
  security-definer/search_path unchanged. Actor helper hashes are unchanged
  from their separately verified release. No polling/cache/UI or web deployment
  change is required for this SQL-only release.
- Read-only probes on three large real branches across latest/unpriced/pending
  modes and next-page cursors:12 pass, expected branch identities, no duplicates
  across adjacent pages. No business fixtures or load tests were written Cloud.
- Immediate observation: zero unfinished queue jobs. Optional pg-delta catalog
  cache certificate-file warning appeared after successful CLI apply; separate
  strict-TLS SQL confirms the real migration and function definitions.
- Receipts: output/rubber-feed-cloud-{preflight,release,observation}.json;
  apply log output/rubber-feed-cloud-apply.log. A natural observation window
  does not establish a production peak SLA or a60–63% Cloud speed improvement.
- Natural traffic window05:59:55–06:07:36UTC:48feed RPC calls, mean SQL115.99ms,
  zero unfinished commands;6new create commands all synced with no error codes;
  243successful cron runs since release. Login200/unauthenticated queue401.
  This is not a controlled before/after comparison and excludes HTTP/DOM time.
