# LanFlow Module Development Rules

เอกสารนี้คือกฎสำหรับสร้างโมดูลใหม่ในโปรเจกต์ LanFlow ให้เข้ากับ architecture ปัจจุบัน หลัง modularization และหลังระบบ Offline-First ของ Rubber Bills / Income-Expense ถูกยกระดับแล้ว

ให้อ่านคู่กับ:

- `docs/system-architecture-technical-summary.md`
- `docs/offline-edit-delete-lockdown-plan.md`
- `docs/rubber-bill-shipment-loop-plan.md`
- `docs/income-expense-offline-first-upgrade-plan.md`

## 1. Non-Negotiables

1. ห้ามใส่ business logic ใหญ่กลับเข้า `src/components/LanFlowApp.tsx`
2. ห้ามให้ browser ใช้ `service_role` หรือ secret key
3. ห้ามให้ client เขียน table สำคัญโดยตรง ถ้า operation ต้อง atomic, replay ได้, หรือเกี่ยวกับ offline sync
4. ห้ามสร้าง `server_bill_no` ฝั่ง client
5. ห้ามใช้เวลาจาก client เป็น source of truth ของ server timestamp
6. ห้ามลบข้อมูลจริงโดยตรงถ้าเป็น record งานธุรกิจ ให้ใช้ soft delete
7. ห้ามลบ queue ที่เป็น `failed` หรือ `conflict` อัตโนมัติ
8. ห้ามแก้ UI ตารางหลักที่ผู้ใช้ยืนยันแล้วโดยไม่แจ้งก่อน
9. ห้ามแก้ generated file เช่น `public/sw.js` ด้วยมือ
10. ทุก module ที่แตะ auth, role, RLS, offline, หรือ money relation ต้องมี test หรือ verification ชัดเจน

## 2. Folder Structure For A New Module

ถ้าสร้าง module ใหม่ชื่อ `cash-count` ให้ใช้โครงนี้เป็นค่าเริ่มต้น:

```text
src/
  components/
    cash-count/
      CashCountModule.tsx
      CashCountModal.tsx
      CashCountTable.tsx
      cash-count-display.ts
  hooks/
    useCashCounts.ts
  lib/
    cash-count/
      build-cash-count-payload.ts
  app/
    api/
      lanflow/
        cash-count/
          route.ts
supabase/
  migrations/
    YYYYMMDDHHMMSS_cash_count_schema.sql
tests/
  cash-count-offline.spec.ts
  cash-count-pwa.spec.ts
docs/
  cash-count-module-plan.md
```

กฎการแยกไฟล์:

- `*Module.tsx`: state ของหน้า, เปิด/ปิด modal, action handlers, เรียก hooks
- `*Table.tsx`: render table เท่านั้น รับ props จาก module
- `*Modal.tsx`: form เพิ่ม/แก้ไข, validation UI, ส่ง domain object กลับผ่าน `onSave`
- `use*.ts`: data fetching, mutation, optimistic state, sync queue ถ้ามี
- `lib/<module>/`: pure helper, payload builder, calculation, validator
- `api/lanflow/<module>/route.ts`: API boundary สำหรับ write ที่ต้องผ่าน server

## 3. Domain Boundary Rules

แยก domain ให้ชัดเจนเสมอ โมดูลใหม่ต้องอยู่ใน folder ของตัวเอง ไม่ปนกับ shell หรือ shared UI

```text
src/components/
  shared/          # UI กลางเท่านั้น
  lanflow/         # app shell, header, tabs, navigation config เท่านั้น
  dashboard/       # dashboard summary
  rubber-bills/    # domain: บิลยาง
  income-expense/  # domain: รายรับ-รายจ่าย
  money-transfer/  # domain: โอนเงิน
  <new-module>/    # domain ใหม่
```

### `src/components/shared/`

ใช้สำหรับ **UI primitive กลางเท่านั้น** เช่น:

