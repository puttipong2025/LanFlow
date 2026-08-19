# Rubber-related bounded read baseline and cutover evidence

Date: 2026-08-19
Environment: local Supabase/Next.js, production-like auth roles, no customer names, phone numbers, or business payloads recorded here.

## Contract matrix

| Surface | Operational contract | Bound / authority | Negative contract |
| --- | --- | --- | --- |
| Rubber Bill / Approval | One feed containing `bill` and `approval_create`; pending oldest-first | Cursor uses scoped `work_identity`; page max 150 | No raw `original_payload` or `proposed_payload`; completed approvals excluded |
| Evidence | `pending` and `history`; deep search can reach older bills | Projection is rebuildable; canonical bill/item/file/review/period rows remain write authority | No full-location canonical scan in normal list, Badge, bill page, or Telegram paths |
| Evidence cards | Five cards/page, first 75, then 50 | Two page scopes / at most ten bill details; image concurrency three | Eviction/branch change/unmount aborts work and revokes object URLs |
| Rubber Export | Mutually exclusive `active` and `history` | 50 IDs/page; live age only for visible IDs | Available bills and audit are absent from initial response |
| Branch Receipt | Searchable candidate list | 50 candidates/page; live age only for visible page | Closed/stale destination responses are ignored |
| Reports | Active report list and lazy detail | 50 reports/page; detail `.in` chunks at most 100 IDs | `isLatestActive` is branch-wide, not page-relative |
| Deletion audit | Report, Rubber Export, and Cash Count history | 50 rows/page; system manager only in RLS, API, and UI | Branch Admin/User receives 403 and sees no audit switch |

## Before/after request shape

“Before” is a source-traced baseline from commit `989ead815f2992e26c7d69da36f9240397dac49a`; it is not presented as a post-hoc runtime measurement. “After” is measured against the local cutover.

| Surface | Before cutover | After cutover |
| --- | --- | --- |
| Approval entry | Bounded bill feed plus an unbounded branch-wide marker list | One bounded operational feed; settings remain a separate small rules read |
| Evidence entry | Full Rubber Bill list + full Evidence states + overview before page detail/image work | Bounded Evidence feed + overview, then only five visible details and images |
| Badge / Telegram | Recomputed canonical Evidence history | Indexed projection aggregation |
| Export entry | Export list + all available bills + live age for the full list | One ID page + age for those IDs; options/audit requests remain zero until opened |
| Branch Receipt | One unbounded candidate RPC with live age for every candidate | One search/cursor page with page-scoped live age |
| Reports | Unbounded list/audit and unbounded URL-sized `.in` filters | 50-row cursors and 100-ID detail chunks |

## Measurements

Local measurements are useful for regression comparison, not production capacity claims.

| Workload | Result |
| --- | --- |
| Evidence UI, five cards × three weigh rows | Dedicated harness: first usable 1,424 ms; full page 1,470 ms; five detail requests; 20 image requests; maximum three concurrent image requests |
| Approval, 151 pending creates | Dedicated harness page 1: 150 rows, 141 ms, 271,755 bytes; page 2: one row, 98 ms, 1,874 bytes; 151 unique identities |
| Multi-branch actionable Badge RPC (two result rows in local fixture) | 6.44 ms, 1,717 shared-buffer hits |
| Rubber Bill operational feed, small local branch | 8.73 ms, 2,056 shared-buffer hits |
| Canonical Evidence full-state reference, small local branch | 1.05 ms, 136 shared-buffer hits |
| Bounded Evidence projection feed, small local branch | 2.70 ms, 125 shared-buffer hits |
| Telegram Evidence digest through projection | 2.81 ms, 912 shared-buffer hits |
| Rubber Export active ID page | 3.70 ms, 1,042 shared-buffer hits |
| Export age for an empty visible-ID set | 2.14 ms, 203 shared-buffer hits |
| Branch Receipt candidate page | 5.70 ms, 1,610 shared-buffer hits |

The small local Evidence fixture is too small to demonstrate an absolute latency win; the verified gain is bounded work: the projection plans and payload size no longer scale with canonical full history. The 151-row and multi-branch fixtures cover the large-queue and multi-location shapes without preserving PII.

## EXPLAIN and index decision

`EXPLAIN (ANALYZE, BUFFERS)` was captured for the operational feed, canonical and projected Evidence state, Badge, Telegram digest, Export page/age, and Branch Receipt page. The cutover adds only indexes that serve demonstrated cursor predicates:

- `private.rubber_bill_evidence_projection(location_id, review_status, client_created_at, bill_id)`
- partial Evidence history index on `(location_id, reviewed_at desc, bill_id desc)`
- existing document audit `(location_id, document_kind, deleted_at desc, id desc)` is reused

No general cache package, secured report join, or unrelated domain index was added.

## Projection migration and recovery

1. Apply append-only projection migrations.
2. Backfill by location with `private.rebuild_rubber_bill_evidence_projection`.
3. Require zero rows from the canonical drift comparison before consumer cutover.
4. Use targeted trigger refreshes for bill/item/file/review changes and set-based refresh for period boundaries.
5. If drift is detected, stop the read cutover for that location and call `public.repair_rubber_bill_evidence_projection(location_id)` as a system manager.
6. Re-run parity and authenticated Badge/Evidence smoke checks.

Rollback never deletes or rewrites business rows. Application reads can be pointed back to canonical functions while the private projection is rebuilt; append-only migrations and audit records remain intact.

## Verification evidence

- 151 mixed-size feed paging: no overlap, no omission, scoped cursor, minimal approval payload.
- Evidence page return: no repeated detail/image requests inside the two-page ring.
- Report list and audit: 51-row fixture returns 50 + 1 with no duplicate IDs; only the first branch-wide row is latest.
- Report detail chunking: a 1,001-ID fixture produces eleven chunks of at most 100 and recomposes every unique ID in order.
- Audit permission matrix: branch Admin receives 403 for Report, Rubber Export, and Cash Count; system manager receives success.
- SQL parity/repair contract: every active location reports zero drift before and after repair inside a rollback transaction.
- Fresh local replay applies all 159 migrations; the focused Chromium suite passes 34/34 and all four SQL contracts pass.
