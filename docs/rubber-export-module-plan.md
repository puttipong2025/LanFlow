# Rubber Export Module Plan

## Goal

Create an online-only branch-scoped module that groups report-locked rubber bills by a selected cutoff, preserves bill snapshots, calculates weight loss and work expense, exposes a verified source-linked expense, participates in Report Batch locks, and prints verified or deleted evidence.

## Source Ownership

- `rubber_exports` is the only source of truth for the export and its work expense.
- `rubber_export_items` reserves source bills and stores immutable bill snapshots.
- Income/Expense shows a derived read-only row. It does not create an `income_expense` row.
- Report Batch stores `entity_type = 'rubber_export'` and the export ID.
- Active references enforce deletion order. Timestamps only determine cutoff eligibility.

## Lifecycle

### Draft creation

1. User selects one cutoff bill from unreserved rubber bills held by active report items in the selected branch.
2. The server uses that item's `eligibility_at` as the cutoff.
3. The server selects every unreserved eligible rubber bill in the branch where `eligibility_at <= cutoff`.
4. Every selected bill must have:
   - `weight - deduct_weight > 0`
   - `net_total > 0`
5. One transaction rechecks candidates, assigns `REX-YYYYMMDD-001`, inserts the draft and snapshots its items.
6. The active item rows reserve their source bills immediately.

The cutoff and item membership cannot change after creation. A mistaken draft must be deleted and recreated.

### Draft editing

Only these fields are editable:

- current weight: optional; when present it must be greater than zero and no greater than the original net-after-deduction total
- work rate per kilogram: optional in a draft; a submitted value may be zero
- other operating cost: optional; blank is zero

### Verification

Only a super admin or delegated system manager can verify. Verification requires valid current weight and a submitted work rate. The reviewer chooses:

- branch expense: the export's owning branch
- external payment: no Income/Expense feed row

Verification records the reviewer and server time and makes the export immutable.

### Deletion

Only a super admin or delegated system manager can soft-delete an export.

- If an active report item references the export, deletion is blocked and returns the locking report number.
- Successful deletion records the previous status, actor, and server time.
- Active item reservations expire, allowing source reports to be deleted and bills to become eligible again after reporting.
- Deleted rows remain printable from stored snapshots.

## Calculations

All persisted numeric values use two decimal places.

```text
bill net-after-deduction weight = rubber_bills.weight - rubber_bills.deduct_weight
original weight total           = sum(item net-after-deduction weight)
paid total                      = sum(rubber_bills.net_total)
average price                   = paid total / original weight total
weight loss percent             = (original weight total - current weight) / original weight total * 100
work total                      = current weight * work rate + other operating cost
```

The server recalculates authoritative totals. Client calculations are display-only.

## Expense Visibility

A derived Income/Expense row exists only when:

- export status is `verified`
- expense destination is the owning branch
- work total is greater than zero

Display contract:

- type: `expense`
- bill option: `ค่าใช้จ่าย`
- title: `ค่าทำงานส่งออกยาง — {export_no}`
- date: `verified_at` converted to `Asia/Bangkok`
- relation source type: `rubber_export`
- relation source ID: export UUID
- read-only with a `ดูรายการส่งออกยาง` source action

Zero-value and external-payment exports remain valid and printable but do not appear in the feed or reports.

## Report Integration And Locks

### Export as report source

A qualifying derived expense becomes reportable at `verified_at`. `report_items` stores:

```text
entity_type = rubber_export
entity_id   = rubber_exports.id
```

Deleting that report deactivates its item reference and unlocks export deletion.

### Source report deletion

Before deleting a report, the server checks whether any of its active rubber-bill items are referenced by an active rubber export item. If so, deletion is blocked and returns the locking export number.

UI keeps the delete button visible but disabled:

- Report list shows the locking `REX-...`.
- Export list shows the locking `RPT-...`.

The server repeats every lock check inside the write transaction.

## Permission Matrix

| Action | Assigned admin | Super admin / system manager | User |
| --- | :---: | :---: | :---: |
| View branch exports | Yes | Yes, all branches | No |
| Preview/create/edit draft | Yes | Yes | No |
| Verify | No | Yes | No |
| Soft delete | No | Yes | No |
| Print verified/deleted | Yes, assigned branch | Yes | No |

