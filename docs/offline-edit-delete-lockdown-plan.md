# Offline Edit/Delete Lockdown Plan

## Purpose

ลดความซับซ้อนของระบบ Offline-First ในโมดูล **Rubber Bills** และ **Income/Expense** โดยเปลี่ยนกติกา edit/delete ให้ชัดเจนขึ้น:

- รายการที่ **ยังไม่เคย sync** เป็น local draft สามารถแก้ไข/ลบตอน offline ได้
- รายการที่ **sync แล้ว** ต้องกลับมา online ก่อนจึงจะแก้ไข/ลบได้
- รายการที่ถูกผูกกับ **รายการโอนเงิน** ต้องยกเลิกความสัมพันธ์ก่อน จึงจะแก้ไข/ลบได้

เหตุผลหลักคือข้อมูลที่ sync แล้วอาจมีความสัมพันธ์กับโมดูลอื่น เช่น โอนเงิน หากปล่อยให้แก้/ลบแบบ offline ระบบจะตรวจ relationship ล่าสุดไม่ได้ และเสี่ยงทำให้ข้อมูล downstream ไม่ตรงกัน

## Current Observations

### Rubber Bills

- ปัจจุบันรองรับ create/update/delete ผ่าน IndexedDB queue แล้ว sync ไปที่ `sync_rubber_bill(payload)`.
- ถ้า record sync แล้วและผู้ใช้อยู่ offline ตอนนี้ยังสามารถ enqueue update/delete ได้.
- โมดูลโอนเงินเลือก source ได้จาก `rubber_bill` และ `ocr_ticket`.
- `money_transfer_items` มี unique index `(source_type, source_id)` กันบิลเดียวถูกใช้หลายรายการโอน.

### Income/Expense

- ปัจจุบันรองรับ create/update/delete ผ่าน IndexedDB queue แล้ว sync ไปที่ `sync_income_expense(payload)`.
- ตอนนี้ยังไม่พบ relationship จาก `money_transfer_items` มาที่ `income_expense`.
- ดังนั้นกติกา relation lock แบบ source item ใน `money_transfer_items` ยังไม่กระทบ Income/Expense จนกว่าจะออกแบบให้เลือก Income/Expense ในโอนเงินด้วย.
- เพิ่มกติกาใหม่สำหรับ **branch transfer income**: ถ้า `money_transfers.transfer_type = 'branch'` และ `target_location_id` ตรงกับสาขาที่กำลังดู โมดูลรับ-จ่ายจะแสดงรายการนั้นเป็นรายรับขาเข้าแบบ derived จาก `money_transfers`.
- รายรับขาเข้าจาก branch transfer ถูกล็อกใน UI: แก้ไข/ลบจากโมดูลรับ-จ่ายไม่ได้ ต้องแก้ไขหรือลบรายการโอนเงินต้นทางแทน. เมื่อรายการต้นทางเปลี่ยน รายรับ derived จะเปลี่ยนตาม; เมื่อต้นทางถูกลบหรือยกเลิก รายรับ derived จะหายตาม.

### OCR Tickets

- โมดูลโอนเงินเลือก source ได้จาก `ocr_ticket` ผ่าน `money_transfer_items.source_type = 'ocr_ticket'`.
- หาก OCR Ticket ถูกผูกกับรายการโอนเงินที่ยัง active อยู่ จะต้องแก้ไข/ลบไม่ได้จนกว่าจะลบ item นั้นออกจากรายการโอนก่อน.
- Enforcement ต้องมี 2 ชั้น:
  - UI: disable ปุ่มแก้ไข/ลบและแจ้งข้อความ `รายการนี้ถูกล็อก ต้องลบ item ออกจากรายการโอนก่อน`
  - DB: trigger บน `ocr_tickets` ต้อง block `update/delete` เพื่อกันการ bypass UI หรือข้อมูล relation ที่ UI stale.

## Proposed Domain Rules

