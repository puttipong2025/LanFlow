# Rubber Bill Shipment Loop Plan

## Goal

Make the LanFlow rubber bill module ready for shipment by tightening the real data flow, permissions, validation, and verification path without changing unrelated modules.

## Locked Decisions From Product Owner

These decisions are confirmed and should not be re-litigated during implementation unless the product owner changes them explicitly.

1. **Rubber bill permissions:** `admin` and `user` can both create, edit, and delete rubber bills.
2. **Debt deductions:** rubber bills can have multiple debt deduction rows.
3. **Database persistence:** use Option B. Move save/delete logic to RPC or a Next API route so offline replay can run as one atomic transaction, prevent duplicate bill numbers, and prevent half-saved parent/child data.
4. **Offline-first:** full offline create/edit/delete for rubber bills is required for shipment. Task 5 must be implemented, not only documented.
5. **Customer autocomplete:** the customer name search must show all legacy/global customers in the system. Branch-scoped customers should still remain protected by branch access rules unless a later decision says otherwise.

## 1. Module Structure Read

Primary files:

- `src/components/LanFlowApp.tsx`
  - `RubberBillsModule`: table, search, pagination, edit/delete actions.
  - `RubberBillModal`: customer autocomplete, payment responsibility, weigh rows, acid deductions, debt deductions, summary, submit.
- `src/hooks/useRubberBills.ts`
  - Loads `rubber_bills`.
  - Loads child rows from `rubber_bill_items`.
  - Saves header and child items directly through the Supabase browser client.
  - Soft-deletes bills by setting `record_status = 'deleted'`.
- `src/hooks/useCustomers.ts`
  - Loads customers and related contact/bank/farm rows.
  - Feeds the autocomplete used inside `RubberBillModal`.
- `src/types/index.ts`
  - Defines `RubberBill`, `PaymentResponsibility`, and child item shapes.
- Supabase:
  - `rubber_bills`
  - `rubber_bill_items`
  - `customers`
  - `customer_contacts`
  - `customer_bank_accounts`
  - `customer_farms`
  - RLS functions/policies around `can_access_location`, `is_super_admin`, and active user checks.
- Existing docs:
  - `docs/rubber-bill-pwa-workflow.md`
  - `docs/gas-crud-findings-and-lanflow-plan.md`
  - `docs/project-overview.md`

Important observation:

- The document `rubber-bill-pwa-workflow.md` describes a flow through `/api/lanflow/rubber-bills` and Offline Queue, but the current code path in `useRubberBills.ts` writes directly from the browser Supabase client to `rubber_bills` and `rubber_bill_items`.
- Customer autocomplete depends on `useCustomers()`. If admin/user cannot see customer rows because of RLS or missing global/customer policies in the actual DB or schema snapshot, the dropdown will be empty even though super_admin sees it.

## 2. Current Understanding

The rubber bill module currently supports:

- Table view with search, page size, pagination, and action buttons.
- Add/edit modal.
- Customer autocomplete by `customers.mainName` or `legacyMemberId`.
- Multiple weigh rows.
- Up to 2 acid deduction rows.
- Multiple debt deduction rows in UI, even though the original requirement previously said debt should be one row.
- Auto-calculated:
  - net weight per weigh row
  - gross rubber value
  - average price
  - acid deduction
  - debt deduction
  - weight deduction value
  - net payable
  - branch/head-office payment split
- Persisting parent-child data:
  - parent: `rubber_bills`
  - child: `rubber_bill_items`

Main shipment risks:

- Customer autocomplete for `admin`/`user` may be blocked by RLS or by schema/migration drift.
- `useRubberBills.ts` does direct browser writes. This can be okay if RLS is correct, but it conflicts with the existing PWA/API documentation and makes server-side bill-number generation/concurrency harder.
- Server bill number generation is client-side query + next sequence. Two devices can race and generate the same next number unless the DB enforces uniqueness and/or server RPC assigns numbers atomically.
- `rubber_bill_items` are deleted and reinserted on every save. If item delete/insert fails halfway, parent and child data can become inconsistent.
- Delete only sets `record_status = 'deleted'` but the query does not currently filter deleted rows out, so deleted bills may still appear unless RLS/view/query excludes them.
- Validation is incomplete for shipment: empty customer, zero/negative weight, zero/negative price, invalid deductions, and net total edge cases need explicit handling.
- Docs and code disagree on offline-first behavior.