- `ModalShell`
- `IconButton`
- `Field`
- `NumberField`
- `InlineNumber`
- `InlineRadio`
- `SyncStatusBadge`

กฎของ `shared/`:

- ห้าม import type เฉพาะ domain เช่น `RubberBill`, `IncomeExpense`, `MoneyTransfer`
- ห้ามเรียก hook เฉพาะ domain เช่น `useRubberBills`, `useIncomeExpense`
- ห้ามมี business rule เช่น validation บิล, คำนวณยอดเงิน, relation lock
- รับข้อมูลผ่าน props ที่เป็น primitive หรือ type กลาง เช่น `SyncStatus`
- ถ้า component เริ่มรู้เรื่อง domain ให้ย้ายไปอยู่ folder domain นั้นทันที

### `src/components/lanflow/`

ใช้สำหรับ **app shell และ navigation เท่านั้น** เช่น:

- `AppHeader.tsx`
- `NavigationTabs.tsx`
- `tabs.ts`

กฎของ `lanflow/`:

- ใช้จัด layout ระดับแอป, header, dropdown เลือกสาขา, tabs, badge count
- ห้ามมี form/table ของ module
- ห้ามมี mutation ของ domain
- ห้ามมี validation ธุรกิจของ module
- ห้าม import modal/table ของ domain ถ้าไม่จำเป็น

### Domain folders

ทุก feature ที่เป็นงานธุรกิจต้องมี folder domain ของตัวเอง เช่น:

```text
src/components/cash-count/
src/hooks/useCashCounts.ts
src/lib/cash-count/
```

กฎของ domain folder:

- component ภายใน domain เรียกใช้ shared UI ได้
- domain component เรียก domain hook ของตัวเองได้
- domain hook คุยกับ API/RPC/DB ตาม boundary ที่กำหนด
- domain logic ห้ามไหลกลับไป `shared/`, `lanflow/`, หรือ `LanFlowApp.tsx`

### Decision rule

ถ้าสงสัยว่าไฟล์ควรอยู่ที่ไหน ให้ใช้คำถามนี้:

| คำถาม | ตำแหน่งที่ควรอยู่ |
|---|---|
| เป็น UI ทั่วไปที่ไม่รู้จัก domain ใดเลย? | `src/components/shared/` |
| เป็น header, tab, navigation, app shell? | `src/components/lanflow/` |
| เป็น dashboard summary รวมหลาย module? | `src/components/dashboard/` |
| เป็นฟอร์ม/ตาราง/หน้าจอของงานธุรกิจเฉพาะ? | `src/components/<domain>/` |
| เป็น data hook ของ module? | `src/hooks/use<Domain>.ts` |
| เป็น calculation/payload/validator ของ module? | `src/lib/<domain>/` |

## 4. LanFlowApp Rules

`LanFlowApp.tsx` เป็น App Shell / Orchestrator เท่านั้น

ทำได้:

- เพิ่ม tab ใหม่ใน `src/components/lanflow/tabs.ts`
- import module ใหม่
- ส่ง `selectedLocation`, `profile`, หรือ props ระดับ app ที่จำเป็น
- คำนวณ badge count หรือ summary ระดับ app ถ้าจำเป็นจริง

ห้าม:

- ใส่ form logic
- ใส่ table logic
- ใส่ mutation logic
- ใส่ SQL/API logic
- ใส่ validation รายละเอียดของ module

## 5. Domain Model Rules

ทุก module ต้องตอบคำถาม domain ก่อน:

1. Record นี้เป็นข้อมูลแยกสาขาหรือ global?
2. Record นี้ user/admin/super_admin ใครเห็นและจัดการได้?
3. Record นี้ต้อง offline-first หรือ online-only?
4. Record นี้มีความสัมพันธ์กับโมดูลอื่นไหม?
5. ถ้าถูกใช้โดยโมดูลอื่นแล้ว แก้/ลบได้ไหม?
6. Delete เป็น soft delete หรือ hard delete?
7. ต้องมี audit fields อะไรบ้าง?

