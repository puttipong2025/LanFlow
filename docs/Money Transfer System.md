# ระบบโอนเงิน (Money Transfer System) — สรุปผลงาน

## สิ่งที่สร้างขึ้น

### 1. Database Migration
#### [NEW] [20260622080000_money_transfers.sql](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/supabase/migrations/20260622080000_money_transfers.sql)
3 ตารางใหม่:
- `money_transfers` (Parent) — เก็บข้อมูลหลักของรายการโอนเงิน
- `money_transfer_slips` (Child 1) — สลิปธนาคาร 1-N ใบ
- `money_transfer_items` (Child 2) — เชื่อมกับ `rubber_bills` / `ocr_tickets`
- Unique index บน `(source_type, source_id)` เพื่อป้องกันเลือกบิลซ้ำ
- RLS policies + service_role grants ครบ

---

### 2. OCR Slip API
#### [NEW] [ocr-slip/route.ts](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/app/api/lanflow/ocr-slip/route.ts)
อ่านสลิปธนาคารด้วย AI (OpenRouter/Gemini) สกัดข้อมูล:
- `amount`, `reference_number`, `fee`
- `sender_name`, `receiver_name`
- `transaction_date`

---

### 3. Money Transfer CRUD API
#### [NEW] [money-transfers/route.ts](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/app/api/lanflow/money-transfers/route.ts)
GET (list + usedSourceIds) และ POST (create/update)

#### [NEW] [money-transfers/[id]/route.ts](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/app/api/lanflow/money-transfers/%5Bid%5D/route.ts)
DELETE endpoint

---

### 4. Types
#### [MODIFY] [types/index.ts](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/types/index.ts)
เพิ่ม `MoneyTransfer`, `MoneyTransferSlip`, `MoneyTransferItem` types

---

### 5. DB Functions
#### [MODIFY] [lanflow-db.ts](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/lib/server/lanflow-db.ts)
เพิ่มฟังก์ชัน: `getMoneyTransfers`, `saveMoneyTransfer`, `deleteMoneyTransfer`, `getUsedSourceIds`

---

### 6. UI Component
#### [NEW] [MoneyTransferModule.tsx](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/components/MoneyTransferModule.tsx)
- **Parent form**: แสดง ลูกค้า, เลขบัญชี (display-only), ผู้สร้าง, วันเวลาสร้าง, ยอดสุทธิ
- **Child 2 (ItemPicker)**: ตารางเลือกบิลยาง/ใบชั่ง — disabled ถ้าไม่มีชื่อลูกค้า, ยอดติดลบ, หรือโอนแล้ว
- **Child 1 (Slips)**: อัปโหลดสลิป OCR หรือเพิ่มเอง — แก้ไขได้ทุกฟิลด์ ยกเว้น reference_number (ในโหมดแก้ไข)
- **Validation**: ยอดสุทธิ Parent ต้องเท่ากับยอดสลิปรวม Child 1

---

### 7. Integration
#### [MODIFY] [LanFlowApp.tsx](file:///c:/Users/Do/Documents/webapp_to_vercel_2/webapp/src/components/LanFlowApp.tsx)
เพิ่ม tab "โอนเงิน", state management, CRUD handlers, data loading

## Verification

- ✅ Database migration applied successfully
- ✅ แท็บ "โอนเงิน" แสดงบนหน้า UI
- ✅ กดปุ่ม "สร้างรายการโอน" แสดง form Parent-Child ได้ถูกต้อง
- ✅ ไม่มี error ใน console

![Money Transfer Tab](file:///C:/Users/Do/.gemini/antigravity-ide/brain/e3f1adde-9b74-4eab-b531-a1bcfac6a79e/money_transfer_tab_1782147089976.png)

![Money Transfer Create Form](file:///C:/Users/Do/.gemini/antigravity-ide/brain/e3f1adde-9b74-4eab-b531-a1bcfac6a79e/money_transfer_create_form_1782147101786.png)