## 3. Task Plan

### Task 1 — Confirm And Fix Customer Autocomplete For Admin/User

Scope:

- Trace `RubberBillModal` autocomplete:
  - `useCustomers()`
  - `matchingCustomers`
  - `showDropdown`
  - RLS policies on `customers` and child tables
- Verify whether `20260702040000_customer_global_select_policy.sql` is applied locally and represented in `supabase-schema.sql`.
- If admin/user still do not see dropdown:
  - Query policies from `pg_policies`.
  - Confirm admin/user profile is active.
  - Confirm admin/user has `user_locations`.
  - Confirm test customer has `default_location_id` matching assigned location or `default_location_id is null`.

Expected fix:

- Ensure active authenticated users can read legacy/global customers where `default_location_id is null`.
- Ensure the autocomplete can query all legacy/global customer records for `super_admin`, `admin`, and `user`.
- Ensure branch-scoped customers remain visible only to users who can access that branch.
- Update `supabase-schema.sql` if migration exists but schema snapshot is missing the new policies.

Do not:

- Make all customers globally writable.
- Bypass RLS with service role in the browser.

Verification:

- Login as `super_admin`, `admin`, and `user`.
- Open rubber bill modal.
- Type a known customer name and legacy member id.
- Confirm dropdown appears for allowed records.
- Confirm disallowed branch-scoped customers remain hidden.

### Task 2 — Align Rubber Bill Persistence Strategy

Locked shipment path:

- Use RPC or Next API route for rubber bill save/delete.
- Keep browser hook as a thin caller.
- Make one transaction handle:
  - generate or keep server bill number
  - upsert parent bill
  - replace child items
  - set `server_received_at = now()`
  - increment `revision_no`
  - return saved bill with child items

Why:

- Prevent duplicate server bill numbers.
- Prevent partial parent/child saves.
- Keep security and business rules in one place.

Concrete tasks:

- Add DB uniqueness for real bill numbers:
  - unique active bill number per `location_id`, `bill_date`, `server_bill_no` or `bill_no`.
- Create `save_rubber_bill(payload jsonb)` RPC or `POST /api/lanflow/rubber-bills`.
- Move sequence generation into DB transaction.
- Make child item replacement transactional.
- Add delete RPC/API that only soft-deletes and records deleted metadata.
- Ensure replaying the same offline operation is idempotent through `clientTempId` and/or `idempotencyKey`.
- Ensure `admin` and `user` are allowed by the RPC/API if they can access the bill location.

Verification:

- Submit the same `clientTempId` twice: should update same bill, not duplicate.
- Submit two bills from parallel sessions: should get different server bill numbers.
- Force child insert failure in dev: parent should not be partially changed.

### Task 3 — Filter And Handle Deleted Bills Correctly

Scope:

- `useRubberBills.ts` currently queries `rubber_bills` by `location_id` and does not explicitly filter `record_status`.
- Delete mutation updates `record_status = 'deleted'`.

Required behavior:

- Active table should show only `record_status = 'active'`.
- Deleted bills should remain in DB for audit/history.
- If a deleted/history view is needed later, build it separately.

Implementation:

- Add `.eq("record_status", "active")` to normal list query.
- When deleting, set:
  - `record_status = 'deleted'`
  - `deleted_at = now()` from server side if using RPC/API
  - `deleted_by_name`
  - `deleted_by_phone`
  - `revision_no = revision_no + 1`

Verification:

- Delete a bill.
- Confirm it disappears from main table.
- Confirm row remains in DB with `record_status = 'deleted'`.

### Task 4 — Tighten Form Validation

Validation rules:

- Customer name is required.
- At least one weigh row is required.
- Every active weigh row must have:
  - `inWeight > outWeight`
  - `netWeight > 0`
  - `price > 0`
- Acid rows:
  - maximum 2 rows.
  - each row must have `name`, `quantity > 0`, `unitPrice >= 0`.
- Debt rows:
  - allow multiple rows.
  - each row must have `title` and `amount > 0`.
- Deductions cannot make net payable negative.
- Payment responsibility must be one of:
  - `สาขานี้จ่าย`
  - `สาขาใหญ่จ่าย`
- Bill type should be controlled, not an arbitrary hidden string.

Implementation:

- Extract validation into a small pure helper, e.g. `validateRubberBillDraft`.
- Return a list of human-readable errors.
- Show errors in the modal instead of only `alert`.

Verification:

- Save with empty customer: blocked.
- Save with zero price: blocked.
- Save with outWeight >= inWeight: blocked.
- Save with acid/debt deduction larger than gross: blocked.
- Save valid bill: succeeds.

### Task 5 — Reconcile Offline-First Docs With Current Code

Problem:

- Existing docs say rubber bills use offline queue and API.
- Current code path writes direct to Supabase and does not enqueue rubber bill events in `use-offline-queue`.

Required shipment behavior:

- Implement full offline create/edit/delete for rubber bills.
- Local UI must accept actions while offline and persist them locally.
- Each queued operation must include enough data to replay later:
  - `clientTempId`
  - `localBillNo`
  - `idempotencyKey`
  - `operation`
  - `revisionNo`
  - `clientRecordedAt`
  - selected `locationId`
  - full bill payload including child items
- When online returns, background sync must replay pending operations through the atomic RPC/API from Task 2.
- Sync success must update:
  - `serverBillNo`
  - `serverReceivedAt`
  - `syncStatus = 'synced'`
- Sync failure must preserve the local queued item with `syncStatus = 'failed'` and a useful error message.
- Conflict must not silently overwrite data; mark `syncStatus = 'conflict'` if server revision does not match.

Verification:

- Build passes.
- Manual offline test must pass:
  - browser offline
  - create bill
  - edit bill
  - delete bill
  - reload
  - reconnect
  - confirm all pending operations sync in order
  - confirm duplicate replay does not create duplicate bills

### Task 6 — Add Shipment Tests / Smoke Checks

Minimum automated checks:

- `npx.cmd tsc --noEmit`
- `npm.cmd run build`
- `npx.cmd supabase db push --local`

Recommended DB checks:

```sql
select policyname, cmd
from pg_policies
where schemaname = 'public'
  and tablename in ('rubber_bills', 'rubber_bill_items', 'customers');
```

Manual browser checks:

- Login as `super_admin`:
  - open rubber module
  - autocomplete works
  - create bill
  - edit bill
  - delete bill
- Login as `admin` assigned to location A:
  - sees location A bills/customers only
  - autocomplete works for allowed customers
  - can create/edit/delete rubber bills
- Login as `user` assigned to location A:
  - sees allowed customers
  - can create/edit/delete rubber bills
  - cannot access other branch data
- Login as `admin/user` not assigned to location B:
  - cannot see location B bills/customers

### Task 7 — UI Polish Only After Data Is Correct

Only after Tasks 1-6 pass:

- Make empty states explicit:
  - no customers found
  - loading customers
  - no bills
- Disable submit while save is in progress.
- Replace plain `alert` with toast or inline error area.
- Keep table layout stable on mobile/desktop.
- Do not change unrelated income/expense table layout.

## 4. Loop Engineering Execution Order

1. Run baseline checks:
   - `npx.cmd tsc --noEmit`
   - `npm.cmd run build`
   - `npx.cmd supabase db push --local`
2. Fix autocomplete/RLS first.
3. Re-run checks.
4. Fix list/delete behavior for `record_status`.
5. Re-run checks.
6. Add validation helper and UI error display.
7. Re-run checks.
8. Decide persistence strategy:
   - If keeping direct Supabase writes: add uniqueness and tighten RLS.
   - If moving to RPC/API: implement atomic save/delete.
9. Re-run checks and manual browser smoke test.
10. Update docs to match real shipped behavior.

Rule:

- Finish one task, verify, then move to the next. Do not rewrite the whole module in one pass.

## 5. Security Risks To Watch

- Do not use `service_role` in browser code.
- Do not make customer data globally writable.
- Do not allow branch users to read/write rubber bills for locations outside `user_locations`.
- Avoid direct hard delete for rubber bills; use soft delete with audit fields.
- If using `security definer` RPC, always:
  - `set search_path = public`
  - `revoke all on function ... from public`
  - grant only needed roles
  - check `auth.uid()`/profile role/location inside the function

## Open Grill Questions

No open product questions remain for the shipment plan.

Implementation can proceed with the locked decisions above. If a technical ambiguity appears, ask only about that specific technical choice, not the already-confirmed product behavior.