ตารางงานสาขาควรมี field มาตรฐาน:

```text
id
client_temp_id
idempotency_key
location_id
sync_status
record_status
revision_no
created_by_user_id
created_by_name
created_by_phone
client_recorded_at
server_received_at
deleted_at
deleted_by_name
deleted_by_phone
created_at
updated_at
```

ถ้า module ไม่ offline-first อาจไม่ต้องมีทุก field แต่ `location_id`, creator fields, `record_status`, timestamps ยังควรมีสำหรับข้อมูลธุรกิจ

## 6. UI Rules

ใช้ pattern ที่มีอยู่:

- Buttons ใช้ icon จาก `lucide-react` ถ้ามี
- Modal ใช้ `src/components/shared/ModalShell.tsx`
- Text/number input ใช้ shared fields ถ้าเหมาะ
- Sync status ใช้ `src/components/shared/SyncStatusBadge.tsx`
- Toast ใช้ `sonner`
- Confirm ที่เป็น action เสี่ยง ใช้ dialog/confirm ที่ผู้ใช้เห็นชัด

กฎ UX สำคัญ:

- ปุ่มที่ทำไม่ได้ให้ disable หรือกดแล้วแจ้งเหตุผล ไม่ควรเงียบ
- Action ที่ถูก block ต้องมีข้อความไทยชัดเจน เช่น `รายการนี้ถูกล็อก`
- ตารางควรอ่านง่าย กว้างพอ ไม่บีบข้อมูลธุรกิจสำคัญ
- อย่าเปลี่ยน layout ตารางหลักโดยไม่จำเป็น

## 7. Auth, Role And Permission Rules

ต้องมี guard 3 ชั้น:

1. UI guard: ซ่อนหรือ disable เมนู/ปุ่มตาม role
2. API guard: route ตรวจ auth/role ก่อนทำงาน
3. DB guard: RLS, grants, RPC permission

Role ปัจจุบัน:

```text
user
admin
super_admin
```

แนวทางทั่วไป:

- `user`: ทำงานในสาขาที่ได้รับสิทธิ์
- `admin`: จัดการข้อมูลในสาขาที่ได้รับสิทธิ์ และงานอนุมัติบางส่วน
- `super_admin`: เห็นและจัดการทุกสาขา/งาน critical

ถ้าเพิ่ม admin feature ใหม่ ให้ระบุให้ชัดว่า:

- admin ทำได้ไหม
- admin เห็นของตัวเองหรือทุกคนในสาขา
- super_admin ทำเพิ่มอะไรได้
- record ที่ approved แล้วใครแก้/ลบได้

## 8. Database And Migration Rules

ทุก schema change ต้องเป็น migration ใหม่แบบ append-only:

```text
supabase/migrations/YYYYMMDDHHMMSS_<feature>.sql
```

หลังแก้ migration ต้องอัปเดต `supabase-schema.sql` ให้ตรง snapshot ด้วย

Checklist สำหรับ table ใหม่:

- primary key เป็น `uuid default gen_random_uuid()`
- unique constraints ที่จำเป็น
- foreign keys ที่ชัด
- `record_status` ถ้าเป็นข้อมูลธุรกิจ
- `location_id` ถ้าแยกสาขา
- RLS enabled
- policies ครบ select/insert/update/delete ตามสิทธิ์จริง
- grants ไม่กว้างเกินไป
- ถ้าเขียนผ่าน RPC only ให้ `revoke all` จาก `anon, authenticated` แล้ว `grant select` เท่าที่จำเป็น

Verification:

```powershell
npx.cmd supabase db reset
npx.cmd tsc --noEmit
```

## 9. API And RPC Rules

ใช้ API Route เมื่อ:

- ต้องอ่าน session/auth ฝั่ง server
- ต้อง normalize payload ก่อนเข้า DB
- ต้องซ่อน implementation ของ RPC จาก browser
- ต้องแปลง error/status ให้ client เข้าใจง่าย

ใช้ RPC เมื่อ:

