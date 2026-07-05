# Income/Expense Offline-First Upgrade Plan

เอกสารนี้สรุปวิธีปรับโครงสร้างและโค้ดของโมดูล **รายรับ-รายจ่าย (Income/Expense)** ให้ขึ้นมาอยู่ในระดับเดียวกับ **Offline-First: Rubber Bills** โดยอิงจากโค้ดปัจจุบันหลัง modularization แล้ว

เป้าหมายคือให้ Income/Expense รองรับ **create / update / delete แบบออฟไลน์เต็มรูปแบบ**, replay ได้อย่างปลอดภัย, กันเลขบิลชน, กันข้อมูลซ้ำ, และใช้ server timestamp / server-generated number เป็น source of truth เหมือน Rubber Bills

---

## 1. Intent

ย้าย Income/Expense จากโมเดล “ยิง Supabase ตรงจาก browser” ไปเป็นโมเดล:

```text
IncomeExpenseModal
  -> useIncomeExpense
  -> IndexedDB sync_queue
  -> POST /api/lanflow/income-expense
  -> Supabase RPC sync_income_expense(payload jsonb)
  -> income_expense
```

แนวนี้ตรงกับ Rubber Bills ปัจจุบัน:

```text
RubberBillModal
  -> useRubberBills
  -> IndexedDB sync_queue
  -> POST /api/lanflow/rubber-bills
  -> Supabase RPC sync_rubber_bill(payload jsonb)
  -> rubber_bills / rubber_bill_items
```

---

## 2. Current State Trace

### Income/Expense ตอนนี้

ไฟล์หลัก:

- `src/components/income-expense/IncomeExpenseModule.tsx`
- `src/components/income-expense/IncomeExpenseModal.tsx`
- `src/hooks/useIncomeExpense.ts`
- `supabase-schema.sql`

เส้นทางปัจจุบัน:

1. `IncomeExpenseModule` เรียก `useIncomeExpense(selectedLocation.id)` แล้วส่ง `addTransaction`, `updateTransaction`, `deleteTransaction` เข้า modal/table
2. `IncomeExpenseModal` สร้าง `IncomeExpense[]` หลายรายการได้จาก form เดียว
3. `useIncomeExpense.ts` ใช้ `createSupabaseBrowserClient()` และเขียน table `income_expense` โดยตรง
4. `generateTxNo()` อ่าน `server_bill_no` ล่าสุดจาก browser แล้วบวกเลขเอง
5. `saveTxMutation` insert/update ตรง พร้อมตั้ง `sync_status = "synced"`
6. `deleteTxMutation` update `record_status = "deleted"` ตรงด้วย id

Evidence:

- `src/hooks/useIncomeExpense.ts:6` สร้าง Supabase browser client
- `src/hooks/useIncomeExpense.ts:54` มี `generateTxNo()`
- `src/hooks/useIncomeExpense.ts:73` เริ่ม `saveTxMutation`
- `src/hooks/useIncomeExpense.ts:99` ใช้ `new Date().toISOString()` ฝั่ง client
- `src/hooks/useIncomeExpense.ts:111` update ตรงเข้า `income_expense`
- `src/hooks/useIncomeExpense.ts:114` insert ตรงเข้า `income_expense`
- `src/hooks/useIncomeExpense.ts:126` เริ่ม `deleteTxMutation`
- `src/hooks/useIncomeExpense.ts:128` soft delete ตรงจาก browser
- `supabase-schema.sql:424` policy `income expense location scoped` เป็น `for all`

### Rubber Bills ตอนนี้

Rubber Bills มีระบบ offline-first ครบกว่า:

- `src/hooks/useRubberBills.ts`
- `src/lib/idb-queue.ts`
- `src/lib/coalesceQueueGroup.ts`
- `src/app/api/lanflow/rubber-bills/route.ts`
- `supabase/migrations/20260702060000_rubber_bill_sync_rpc.sql`
- `supabase/migrations/20260702070000_rubber_bills_write_via_rpc_only.sql`

พฤติกรรมที่ควรนำมาเป็น reference:

- ใช้ IndexedDB queue ผ่าน `src/lib/idb-queue.ts`
- sync ตอน online กลับมา
- coalesce event ก่อน replay
- แยก `failed` กับ `conflict`
- API route parse JSON แบบปลอดภัยก่อนเรียก RPC
- RPC เป็น atomic transaction
- RPC ตรวจ `operation`, `idempotencyKey`, `expectedRevisionNo`
- RPC สร้าง server bill number ฝั่ง database พร้อม advisory lock
- ปิด direct write จาก browser เหลือ `SELECT` เท่านั้น

Evidence:

- `src/hooks/useRubberBills.ts:76` `syncPendingBills`
- `src/hooks/useRubberBills.ts:82` normalize queue ก่อน sync
- `src/hooks/useRubberBills.ts:97` sync ผ่าน `/api/lanflow/rubber-bills`
- `src/hooks/useRubberBills.ts:133` `normalizeRubberBillQueueBeforeSync`
- `src/hooks/useRubberBills.ts:404` enqueue create/update event
- `src/hooks/useRubberBills.ts:475` enqueue delete event
- `src/app/api/lanflow/rubber-bills/route.ts:14` parse body จาก `request.text()`
- `src/app/api/lanflow/rubber-bills/route.ts:27` เรียก RPC `sync_rubber_bill`
- `supabase/migrations/20260702060000_rubber_bill_sync_rpc.sql:6` สร้าง RPC
- `supabase/migrations/20260702060000_rubber_bill_sync_rpc.sql:10` lock `search_path`
- `supabase/migrations/20260702060000_rubber_bill_sync_rpc.sql:60` revision/idempotency check
- `supabase/migrations/20260702060000_rubber_bill_sync_rpc.sql:118` ใช้ advisory lock กันเลขชน
- `supabase/migrations/20260702070000_rubber_bills_write_via_rpc_only.sql:33` revoke direct writes

---

## 3. Gap Findings

### Finding 1: Income/Expense ยังไม่ใช่ full offline-first

**Why it matters:** ถ้า tablet offline แล้วกดบันทึก รายการจะไม่ถูก queue แบบ Rubber Bills และไม่มี replay path ที่ชัดเจน

**Evidence:** `useIncomeExpense.ts` insert/update/delete เข้า Supabase browser client โดยตรง

**Fix:** เปลี่ยน mutation เป็น enqueue IndexedDB event และ merge server state + queue เหมือน `useRubberBills`

---

### Finding 2: เลขบิล server ออกใน browser จึง race ได้

**Why it matters:** tablet 2 เครื่องสร้างรายการวันเดียวกันพร้อมกัน อาจอ่านเลขล่าสุดตัวเดียวกันแล้วออก `server_bill_no` ซ้ำหรือชนกัน

**Evidence:** `generateTxNo()` ใน `useIncomeExpense.ts` query latest row แล้วบวกเลขเอง

**Fix:** ย้ายการออก `server_bill_no` ไป RPC และใช้ `pg_advisory_xact_lock(hashtext(location_id || tx_date || type))`

---

### Finding 3: Direct write policy ยังเปิดกว้างกว่า Rubber Bills

**Why it matters:** ต่อให้ UI ใช้ queue แล้ว ผู้ใช้ authenticated ยังอาจเขียน table ตรงผ่าน client ได้ ถ้า policy ยังเป็น `for all`

**Evidence:** `supabase-schema.sql:424` ใช้ policy `income expense location scoped` แบบ `for all`

**Fix:** หลัง API/RPC พร้อม ให้เปลี่ยนเป็น `SELECT` only และ `revoke all` แล้ว `grant select` เหมือน Rubber Bills

---

### Finding 4: UI มี SyncStatusBadge แต่ไม่มี error details ระดับเดียวกับ Rubber Bills

**Why it matters:** ถ้า sync ล้ม ผู้ใช้ต้องเห็นว่าเป็น `failed` หรือ `conflict` เพราะรายการรายรับ-รายจ่ายเกี่ยวกับเงินโดยตรง

**Evidence:** `IncomeExpenseModule` ส่งแค่ `status={transaction.syncStatus}` ให้ `SyncStatusBadge` และ type `IncomeExpense` ยังไม่มี `syncErrorMessage`

**Fix:** เพิ่ม `syncErrorMessage?: string` ใน `IncomeExpense`, map จาก queue event, และส่งเข้า `SyncStatusBadge`

---

## 4. Target Architecture

### New Files

