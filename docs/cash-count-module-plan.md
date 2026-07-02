# Cash Count Module Plan

## Goal

สร้างโมดูล `นับเงิน` สำหรับ LanFlow เพื่อให้แต่ละสาขาบันทึกยอดเงินสดที่นับได้จากธนบัตร/เหรียญไทย เทียบกับยอดเงินในบัญชีและยอดเงินในระบบ แล้วให้ `super_admin` เป็นผู้ยืนยันรายการขั้นสุดท้าย

โมดูลนี้ต้องเหมาะกับงานหน้าลาน ใช้งานบน tablet ได้เร็ว และสอดคล้องกับแนวทาง PWA/offline-first ของโปรเจกต์

## Scope

### In Scope

- มี tab/module ใหม่ชื่อ `นับเงิน`
- มีตารางแสดงรายการนับเงิน
- มีปุ่มเพิ่มข้อมูล เปิด form/modal
- Form กรอกจำนวนธนบัตร:
  - 1000
  - 500
  - 100
  - 50
  - 20
- Form กรอกจำนวนเหรียญ:
  - 10
  - 5
  - 2
  - 1
- Form กรอก:
  - ยอดเงินในบัญชี
  - ยอดเงินในระบบ
- ระบบคำนวณ:
  - ยอดเงินสดที่นับได้
  - ยอดรวมเงินสด + เงินในบัญชี
  - ยอดแตกต่าง
- แก้ไขได้
- ลบได้
- มีปุ่ม `ยืนยันรายการ`
- `ยืนยันรายการ` ทำได้เฉพาะ `super_admin`
- เมื่อยืนยันแล้ว `admin` และ `user` ห้ามแก้ไข/ลบ

### Out of Scope รอบแรก

- ไม่ต้องทำรายงาน PDF
- ไม่ต้องผูกบัญชีธนาคารจริง
- ไม่ต้องดึงยอดเงินในระบบอัตโนมัติจากโมดูลรับ-จ่ายทันที
- ไม่ต้องทำ multi-currency

## Calculation

### Denomination Total

```text
cash_total =
  (banknote_1000_count * 1000) +
  (banknote_500_count * 500) +
  (banknote_100_count * 100) +
  (banknote_50_count * 50) +
  (banknote_20_count * 20) +
  (coin_10_count * 10) +
  (coin_5_count * 5) +
  (coin_2_count * 2) +
  (coin_1_count * 1)
```

### Counted Total

```text
counted_total = cash_total + account_balance
```

### Difference

```text
difference_amount = counted_total - system_balance
```

ตรงกับ requirement:

```text
((ยอดเงินเหรียญแต่ละประเภท * จำนวนที่นับได้)
 + (ธนบัตรแต่ละประเภท * จำนวนที่นับได้)
 + ยอดเงินในบัญชี
 - เงินในระบบ)
```

## Roles And Permissions

| Action | user | admin | super_admin |
| --- | --- | --- | --- |
| ดูรายการในสาขาที่ได้รับสิทธิ์ | yes | yes | yes |
| เพิ่มรายการ | yes | yes | yes |
| แก้ไขรายการที่ยังไม่ยืนยัน | own/scoped | scoped | yes |
| ลบรายการที่ยังไม่ยืนยัน | own/scoped | scoped | yes |
| ยืนยันรายการ | no | no | yes |
| แก้ไขรายการที่ยืนยันแล้ว | no | no | optional/super_admin only |
| ลบรายการที่ยืนยันแล้ว | no | no | yes |

Decision:

- `admin` เห็นและจัดการรายการตามสาขาที่ตนมีสิทธิ์ได้ แต่ยืนยันไม่ได้
- `user` เพิ่มรายการได้ตามสาขาที่ตนมีสิทธิ์
- หลัง `confirmed` แล้ว `user/admin` ห้ามแก้ไข/ลบทุกกรณี
- `super_admin` เป็นคนเดียวที่ยืนยัน และเป็นคนเดียวที่ลบรายการ confirmed ได้

## Data Model

### Table: `cash_counts`