| Record state | Online? | Linked to transfer? | Edit | Delete | Reason |
|---|---:|---:|---:|---:|---|
| Local draft, not synced | Offline | No | Yes | Yes | ยังไม่มี server row หรือ relationship จริง |
| Local draft, not synced | Online | No | Yes | Yes | ยังเป็น pending create ได้ |
| Synced record | Offline | No/Unknown | No | No | ตรวจ revision และ relationship ล่าสุดไม่ได้ |
| Synced record | Online | No | Yes | Yes | Server/RPC ตรวจ revision ได้ |
| Synced record | Online | Yes | No | No | ต้องยกเลิกความสัมพันธ์โอนเงินก่อน |
| Derived branch transfer income | Online/Offline | Source money transfer | No | No | เป็นรายรับที่ดึงจากโมดูลโอนเงิน ต้องแก้/ลบจากต้นทาง |
| Conflict/failed queue | Any | Any | No | No | ต้อง resolve queue ก่อน |
| Pending delete | Any | Any | No | No | รายการกำลังถูกลบอยู่แล้ว |

## ADR Drafts

### ADR-001: Synced Records Require Online Edit/Delete

**Decision:** Rubber Bills และ Income/Expense จะอนุญาตให้แก้ไข/ลบ record ที่ sync แล้วเฉพาะตอน online เท่านั้น

**Consequences:**

- ลด logic offline update/delete replay สำหรับ record ที่มี server state แล้ว
- ลด conflict จาก revision mismatch
- ลดความเสี่ยงกรณี record ถูกผูกกับโมดูลอื่นหลังจากเครื่องผู้ใช้ offline
- ยังรักษา offline create และ local draft editing ไว้สำหรับงานหน้างาน

### ADR-002: Transfer Relationship Locks Source Records

**Decision:** ถ้า Rubber Bill ถูกใช้ใน `money_transfer_items` ที่ยัง active อยู่ จะห้ามแก้ไข/ลบ Rubber Bill นั้นจนกว่าจะยกเลิกความสัมพันธ์ก่อน

**Consequences:**

- ยอดโอนเงินและยอดบิลต้นทางจะไม่แยกกันผิด
- ต้องมี UI แสดงเหตุผล เช่น "บิลนี้ถูกใช้ในรายการโอนเงินแล้ว"
- ต้อง enforce ทั้ง UI และ RPC เพราะ UI อย่างเดียว bypass ได้

## Implementation Plan

### Phase 1: UI Gate For Offline Synced Edit/Delete

Goal: ปิดปุ่ม edit/delete ตอน offline สำหรับ record ที่ sync แล้ว โดยไม่แตะ RPC ก่อน

Tasks:

1. เพิ่ม helper กลาง เช่น `isSyncedServerRecord(record)`:
   - true เมื่อมี `serverBillNo` หรือ `syncStatus === "synced"` และไม่มี pending create
2. Rubber Bills:
   - ถ้า `!navigator.onLine && isSyncedServerRecord(bill)` ให้ปิด edit/delete
   - แสดง tooltip/toast: `รายการนี้ซิงก์แล้ว ต้องออนไลน์เพื่อแก้ไขหรือลบ`
3. Income/Expense:
   - ใช้กติกาเดียวกันกับ transaction ที่ sync แล้ว
4. ยังต้องอนุญาต:
   - offline create
   - offline edit local pending create
   - offline delete local pending create แบบ no-op

Verification:

```powershell
npx.cmd tsc --noEmit
npx.cmd playwright test tests/rubber-bills-offline.spec.ts --project=chromium
npx.cmd playwright test tests/income-expense-offline.spec.ts --project=chromium
```

### Phase 2: Rubber Bill Transfer Lock

Goal: ห้ามแก้ไข/ลบ Rubber Bill ที่ถูกเลือกในโอนเงินแล้ว

Tasks:

1. เพิ่ม query/helper ฝั่ง server/RPC ตรวจ active transfer relation:
   - `money_transfer_items.source_type = 'rubber_bill'`
   - `money_transfer_items.source_id = rubber_bills.id`
   - parent `money_transfers.transfer_status <> 'cancelled'`
   - parent record ยังไม่ deleted ถ้ามี `record_status`
2. ใน `sync_rubber_bill(payload)`:
   - ก่อน `update` และ `delete` ให้ตรวจ relationship
   - ถ้าพบ ให้ return `status = 'failed'` พร้อมข้อความ business lock
   - ไม่ควรใช้ `conflict` เพราะ conflict ควรสงวนไว้สำหรับ revision mismatch