```text
src/app/api/lanflow/income-expense/route.ts
src/lib/income-expense/build-income-expense-payload.ts
src/lib/income-expense/income-expense-sync.ts          # optional ถ้าต้องแยก syncPending ออกจาก hook
tests/income-expense-offline.spec.ts
tests/income-expense-pwa.spec.ts                      # optional หลัง offline dev test ผ่าน
supabase/migrations/YYYYMMDDHHMMSS_income_expense_sync_rpc.sql
supabase/migrations/YYYYMMDDHHMMSS_income_expense_rpc_only.sql
```

### Modified Files

```text
src/hooks/useIncomeExpense.ts
src/types/index.ts
src/components/income-expense/IncomeExpenseModule.tsx
src/components/income-expense/IncomeExpenseModal.tsx
src/lib/idb-queue.ts
supabase-schema.sql
docs/system-architecture-technical-summary.md
```

---

## 5. Payload Contract

สร้าง payload ให้เหมือน pattern ของ Rubber Bills แต่เรียบกว่า เพราะ `income_expense` เป็น single-row entity

```ts
type IncomeExpenseSyncPayload = {
  operation: "create" | "update" | "delete";
  expectedRevisionNo: number;
  clientTempId: string;
  idempotencyKey: string;
  locationId: string;
  recordStatus: "active" | "deleted";
  localBillNo: string;
  txDate: string;
  type: "income" | "expense";
  title: string;
  cost: number;
  billOption: "รายรับ" | "บิลขาย" | "ค่าใช้จ่าย";
  unit?: string | null;
  price?: number | null;
  clientRecordedAt: string;
  clientCreatedAt: string;
  deletedByName?: string;
  deletedByPhone?: string;
};
```

กฎสำคัญ:

- `clientTempId` ต้องคงเดิมตลอดชีวิต record
- `localBillNo` ต้องคงเดิม ไม่เปลี่ยนหลัง sync
- `serverBillNo` สร้างใน RPC เท่านั้น
- `idempotencyKey` ต้องเป็นรูปแบบ `operation:clientTempId:revision`
- `expectedRevisionNo` ใช้กัน update/delete ทับ revision ใหม่
- `clientRecordedAt` ใช้เพื่อแสดงผลและ sort ระหว่าง offline เท่านั้น
- `server_received_at` ต้องใช้ `now()` จาก database

---

## 6. Database / RPC Plan

### Phase DB-1: Add `sync_income_expense`

สร้าง migration ใหม่:

```sql
drop function if exists public.sync_income_expense(jsonb);

create or replace function public.sync_income_expense(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
-- validate auth
-- validate operation
-- validate location access
-- select existing row for update by client_temp_id
-- idempotency check
-- revision conflict check
-- create/update/delete
-- return { status, id, serverBillNo, revisionNo, serverReceivedAt, errorMessage }
$$;

revoke all on function public.sync_income_expense(jsonb) from public, anon;
grant execute on function public.sync_income_expense(jsonb) to authenticated;
```

RPC ต้องทำสิ่งเหล่านี้:

1. `private.is_active_user()` ต้องเป็น true
2. `auth.uid()` ต้องมี profile ที่ active
3. `public.can_access_location(v_location_id)` ต้องผ่าน
4. `operation` ต้องอยู่ใน `create/update/delete`
5. `bill_option` ต้องตรงกับ `type`
6. `cost > 0`
7. ถ้า `billOption = "บิลขาย"` ต้องมี `unit > 0` และ `price > 0`
8. ถ้า row มีอยู่แล้วและ `idempotency_key` ตรง ให้ return `synced` ทันที
9. ถ้า `expectedRevisionNo` ไม่ตรง ให้ return `conflict`
10. ถ้า create ใหม่ ให้ lock sequence ก่อนออก `server_bill_no`
11. ถ้า delete ให้ soft delete เท่านั้น

### Phase DB-2: Server Bill Number

ย้าย logic จาก `generateTxNo()` ไป database:

```sql
v_date := to_char((payload->>'txDate')::date, 'YYMMDD');
perform pg_advisory_xact_lock(hashtext(v_location_id::text || v_date || v_type));

select count(*) + 1 into v_next_seq
from public.income_expense
where location_id = v_location_id
  and tx_date = (payload->>'txDate')::date
  and server_bill_no is not null;

v_server_bill_no := v_date || lpad(v_next_seq::text, 4, '0');
```