```sql
create table public.cash_counts (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id),

  count_date date not null default current_date,
  note text,

  banknote_1000_count integer not null default 0 check (banknote_1000_count >= 0),
  banknote_500_count integer not null default 0 check (banknote_500_count >= 0),
  banknote_100_count integer not null default 0 check (banknote_100_count >= 0),
  banknote_50_count integer not null default 0 check (banknote_50_count >= 0),
  banknote_20_count integer not null default 0 check (banknote_20_count >= 0),

  coin_10_count integer not null default 0 check (coin_10_count >= 0),
  coin_5_count integer not null default 0 check (coin_5_count >= 0),
  coin_2_count integer not null default 0 check (coin_2_count >= 0),
  coin_1_count integer not null default 0 check (coin_1_count >= 0),

  cash_total numeric(12,2) not null default 0,
  account_balance numeric(12,2) not null default 0,
  system_balance numeric(12,2) not null default 0,
  counted_total numeric(12,2) not null default 0,
  difference_amount numeric(12,2) not null default 0,

  status text not null default 'draft'
    check (status in ('draft', 'pending', 'confirmed', 'deleted')),

  confirmed_at timestamptz,
  confirmed_by uuid references public.profiles(id),

  client_temp_id text,
  idempotency_key text unique,
  sync_status text not null default 'synced'
    check (sync_status in ('pending', 'synced', 'failed', 'conflict')),

  created_by_user_id uuid not null references public.profiles(id),
  created_by_name text not null,
  created_by_phone text not null,
  updated_by_user_id uuid references public.profiles(id),
  deleted_by_user_id uuid references public.profiles(id),
  delete_reason text,
  deleted_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### Computed Totals

รอบแรกให้คำนวณ totals ใน API ก่อน insert/update เพื่อให้ table โหลดเร็วและ query ง่าย

ภายหลังถ้าต้องการความแข็งแรงขึ้น ค่อยเพิ่ม database trigger เพื่อคำนวณ `cash_total`, `counted_total`, `difference_amount` ซ้ำฝั่ง PostgreSQL

## API Plan

### `GET /api/lanflow/cash-counts`

Query params:

- `locationId`
- `dateFrom`
- `dateTo`
- `status`

Returns:

- รายการนับเงินของสาขาที่ user มีสิทธิ์
- `super_admin` ดูได้ทุกสาขา

### `POST /api/lanflow/cash-counts`

ใช้สำหรับ create

Input:

- denomination counts
- `account_balance`
- `system_balance`
- `note`
- `location_id`
- `client_temp_id`
- `idempotency_key`

Server:

- validate counts เป็น integer >= 0
- calculate totals
- stamp created_by name/phone
- default status เป็น `pending`
- return row ที่สร้าง

### `PATCH /api/lanflow/cash-counts/[id]`

ใช้แก้ไขรายการที่ยังไม่ confirmed

Rules:

- ถ้า `status = confirmed` และผู้ใช้ไม่ใช่ `super_admin` ให้ return 403
- recalculate totals ทุกครั้ง
- increment revision หรือเขียน audit log

### `DELETE /api/lanflow/cash-counts/[id]`

ใช้ soft delete

Rules:

- ถ้า `status = confirmed` ต้องเป็น `super_admin`
- ถ้ายังไม่ confirmed ใช้ scoped permission ตามสาขา
- set `status = deleted`, `deleted_at`, `deleted_by_user_id`, `delete_reason`

### `POST /api/lanflow/cash-counts/[id]/confirm`

ใช้ยืนยันรายการ

Rules:

- เฉพาะ `super_admin`
- set `status = confirmed`
- set `confirmed_by`
- set `confirmed_at = server timestamp`
- หลัง confirmed แล้ว admin/user ห้ามแก้ไข/ลบ

## UI Plan

### Tab

เพิ่ม tab ใหม่:

```text
นับเงิน
```

ควรอยู่ใกล้ `รับ-จ่าย` เพราะเป็นงานเงินสดประจำวัน

### Table Columns

- วันที่นับ
- สาขา
- ผู้บันทึก
- เงินสดที่นับได้
- ยอดเงินในบัญชี
- ยอดเงินในระบบ
- ยอดแตกต่าง
- สถานะ
- ผู้ยืนยัน
- เวลายืนยัน
- Actions

### Row Styling

- `difference_amount = 0`: สีเขียว/ปกติ
- `difference_amount > 0`: เงินเกิน
- `difference_amount < 0`: เงินขาด
- `confirmed`: lock icon หรือ badge `ยืนยันแล้ว`

### Form Modal

Sections:

1. ข้อมูลรายการ
   - วันที่นับ
   - สาขา
   - หมายเหตุ
2. ธนบัตร
   - 1000
   - 500
   - 100
   - 50
   - 20
3. เหรียญ
   - 10
   - 5
   - 2
   - 1
4. ยอดเปรียบเทียบ
   - ยอดเงินในบัญชี
   - ยอดเงินในระบบ
5. สรุปอัตโนมัติ
   - ยอดเงินสดที่นับได้
   - ยอดรวมเงินสด + เงินในบัญชี
   - ยอดแตกต่าง

UX:

- ช่องจำนวนทุกช่อง default เป็น `0`
- ห้ามกรอกค่าติดลบ
- รองรับ keyboard numeric บน tablet
- คำนวณ summary แบบ live ขณะกรอก
- ปุ่มบันทึกใช้ข้อความ `บันทึกรายการนับเงิน`
- ถ้า edit confirmed record โดย admin/user ให้ form เป็น read-only หรือไม่ให้เปิด edit

## Offline-first Plan

โมดูลนี้ควรใช้ pattern เดียวกับบิลยาง/รับ-จ่าย

Fields:

- `client_temp_id`
- `idempotency_key`
- `sync_status`
- `client_recorded_at`
- `server_received_at`

Behavior:

- กดบันทึกแล้วสร้าง local record ได้ทันที
- ถ้า online ให้ sync เข้า server แล้ว mark `synced`
- ถ้า offline ให้ mark `pending`
- การยืนยันต้อง online และต้องเป็น `super_admin`
- ห้าม confirm offline เพื่อกันสิทธิ์และ timestamp เพี้ยน

## Validation Rules

- อย่างน้อยต้องมีหนึ่งช่อง denomination หรือ account balance มากกว่า 0
- ทุก count ต้องเป็น integer >= 0
- `account_balance >= 0`
- `system_balance >= 0`
- `location_id` ต้องเป็นสาขาที่ผู้ใช้มีสิทธิ์
- `confirmed` records ห้าม update/delete โดย `admin/user`

## Audit Plan

ทุก action สำคัญควรเขียน audit:

- create
- update
- delete
- confirm

Audit payload:

- entity_type = `cash_count`
- entity_id
- old_data
- new_data
- actor_user_id
- actor_name
- actor_phone
- server_created_at

## ADR Draft

### ADR-CC-001: Store Thai Denominations As Columns

Decision: ใช้ column แยกสำหรับธนบัตร/เหรียญแต่ละชนิด

Reason:

- denomination คงที่ตาม requirement
- query/report ง่าย
- form mapping ตรงไปตรงมา
- ลด complexity จาก child table

Tradeoff:

- ถ้าอนาคตเพิ่ม denomination ใหม่ ต้อง migration เพิ่ม column

### ADR-CC-002: Confirmation Is Super Admin Only

Decision: `confirm` ทำได้เฉพาะ `super_admin`

Reason:

- เป็น action ปิดยอดเงิน
- หลัง confirm แล้ว user/admin ห้ามแก้ไข/ลบ
- ลดความเสี่ยงการเปลี่ยนยอดย้อนหลัง

### ADR-CC-003: Confirm Requires Online Server Write

Decision: confirm ห้ามทำ offline

Reason:

- ต้องใช้ server timestamp
- ต้องตรวจ role ล่าสุดจาก server
- ต้องกัน tablet ที่ auth/session เก่าหรือ clock เพี้ยน

## Open Questions

1. ยอดเงินในระบบควรให้กรอกเองก่อน หรือให้ดึงจากรายรับ-รายจ่าย/บิลยางอัตโนมัติในอนาคต?
2. ต้องการให้หนึ่งสาขามีรายการนับเงินได้กี่ครั้งต่อวัน?
   - ครั้งเดียวต่อวัน
   - หลายครั้งต่อวัน เช่น เช้า/เย็น/ปิดกะ
3. หลัง super_admin ยืนยันแล้ว super_admin แก้ไขได้ไหม หรือควรทำได้เฉพาะลบ/ยกเลิกพร้อมเหตุผล?
4. ต้องการแนบรูปถ่ายเงินสด/สลิปบัญชีไหม?
5. ถ้ายอดแตกต่างไม่ใช่ 0 ต้องบังคับกรอกหมายเหตุไหม?

## Implementation Steps

1. เพิ่ม type `CashCount` ใน `src/types/index.ts`
2. เพิ่ม migration `cash_counts`
3. เพิ่ม server helper ใน `src/lib/server/lanflow-db.ts`
4. เพิ่ม API routes:
   - `GET /api/lanflow/cash-counts`
   - `POST /api/lanflow/cash-counts`
   - `PATCH /api/lanflow/cash-counts/[id]`
   - `DELETE /api/lanflow/cash-counts/[id]`
   - `POST /api/lanflow/cash-counts/[id]/confirm`
5. เพิ่ม tab `นับเงิน` ใน `LanFlowApp.tsx`
6. สร้าง component:
   - `CashCountModule`
   - `CashCountTable`
   - `CashCountModal`
   - `CashCountSummary`
7. เชื่อม offline queue สำหรับ create/update/delete
8. เพิ่ม permission checks ฝั่ง UI และ API
9. ทดสอบ:
   - user เพิ่มรายการได้
   - admin เพิ่ม/แก้ไข/ลบ pending ได้
   - admin confirm ไม่ได้
   - admin/user แก้ไข/ลบ confirmed ไม่ได้
   - super_admin confirm ได้
   - super_admin ลบ confirmed ได้
   - formula ยอดแตกต่างถูกต้อง