3. ใน UI:
   - แสดง badge/disable action เมื่อบิลถูกใช้ในรายการโอนเงิน
   - ข้อความแนะนำ: `ต้องยกเลิกรายการโอนเงินที่ผูกอยู่ก่อน`

Verification:

```powershell
npx.cmd supabase db reset
npx.cmd tsc --noEmit
npx.cmd playwright test tests/rubber-bills-offline.spec.ts --project=chromium
```

### Phase 3: Income/Expense Policy Decision

Goal: ตัดสินใจว่าจะให้ Income/Expense เข้าไปเกี่ยวกับโอนเงินหรือไม่

Recommendation:

- ตอนนี้ให้ใช้เฉพาะ rule `synced record ต้อง online เพื่อ edit/delete`
- ยังไม่เพิ่ม relation lock กับโอนเงิน เพราะ schema ปัจจุบันไม่ได้ผูก `income_expense` กับ `money_transfer_items`
- ถ้าอนาคตต้องเลือก Income/Expense ในโอนเงิน ให้เพิ่ม `source_type = 'income_expense'` แบบ explicit พร้อม migration และ tests แยก

Update:

- เพิ่ม branch transfer income แบบ derived แล้ว โดยไม่สร้าง row ใหม่ใน `income_expense`.
- เหตุผล: รายรับปลายทางต้องเปลี่ยน/หายตามรายการโอนเงินต้นทางเสมอ การ derive จาก `money_transfers` ลดโอกาสข้อมูลซ้ำไม่ตรงกัน และทำให้ relation lock ทำได้ตรงไปตรงมาใน UI.
- เพิ่ม RLS select policy ให้สาขาปลายทางอ่าน `money_transfers` ประเภท `branch` ที่ชี้มาหาสาขาตัวเองได้.

### Phase 4: Tests And Documentation

Add tests:

1. Rubber Bills:
   - synced bill + offline -> edit/delete disabled
   - pending create + offline -> edit/delete allowed
   - bill linked to money transfer -> online edit/delete blocked by RPC
   - after transfer cancelled/unlinked -> edit/delete allowed
2. Income/Expense:
   - synced transaction + offline -> edit/delete disabled
   - pending create + offline -> edit/delete allowed
   - incoming branch transfer -> appears as income
   - incoming branch transfer income -> edit/delete disabled
   - update/delete source branch transfer -> derived income updates/disappears

Update docs:

- `docs/system-architecture-technical-summary.md`
- offline-first comparison table
- module-specific user behavior notes

## Glossary

- **Local draft:** รายการที่สร้างในเครื่องและยังไม่เคย sync ขึ้น server
- **Synced record:** รายการที่มี server row แล้ว และผ่าน sync สำเร็จ
- **Relation lock:** สถานะที่ record ถูกโมดูลอื่นใช้อยู่ จึงห้ามแก้ไข/ลบ
- **Active transfer relation:** ความสัมพันธ์ใน `money_transfer_items` ที่ parent transfer ยังไม่ถูกยกเลิก
- **Business lock:** การปฏิเสธ operation เพราะผิดกติกาธุรกิจ ไม่ใช่ technical conflict
- **Derived branch transfer income:** รายรับที่แสดงในโมดูลรับ-จ่ายจาก `money_transfers` ประเภท `branch` ที่โอนเข้ามายังสาขาปัจจุบัน ไม่ใช่ row ที่ผู้ใช้แก้/ลบใน `income_expense` โดยตรง

## Confirmed Decisions

1. Local draft ที่ยังไม่เคย sync ยังให้แก้/ลบตอน offline ได้
2. Relationship lock รอบแรกทำกับ Rubber Bills และ OCR Tickets เพราะโอนเงินตอนนี้รองรับ `rubber_bill` และ `ocr_ticket` แต่ยังไม่รองรับ `income_expense`
3. การ "ยกเลิกความสัมพันธ์" หมายถึงลบ item ออกจากรายการโอน
4. ถ้า RPC เจอบิลถูกผูกกับโอนเงินแล้ว ให้ return `failed` พร้อมข้อความไทย เช่น `รายการนี้ถูกล็อก ต้องลบ item ออกจากรายการโอนก่อน`
5. รายรับจากรายการโอนเงินสาขาขาเข้าให้แสดงในรับ-จ่ายเป็น derived row และล็อกให้แก้/ลบจากรายการโอนเงินต้นทางเท่านั้น