Decision ที่ต้องล็อกก่อนเขียนจริง:

- ถ้า income และ expense ควรใช้ sequence ร่วมกันตาม table เดิม ให้ lock ด้วย `location_id + date`
- ถ้าต้องแยกเลขรายรับ/รายจ่าย ให้ lock ด้วย `location_id + date + type`

แนะนำเริ่มด้วย **sequence ร่วมกันตาม behavior เดิม** เพราะ `generateTxNo()` ปัจจุบันไม่ได้แยก type

### Phase DB-3: Close Direct Writes

ทำหลัง API/RPC และ E2E ผ่านแล้วเท่านั้น:

```sql
drop policy if exists "income expense location scoped" on public.income_expense;

create policy "income expense select scoped"
  on public.income_expense for select to authenticated
  using (public.can_access_location(location_id));

revoke all on public.income_expense from anon, authenticated;
grant select on public.income_expense to authenticated;
```

จากนั้น update `supabase-schema.sql` ให้ตรงกับ migration snapshot

---

## 7. Backend API Route Plan

เพิ่ม `src/app/api/lanflow/income-expense/route.ts`

ใช้ pattern เดียวกับ Rubber Bills:

1. `createSupabaseServerClient()`
2. ตรวจ session ด้วย `supabase.auth.getSession()`
3. อ่าน body ด้วย `request.text()`
4. ถ้า body ว่าง return `400`
5. JSON parse fail return `400`
6. เรียก `supabase.rpc("sync_income_expense", { payload })`
7. map status:
   - `synced` -> `200`
   - `conflict` -> `409`
   - `failed` -> `400`
   - RPC error -> `500`

ห้ามใช้ `service_role` ใน browser และไม่ควรใช้ route นี้เพื่อ bypass auth; RPC ต้องตรวจสิทธิ์ซ้ำเองเสมอ

---

## 8. Frontend Hook Plan

### Step FE-1: Add Payload Builder

สร้าง helper:

```text
src/lib/income-expense/build-income-expense-payload.ts
```

หน้าที่:

- แปลง `IncomeExpense` -> `IncomeExpenseSyncPayload`
- ใส่ `operation`
- คำนวณ `idempotencyKey`
- normalize `unit`, `price`
- ไม่สร้าง `serverBillNo`
- ไม่ใช้ `new Date()` เป็น server timestamp

### Step FE-2: Rewrite `useIncomeExpense`

เปลี่ยน hook ให้มี flow เหมือน `useRubberBills`

```text
useIncomeExpense(locationId)
  query:
    fetch server rows if online
    catch offline and continue
    read pending IDB events entity="income_expense"
    merge server rows + queue rows

  add/update:
    build payload
    coalesce pending create/update
    enqueue or update IndexedDB event
    optimistic setQueryData
    trigger sync if online

  delete:
    if pending create exists -> remove pending create, no server delete
    if pending update exists -> replace with delete preserving original expectedRevisionNo
    else enqueue delete
    optimistic hide row while pending
```

ควร reuse:

- `enqueueSyncEvent`
- `getPendingEvents`
- `removeSyncEvent`
- `updateSyncEvent`
- `coalesceQueueGroup`

### Step FE-3: Sync Function

สร้าง `syncPendingIncomeExpense(queryClient, locationId)` หรือแยกเป็น `src/lib/income-expense/income-expense-sync.ts`

ต้องมี behavior:

- ถ้า `isSyncing` อยู่แล้ว return
- ถ้า `!navigator.onLine` return
- normalize queue ก่อน sync
- precompute blocked ids จาก `failed/conflict`
- ส่งทีละ event ไป `/api/lanflow/income-expense`
- ถ้า success remove queue event
- ถ้า conflict/failed update event status + errorMessage
- ถ้า 500 หรือ network error หยุด loop เพื่อ retry รอบหน้า
- invalidate query หลัง sync จบ

### Step FE-4: Merge Queue Into UI

เวลาสร้าง optimistic transaction จาก queue:

- `syncStatus = "pending" | "failed" | "conflict"`
- `syncErrorMessage = event.errorMessage`
- `serverBillNo = undefined` ถ้ายังไม่ synced
- display ใช้ `serverBillNo ?? number ?? localBillNo`
- delete pending ให้ hide row
- delete failed/conflict ให้ show row กลับพร้อม error

ต้องเพิ่มใน type:

```ts
export type IncomeExpense = {
  ...
  syncErrorMessage?: string;
};
```

และใน table:

```tsx
<SyncStatusBadge
  status={transaction.syncStatus}
  errorMessage={transaction.syncErrorMessage}
/>
```

---

## 9. Component Plan

### IncomeExpenseModule

แก้เฉพาะ props/call signatures ไม่เปลี่ยน layout table:

- `deleteTransaction(transaction)` แทน `deleteTransaction(transaction.id)` เพื่อให้ hook ได้ `clientTempId`, `revisionNo`, `deletedBy...`
- confirm delete ควร catch error และแสดง toast ถ้า hook reject เพราะ conflict/failed/pending delete
- ส่ง `syncErrorMessage` เข้า `SyncStatusBadge`

ห้ามแก้รูปแบบตารางโดยไม่จำเป็น เพราะผู้ใช้เคยระบุว่ารูปแบบรายรับ-รายจ่ายปัจจุบันดีแล้ว

### IncomeExpenseModal

ควรแก้น้อยที่สุด:

- ยังสร้างหลายรายการจาก form เดียวได้เหมือนเดิม
- แต่แต่ละ line ต้องมี `clientTempId`, `localBillNo`, `idempotencyKey` ของตัวเอง
- ถ้า edit รายการแรกใน modal แล้วมี lines เพิ่ม ควร enqueue update สำหรับรายการแรก + create สำหรับรายการใหม่เหมือน behavior เดิม
- ไม่ต้องรู้เรื่อง API/RPC โดยตรง ให้ modal ส่ง `IncomeExpense[]` เหมือนเดิม

### Income Sale Items

ยังไม่ควรผูกกับ offline queue รอบนี้

เหตุผล:

- `income_sale_items` เป็น catalog/global setting ไม่ใช่ data-entry transaction หลัก
- การลบ/ปิดใช้งานมี RPC/permission แยกอยู่แล้ว
- ถ้าต้องใช้ dropdown offline ให้ cache sale items อ่านล่าสุดไว้ต่างหาก ไม่ใช่ sync queue เดียวกับ transaction

---

## 10. Testing Plan

### Unit / Pure Function Tests

ถ้ามี test runner สำหรับ pure function ให้เพิ่ม:

- `coalesceQueueGroup` สำหรับ `income_expense`
- payload builder:
  - create
  - update
  - delete
  - sale bill unit/price
  - normal income/expense cost

ถ้ายังไม่มี unit test runner ให้ครอบด้วย Playwright + `page.evaluate` seed IDB แบบ Rubber Bills ก่อน

### Playwright Dev Offline Test

เพิ่ม:

```text
tests/income-expense-offline.spec.ts
```

ต้อง cover:

1. offline create income -> row แสดง `รอซิงก์`
2. offline create expense -> row แสดง `รอซิงก์`
3. offline edit pending create -> coalesce เป็น create เดียว
4. offline edit synced row twice -> coalesce เป็น update เดียว
5. offline update then delete -> sync เป็น delete เดียว
6. offline create then delete -> no-op, queue ว่าง, DB ไม่เกิด row
7. replay payload เดิม -> ไม่สร้าง row ซ้ำ
8. revision conflict -> UI แสดง `conflict` พร้อม error message
9. failed event block pending events ถัดไปของ id เดียวกัน
10. server bill no ไม่ซ้ำเมื่อสร้างพร้อมกันสองแท็บ

### PWA Offline Reload Test

เพิ่มหลัง dev offline test ผ่าน:

```text
tests/income-expense-pwa.spec.ts
```

ต้อง cover:

1. build + next start
2. เปิด app online เพื่อ cache shell/bootstrap
3. offline
4. สร้างรายการรายรับ/รายจ่าย
5. reload while offline
6. app ยังโหลดได้
7. row pending ยังอยู่
8. reconnect แล้ว sync สำเร็จ

### Commands

