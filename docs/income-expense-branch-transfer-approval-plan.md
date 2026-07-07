# Income/Expense Branch Transfer And Approval Plan

## Purpose

เพิ่มความสามารถในโมดูล **รับ-จ่าย** สำหรับ:

1. สร้างรายการ **จ่ายเพื่อโยกเงินไปสาขาอื่น**
2. เมื่อรายการต้นทางผ่านกติกาแล้ว ระบบสร้าง **รายรับของสาขาปลายทาง** อัตโนมัติ
3. รายรับปลายทางถูกครอบด้วย **relation lock** แก้ไข/ลบโดยตรงไม่ได้ ต้องแก้หรือลบจากรายการต้นทางเท่านั้น
4. เพิ่มหน้าต่างตั้งค่าในโมดูลรับ-จ่าย ให้ `super_admin` กำหนดรายการจ่ายได้หลายรายการ เช่น `เบิก`, `ค่าแรง`, `กับข้าว`
5. เพิ่มกติกา approval: รายการรับ-จ่ายบางประเภทหรือยอดเงินตั้งแต่ threshold ที่ `super_admin` กำหนด ต้องเข้าคิวรออนุมัติ/ปฏิเสธก่อน จึงจะถูกบันทึกเป็นรายการรับ-จ่ายจริง

## Existing Constraints

อ้างอิงจาก `docs/module-development-rules.md` และโค้ดปัจจุบัน:

- ห้ามใส่ business logic ใหญ่ใน `src/components/LanFlowApp.tsx`
- รายการที่แตะเงิน, role, RLS, approval, relation lock ต้องมี verification ชัดเจน
- write ที่ต้อง atomic หรือเขียนหลายตาราง ต้องผ่าน `Frontend hook -> API Route -> RPC -> tables`
- `income_expense` ตอนนี้ full offline-first แล้ว และปิด direct write เหลือ `SELECT` + `sync_income_expense(jsonb)`
- งาน approval / โอนเงิน / จ่ายเงิน / approved state ควรเป็น **online-only**
- `income_expense.bill_option` ตอนนี้จำกัดไว้:
  - income: `รายรับ`, `บิลขาย`
  - expense: `ค่าใช้จ่าย`
- ดังนั้นรายการอย่าง `เบิก`, `ค่าแรง`, `กับข้าว` ไม่ควรใส่เป็น `bill_option`; ควรเป็น field/catalog ใหม่ เช่น `category_id` หรือ `approval_category_id`

## Recommended Domain Decision

ฟีเจอร์นี้ควรแบ่งเป็น 3 ชิ้นที่เกี่ยวกัน แต่ไม่ปนกัน:

1. **Income/Expense Category Config**
   - catalog global ที่ `super_admin` สร้าง/ปิดใช้งาน/แก้กติกาได้
   - ใช้ได้กับ income, expense หรือทั้งคู่ตาม config
   - เก็บ label เช่น `เบิก`, `ค่าแรง`, `กับข้าว`
   - เก็บ threshold ที่ต้องอนุมัติ เช่น `requires_approval`, `approval_min_amount`

2. **Pending Approval Queue**
   - table แยกสำหรับรายการที่ยังไม่ควรลง `income_expense`
   - เมื่อรายการเข้าเงื่อนไขต้องอนุมัติ ให้บันทึกเป็น pending request เท่านั้น
   - เมื่อ `super_admin` อนุมัติ ค่อยเรียก RPC เพื่อสร้าง `income_expense`
   - เมื่อปฏิเสธ ให้คงประวัติไว้พร้อมเหตุผล ไม่สร้างรายการเงินจริง

3. **Branch Transfer Relation**
   - operation online-only ที่สร้าง/แก้/ลบเป็น transaction เดียว
   - สร้าง expense ต้นทาง และ income ปลายทางเป็นคู่
   - income ปลายทางมี relation metadata ชี้กลับไปต้นทาง
   - ห้ามแก้/ลบ income ปลายทางโดยตรงทั้งใน UI และ RPC/DB

## Proposed Schema Shape

ชื่อจริงปรับได้ตอน implement แต่ concept ควรชัดแบบนี้:

```text
income_expense_categories
  id
  name
  applies_to: income | expense | both
  is_active
  requires_approval
  approval_min_amount
  created_by...
  created_at / updated_at / deleted_at

income_expense_approval_requests
  id
  request_status: pending | approved | rejected | cancelled
  requested_operation: create | update | delete
  requested_payload jsonb
  source_income_expense_id nullable
  approved_income_expense_id nullable
  requested_by...
  decided_by...
  decided_at
  decision_comment
  created_at / updated_at

income_expense_relations
  id
  relation_type: branch_transfer
  source_income_expense_id
  target_income_expense_id
  source_location_id
  target_location_id
  record_status: active | deleted | cancelled
  created_by...
  created_at / updated_at / deleted_at
```