- operation ต้อง atomic
- ต้องออกเลข server-side
- ต้องตรวจ revision/idempotency
- ต้องเขียนหลาย table ใน transaction เดียว
- ต้อง enforce business rule ที่ bypass UI ไม่ได้

Pattern ที่แนะนำ:

```text
Frontend hook
  -> Next API Route
    -> Supabase RPC
      -> tables
```

API response status:

- `synced` -> HTTP 200
- `conflict` -> HTTP 409
- `failed` -> HTTP 400 หรือ 500 ตามชนิด error

## 10. Offline-First Decision Rules

ไม่ใช่ทุก module ต้อง offline-first ให้เลือกตามนี้:

ควร offline-first ถ้า:

- เป็นงาน data entry หน้างาน
- ใช้บน tablet
- ต้องสร้างข้อมูลได้แม้เน็ตหลุด
- ข้อมูลเป็น record ใหม่เป็นหลัก

ควร online-only ถ้า:

- ต้องดูสถานะ real-time ล่าสุดก่อนแก้
- มี relationship ข้ามโมดูลสูง
- เป็นงานอนุมัติ/จ่ายเงิน/โอนเงิน/approved state
- เสี่ยงข้อมูลการเงินผิดถ้า replay ภายหลัง

กฎปัจจุบันสำหรับ offline edit/delete:

- Local draft ที่ยังไม่เคย sync: แก้/ลบ offline ได้
- Record ที่ sync แล้ว: ต้อง online เพื่อแก้/ลบ
- Record ที่ relation lock แล้ว: ต้องปลด relation ก่อน
- `failed`/`conflict`: ห้ามลบ queue อัตโนมัติ

## 11. IndexedDB Queue Rules

ถ้า module เป็น offline-first ให้ใช้ `src/lib/idb-queue.ts` เป็น queue กลาง

Event ต้องมี:

```text
entity
operation: create | update | delete
payload
status: pending | failed | conflict
errorMessage
```

ต้องรองรับ:

- create replay ไม่ duplicate
- update เช็ก `expectedRevisionNo`
- delete เป็น soft delete
- idempotency key ต่อ operation/revision
- queue coalesce ถ้ามีหลาย event ของ record เดียวกัน

ใช้ `src/lib/coalesceQueueGroup.ts` ถ้า pattern ตรงกับ create/update/delete ทั่วไป

## 12. Server Number And Timestamp Rules

เลขเอกสารจริงต้องออกจาก server เท่านั้น:

- client ใช้ `localBillNo` หรือ local display id ได้
- server สร้าง `serverBillNo`
- หลัง sync แล้ว UI แสดง `serverBillNo`
- `localBillNo` ห้าม regenerate

เวลา:

- `client_recorded_at`: เวลาฝั่งเครื่อง ใช้เป็น metadata
- `server_received_at`: เวลาจริงของ server
- `created_at` / `updated_at`: ให้ DB default/trigger ดูแล

## 13. Relation Lock Rules

ถ้า record ถูกใช้ในโมดูลอื่นแล้ว ต้องตัดสินใจ lock ให้ชัด

ตัวอย่างปัจจุบัน:

- Rubber Bill ที่อยู่ใน `money_transfer_items` แก้/ลบไม่ได้
- OCR Ticket ที่อยู่ใน `money_transfer_items` แก้/ลบไม่ได้
- ต้องลบ item ออกจากรายการโอนก่อน
- RPC return `failed` พร้อมข้อความไทย เช่น `รายการนี้ถูกล็อก ต้องลบ item ออกจากรายการโอนก่อน`

กฎสำหรับ module ใหม่:

1. Relation lock ต้อง enforce ใน RPC/DB ไม่ใช่ UI อย่างเดียว
2. UI ต้องบอกเหตุผลว่าทำไมแก้/ลบไม่ได้
3. ต้องนิยามวิธีปลดล็อก เช่น remove item, cancel relation, reverse transaction
4. ต้องมี test สำหรับ locked และ unlocked path