```powershell
npx.cmd tsc --noEmit
npm run build
npx.cmd playwright test tests/income-expense-offline.spec.ts --project=chromium
$env:PW_PROJECT="pwa"; npx.cmd playwright test tests/income-expense-pwa.spec.ts --project=chromium-pwa
```

---

## 11. Rollout Phases

### Phase 0: Baseline And Contract

- อ่าน `IncomeExpenseModule`, `IncomeExpenseModal`, `useIncomeExpense`
- เขียน payload contract
- เพิ่ม `syncErrorMessage?: string` ใน type
- ยังไม่แก้ behavior

Verification:

```powershell
npx.cmd tsc --noEmit
```

### Phase 1: Add RPC And API While Keeping Direct Hook

- เพิ่ม migration `sync_income_expense`
- เพิ่ม API route `/api/lanflow/income-expense`
- ยังไม่เปลี่ยน `useIncomeExpense`
- test API ด้วย payload manual หรือ Playwright helper

Verification:

```powershell
npx.cmd supabase db reset
npx.cmd tsc --noEmit
```

### Phase 2: Convert Hook To Queue

- rewrite `useIncomeExpense`
- ใช้ `idb-queue` entity `income_expense`
- ใช้ `coalesceQueueGroup`
- merge queue into UI
- sync through API route

Verification:

```powershell
npx.cmd tsc --noEmit
npx.cmd playwright test tests/income-expense-offline.spec.ts --project=chromium
```

### Phase 3: Lock Down DB Writes

- drop `for all` policy
- revoke all direct table writes
- grant select only
- grant execute on RPC
- update `supabase-schema.sql`

Verification:

```powershell
npx.cmd supabase db reset
npx.cmd playwright test tests/income-expense-offline.spec.ts --project=chromium
```

### Phase 4: PWA Offline Reload

- add PWA test
- verify app shell + bootstrap cache + IDB queue survive reload

Verification:

```powershell
npm run build
$env:PW_PROJECT="pwa"; npx.cmd playwright test tests/income-expense-pwa.spec.ts --project=chromium-pwa
```

### Phase 5: Documentation And Cleanup

- update `docs/system-architecture-technical-summary.md`
- mark Income/Expense as full offline-first only after tests pass
- remove stale notes that say Income/Expense is online/direct-write

---

## 12. Non-Negotiable Rules

- ห้ามใช้ `service_role` ใน browser
- ห้ามออก `server_bill_no` ใน browser
- ห้ามเปลี่ยน `localBillNo` หลังสร้างแล้ว
- ห้ามใช้เวลาเครื่องเป็นเวลาหลักของ server state
- ห้ามเปิด direct write ไว้หลัง cutover เป็น RPC แล้ว
- ห้ามลบจริง ให้ soft delete เท่านั้น
- ห้าม sync ทับ row ที่ revision ไม่ตรง
- ห้ามลบ queue event ที่ `failed/conflict` จนกว่าผู้ใช้หรือระบบจะ resolve
- ห้ามแก้ UI table รายรับ-รายจ่ายโดยไม่จำเป็นใน phase นี้
- ห้ามปนงาน catalog `income_sale_items` กับ transaction sync queue

---

## 13. Ship Criteria

Income/Expense จะถือว่าอยู่ระดับเดียวกับ Rubber Bills ได้เมื่อครบทุกข้อ:

- `useIncomeExpense` ไม่ insert/update/delete Supabase ตรงจาก browser อีกแล้ว
- create/update/delete offline ได้
- reload offline แล้วยังเห็น pending rows
- reconnect แล้ว sync อัตโนมัติ
- replay payload เดิมไม่สร้าง row ซ้ำ
- concurrent create ไม่ชนเลขบิล
- conflict/failed แสดงใน UI พร้อม error message
- `income_expense` table ให้ authenticated `SELECT` เท่านั้น
- RPC มี `security definer`, `set search_path = public`, revoke public/anon, grant execute to authenticated
- `supabase db reset` ผ่าน
- `tsc --noEmit` ผ่าน
- Playwright dev offline test ผ่าน
- Playwright PWA offline reload test ผ่าน

Verdict: **fix-then-ship**. งานนี้ควรทำเป็น phase แยก ไม่ควรแทรกเป็น refactor เล็ก ๆ เพราะต้องเปลี่ยน persistence path, RLS, API, queue semantics และ E2E coverage พร้อมกัน