ทางเลือกที่เรียบกว่า: เพิ่ม relation fields ลง `income_expense` โดยตรง เช่น `relation_type`, `relation_parent_id`, `relation_role`, `target_location_id`.

คำแนะนำตอนนี้: ใช้ table relation แยกถ้าอยากให้ขยายง่ายและตรวจ lock ชัด แต่ถ้าต้องการลด migration/logic ให้เพิ่ม field ใน `income_expense` โดยตรงก็พอสำหรับ branch transfer อย่างเดียว.

## Branch Transfer Rules

รายการจ่ายโยกเงินควรมี rule ดังนี้:

- ผู้สร้างเลือก `target_location_id` จาก dropdown สาขาอื่นเท่านั้น
- `target_location_id` ต้องไม่เท่ากับ `selectedLocation.id`
- ผู้สร้างต้องมีสิทธิ์อย่างน้อยในสาขาต้นทาง
- ต้องตัดสินใจเพิ่มว่า ผู้สร้างต้องมีสิทธิ์ในสาขาปลายทางด้วยหรือไม่
- เมื่อสำเร็จ:
  - ต้นทางเกิด `expense`
  - ปลายทางเกิด `income`
  - ทั้งคู่มี amount/date/title ที่สัมพันธ์กัน
  - รายรับปลายทางถูกล็อก แก้/ลบโดยตรงไม่ได้
- ถ้าแก้ต้นทาง:
  - RPC อัปเดตรายรับปลายทางให้สอดคล้องกันใน transaction เดียว
- ถ้าลบต้นทาง:
  - RPC soft delete รายจ่ายต้นทางและรายรับปลายทางใน transaction เดียว
- ถ้า user พยายามแก้/ลบปลายทาง:
  - UI disable พร้อมข้อความไทย
  - RPC/DB ปฏิเสธ เช่น `รายการนี้มาจากการโยกเงิน ต้องแก้ไขหรือลบที่รายการต้นทาง`

## Approval Rules

กติกา approval ที่แนะนำ:

- ถ้ารายการไม่เข้าเงื่อนไข approval ให้สร้าง `income_expense` ผ่าน flow เดิม
- ถ้ารายการเข้าเงื่อนไข approval ให้สร้าง `approval_request` แทน
- รายการ pending/rejected ไม่ควรถูกนับในตารางรับ-จ่ายจริง
- ตารางใน UI ควรแยกชื่อเป็น **รายการรอตรวจสอบ** หรือ **คำขออนุมัติ**
- เฉพาะ `super_admin` อนุมัติ/ปฏิเสธได้
- เมื่อ approve:
  - สร้างรายการจริงผ่าน RPC
  - ถ้าเป็น branch transfer ให้สร้าง expense/income relation pair พร้อมกัน
  - mark request เป็น approved และอ้างถึง row จริง
- เมื่อ reject:
  - mark request เป็น rejected พร้อมเหตุผล
  - ไม่สร้าง row จริง

## UI Plan

ใน `src/components/income-expense/`:

- เพิ่มปุ่ม `ตั้งค่า` ให้ `super_admin`
- ใช้ modal ซ้อนสำหรับ config เช่น `IncomeExpenseConfigModal`
- ใน modal config มี tab หรือ section:
  - รายการรับ-จ่าย
  - กติกาอนุมัติ
  - คำขอรอตรวจสอบ
- ใน form รายจ่ายเพิ่ม control:
  - หมวดรายการจาก config
  - toggle/option `โยกเงินไปสาขาอื่น`
  - dropdown เลือกสาขาปลายทาง เมื่อเลือกเป็น branch transfer
- รายการที่ปลายทางถูกสร้างจาก branch transfer แสดง badge `ล็อกจากการโยกเงิน`
- action edit/delete ของปลายทางต้อง disable และแสดงเหตุผล

## Online/Offline Decision

- การสร้างรายการรับ-จ่ายทั่วไปยังใช้ offline-first flow เดิมได้
- การอนุมัติ/ปฏิเสธต้อง online-only
- การสร้าง/แก้/ลบ branch transfer ต้อง online-only เพราะต้องเขียนสองสาขาและ enforce relation lock ล่าสุด
- ถ้าผู้ใช้อยู่ offline แล้วเลือกหมวดที่ต้องอนุมัติหรือโยกเงิน ควร disable submit พร้อมข้อความไทย

## API/RPC Plan

ควรเพิ่ม endpoint/RPC แยก ไม่ยัดทุกอย่างเข้า `sync_income_expense(jsonb)`:

```text
POST /api/lanflow/income-expense/approval-requests
POST /api/lanflow/income-expense/approval-requests/[id]/decide
POST /api/lanflow/income-expense/branch-transfer
PATCH /api/lanflow/income-expense/branch-transfer/[id]
DELETE /api/lanflow/income-expense/branch-transfer/[id]
```

RPC ที่คาดว่าใช้:

```text
create_income_expense_approval_request(payload jsonb)
decide_income_expense_approval_request(request_id uuid, decision text, comment text)
create_income_expense_branch_transfer(payload jsonb)
update_income_expense_branch_transfer(source_id uuid, payload jsonb)
delete_income_expense_branch_transfer(source_id uuid, deleted_by jsonb)
```

ทุก RPC ต้องตรวจ:

- active user
- role และ location access
- super_admin สำหรับ config และ decision
- idempotency/revision สำหรับ operation ที่แก้ row จริง
- relation lock ฝั่ง server

## Test Plan

ขั้นต่ำ:

- `npx.cmd tsc --noEmit`
- `npm run build`
- `npx.cmd supabase db reset` เมื่อมี migration

Playwright/API tests ที่ควรมี:

- สร้าง expense ปกติที่ไม่ต้อง approval แล้วยังเข้า `income_expense`
- สร้าง expense ที่เกิน threshold แล้วไปอยู่ในคำขออนุมัติ ไม่เข้า `income_expense`
- super_admin approve แล้ว row จริงถูกสร้าง
- super_admin reject แล้ว row จริงไม่ถูกสร้าง
- user/admin ที่ไม่ใช่ super_admin approve/reject ไม่ได้
- branch transfer สร้าง expense ต้นทางและ income ปลายทางใน transaction เดียว
- แก้ต้นทางแล้วปลายทางเปลี่ยนตาม
- ลบต้นทางแล้วปลายทาง soft delete ตาม
- แก้/ลบปลายทางโดยตรงถูก block ทั้ง UI และ RPC/DB
- target location ห้ามเท่ากับ source location

## Glossary

- **Branch transfer:** รายการจ่ายจากสาขาต้นทางเพื่อโยกเงินไปสาขาปลายทาง และสร้างรายรับปลายทางอัตโนมัติ
- **Source record:** รายจ่ายต้นทางที่ user สร้างหรือแก้ไขได้ตามสิทธิ์
- **Target record:** รายรับปลายทางที่ระบบสร้างจาก source record
- **Relation lock:** การห้ามแก้/ลบ target record โดยตรง เพื่อให้ต้องแก้ผ่าน source record เท่านั้น
- **Approval request:** คำขอที่ยังไม่กลายเป็นรายการรับ-จ่ายจริงจนกว่า `super_admin` จะอนุมัติ
- **Category config:** รายการ/หมวดรับ-จ่ายที่ `super_admin` กำหนด เช่น `เบิก`, `ค่าแรง`, `กับข้าว`
- **Approval threshold:** ยอดเงินขั้นต่ำที่ทำให้รายการต้องรออนุมัติ

## Grilling Round 1 Questions

1. รายการที่ต้อง approval ต้องใช้กติกาแบบไหน: ต่อหมวดรายการ, ต่อประเภท income/expense, หรือ global ทั้งระบบ?
2. ถ้า amount เท่ากับ threshold พอดี ให้ต้องอนุมัติไหม? แนะนำ `>= threshold`.
3. user/admin ที่สร้าง branch transfer ต้องมีสิทธิ์ในสาขาปลายทางด้วยไหม หรือแค่สาขาต้นทางพอ?
4. รายรับปลายทางควรใช้ title อะไร: copy จากต้นทาง, หรือ prefix เช่น `รับโอนจากสาขา X - <รายการ>`?
5. การแก้ต้นทางหลัง approve ต้องกลับไปรออนุมัติใหม่ไหม ถ้า amount เพิ่ม/หมวดเปลี่ยน?
6. การลบต้นทางหลัง approve ต้องอนุมัติใหม่ไหม หรือผู้มีสิทธิ์ลบได้แล้วปลายทางหายตามทันที?
7. คำขอที่ถูก reject ต้องให้ผู้สร้างแก้แล้วส่งใหม่ได้ไหม หรือสร้างคำขอใหม่เท่านั้น?
8. Config รายการรับ-จ่ายควรรองรับทั้งรายรับและรายจ่าย หรือรอบแรกทำเฉพาะรายจ่าย?
9. รายการ config ที่ถูกใช้งานแล้วควรห้ามลบถาวรเหมือน `income_sale_items` และให้ปิดใช้งานแทน ใช่ไหม?
10. ต้องการให้ approval queue แสดงรวมทุกสาขาสำหรับ super_admin หรือ filter ตามสาขาที่เลือกอยู่?