## 14. Testing Rules

ทุก module ใหม่อย่างน้อยต้องมี:

```powershell
npx.cmd tsc --noEmit
npm run build
```

ถ้าเป็น CRUD ปกติ:

- ทดสอบ create/update/delete ผ่าน UI หรือ API ตามความเสี่ยง

ถ้าเป็น offline-first:

- `tests/<module>-offline.spec.ts`
- `tests/<module>-pwa.spec.ts`

Offline tests ควรครอบ:

- offline create -> online sync
- local draft edit/delete before sync
- replay idempotency
- failed/conflict stays in queue
- server number ไม่ซ้ำ
- soft delete

PWA tests ควรครอบ:

- login online และ bootstrap cache พร้อม
- offline
- create local record
- reload while offline
- pending row ยังอยู่
- online แล้ว sync สำเร็จ

ถ้าเปลี่ยนกติกาเดิม ให้ปรับ/skip tests ที่ยืนยัน behavior เก่า พร้อม comment เหตุผล

## 15. Documentation Rules

ทุก feature ใหญ่ควรมี doc ใน `docs/`

ควรมี:

- purpose
- scope
- domain rules
- schema/API/RPC plan
- offline decision
- role/permission
- test plan
- known risks

ถ้าเป็น decision ระดับ architecture ให้สร้าง ADR ใน `docs/adr/`

## 16. Code Review Checklist

ก่อนบอกว่า ship-ready ให้ตรวจ:

- module ไม่ทำให้ `LanFlowApp.tsx` โตผิดหน้าที่
- ไม่มี secret/service role ใน browser
- role guard ครบ UI/API/DB
- RLS/grants ตรงกับ behavior จริง
- migration reset ผ่าน
- `supabase-schema.sql` ตรง migration
- `tsc` ผ่าน
- `build` ผ่าน
- tests ที่เกี่ยวข้องผ่าน
- error message ภาษาไทยชัดเจน
- queue failed/conflict ไม่ถูกลบทิ้ง
- relation lock มีทั้ง UI และ server enforcement

## 17. Prompt Template For Next AI

ใช้ prompt นี้เมื่อต้องสั่ง AI ตัวต่อไปสร้าง module ใหม่:

```text
อ่าน docs/system-architecture-technical-summary.md และ docs/module-development-rules.md ก่อน

เป้าหมาย: สร้างโมดูล <MODULE_NAME>

ก่อนเขียนโค้ด ให้ทำ:
1. สรุป domain rules
2. ตัดสินใจว่า module นี้ offline-first หรือ online-only พร้อมเหตุผล
3. ระบุ role/permission ของ user/admin/super_admin
4. วาง schema/API/RPC plan
5. วาง test plan

กติกา:
- ห้ามใส่ business logic ใหญ่ใน LanFlowApp.tsx
- ห้ามใช้ service_role ใน browser
- ถ้าเป็น offline-first ต้องใช้ IndexedDB queue + API/RPC pattern
- ถ้ามี relation lock ต้อง enforce ใน RPC/DB
- หลังทำเสร็จต้องรัน npx.cmd tsc --noEmit และ npm run build
- ถ้ามี migration ต้องรัน npx.cmd supabase db reset
```

## 18. Quick Module Readiness Checklist

```text
[ ] มี folder module ใต้ src/components/<module>/
[ ] มี hook ใต้ src/hooks/
[ ] มี type ใน src/types/index.ts หรือ type local ที่เหมาะสม
[ ] มี API route ถ้าต้องเขียน server-side
[ ] มี RPC ถ้าต้อง atomic/replay/เลข server
[ ] มี migration ถ้าแก้ DB
[ ] มี RLS/grants
[ ] มี UI role guard
[ ] มี API role guard
[ ] มี tests ตามระดับความเสี่ยง
[ ] มี docs
[ ] tsc ผ่าน
[ ] build ผ่าน
[ ] db reset ผ่านถ้ามี migration
```
