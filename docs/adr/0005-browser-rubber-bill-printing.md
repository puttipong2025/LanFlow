# ADR-0005: Rubber Bill Printing Uses a Safe Browser Receipt and Confirmed Server Status

- Status: Accepted
- Date: 2026-07-16
- Owners: LanFlow team
- Decision scope: Small-scale Rubber Bill printing
- Supersedes: ADR-0004

## Context

The product owner rejected the Android Connector/Web Share architecture. LanFlow still needs a 78mm receipt for synced small-scale Rubber Bills and needs the existing `ยังไม่ได้ปริ้น` / `ปริ้นแล้ว` database values to remain compatible.

Browsers can open a print dialog but cannot prove that paper was produced or distinguish every cancel/failure state. Direct browser writes to `rubber_bills` are also forbidden because authenticated clients have SELECT-only table grants.

## Decision

1. Support only active, synced `บิลเครื่องชั่งเล็ก` records that have a server bill number.
2. Build a pure receipt model from stored bill aggregates. Item rows are explanatory breakdowns and never replace `deduction_total` or `net_total` as financial authority.
3. Render a 78mm HTML receipt in a temporary same-origin iframe. Escape every bill/customer/item string before inserting it into HTML.
4. Wait for the print dialog to close, then ask the user to confirm that paper was produced. A canceled or unconfirmed dialog does not change business state.
5. Persist `ปริ้นแล้ว` only through `POST /api/lanflow/rubber-bills/[id]/print-status` and the idempotent `mark_rubber_bill_printed(uuid)` security-definer RPC.
6. The RPC verifies an active user, location access, and active record status. It updates only `print_status`; revision, idempotency, timestamps, and financial fields do not change.
7. Preserve `customer_id` and `deduct_weight` through the existing offline queue and sync RPC so FSC/EUDR and receipt deductions do not depend on ambiguous customer names or recomputation.

## Consequences

- Printing uses the browser/OS print dialog and requires a user confirmation before status is recorded.
- `ปริ้นแล้ว` means the user confirmed physical output; it is not browser-verified telemetry.
- Marking print status is online-only even though already-synced receipt data can be rendered locally.
- The Android Connector, Web Share `PrintJob`, Bluetooth SPP transport, and connector-local printer profile are no longer the active production architecture.
- Physical Chrome/78mm printer acceptance remains a release gate.

## Evidence

- `src/components/rubber-bills/bill-display.ts`
- `src/lib/rubber-bills/print-receipt.ts`
- `src/components/rubber-bills/RubberBillsModule.tsx`
- `src/app/api/lanflow/rubber-bills/[id]/print-status/route.ts`
- `supabase/migrations/20260716020000_rubber_bill_print_status.sql`
- `tests/rubber-bill-print.spec.ts`