UI guards are for experience only. API routes and security-definer RPCs recheck active user, role, delegated access, and branch scope.

## Proposed Database Contract

### `rubber_exports`

Required fields:

- identity: `id`, `export_no`, `export_date`, `sequence_no`, `location_id`
- lifecycle: `status`, `previous_status`, `cutoff_at`
- snapshot totals: `original_weight_total`, `paid_total`, `average_price`
- editable/final totals: `current_weight`, `weight_loss_percent`, `work_rate`, `other_operating_cost`, `work_total`
- expense destination: `expense_destination`
- creation audit: creator ID/name/phone and `created_at`
- verification audit: verifier ID/name/phone and `verified_at`
- deletion audit: deleter ID/name/phone and `deleted_at`

### `rubber_export_items`

Required fields:

- `export_id`, `location_id`, `source_report_item_id`, `source_bill_id`
- snapshot bill date/number/customer
- snapshot `eligibility_at`, net-after-deduction weight, and paid amount
- `active` reservation flag

Required invariants:

- unique export number per branch
- unique daily sequence per branch
- one active reservation per source bill and branch
- verified/deleted transition enforcement
- current weight cannot exceed original weight
- verified data cannot be updated

## API And RPC Boundaries

Next.js App Router endpoints remain thin authenticated wrappers over database RPCs:

- list/detail
- cutoff options and preview
- create draft
- update draft
- verify
- soft delete

All responses use `Cache-Control: private, no-store, max-age=0`.

RPC transactions own:

- authorization
- advisory locks
- deterministic cutoff selection
- validation and snapshots
- document numbering
- status transitions and audit
- relation-lock checks
- idempotent equivalent verify/delete retries

## Print Contract

Print is available for `verified` and `deleted` rows only.

The document includes:

- export number, branch, status, cutoff
- snapshot bill date, number, customer, eligibility time, weight, and paid amount
- original weight total, paid total, and average price
- current weight, loss percent, work rate, other cost, and work total
- creator and verifier audit
- deletion watermark, previous status, deleter, and deletion time when deleted

A draft deleted before completion prints missing values as `—`.

## Test Matrix

### Database and concurrency

- cutoff includes timestamp ties and earlier items across active reports in one branch
- cutoff excludes another branch, inactive report items, and already reserved bills
- invalid source weight or paid total blocks the entire create
- concurrent creates cannot reserve the same bill or duplicate an export number
- admin is branch-scoped; system manager has global access; user is denied
- verified fields are immutable
- report-to-export and export-to-report lock order is enforced
- delete releases active bill reservations without removing history

### Feed and reports

- verified branch expense with positive work total appears once
- external payment and zero work total do not appear
- no duplicate row exists in `income_expense`
- feed date uses `verified_at` in `Asia/Bangkok`
- report item references the export source
- deleting a report expires its export reference

### UI and print

- cutoff preview matches the created item set
- verification controls and disabled reasons match permissions and form state
- source navigation opens the export
- verified, deleted-verified, and deleted-draft print contracts render
- multi-page print preserves headers and deletion watermark

## Verification Commands

```powershell
npx.cmd supabase db reset --local
npx.cmd supabase db lint --local
npx.cmd tsc --noEmit
npm.cmd run build
npx.cmd playwright test --project=chromium tests/rubber-export.spec.ts
git diff --check
```

## Implemented Contract

- Migration: `20260724010000_rubber_exports.sql`
- Tables: `rubber_exports`, `rubber_export_items`
- RPCs:
  - `get_rubber_export_cutoff_options`
  - `preview_rubber_export`
  - `create_rubber_export`
  - `update_rubber_export`
  - `verify_rubber_export`
  - `delete_rubber_export`
- API base: `/api/lanflow/rubber-exports`
- Print route: `/rubber-exports/[exportId]/print`

Verified on 2026-07-24:

- local database reset and full migration replay passed
- TypeScript and production build passed
- rubber-export calculation and end-to-end contract tests passed
- Reports, Income/Expense feed, and Rubber Bill print regressions passed
- Supabase lint reported no rubber-export finding; its non-zero exit is from pre-existing findings in `sync_income_expense`, `sync_rubber_bill_core_20260716020000`, and `accept_cash_branch_difference`
