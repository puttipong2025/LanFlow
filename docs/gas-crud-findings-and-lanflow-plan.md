# GAS CRUD Findings And LanFlow Plan

วันที่บันทึก: 2026-06-18

เอกสารนี้สรุปสิ่งที่พบจากการทดสอบระบบเดิมบน Google Apps Script และแนวทางนำฟังก์ชันเหล่านั้นมาใช้กับ LanFlow

## แหล่งอ้างอิงที่ทดสอบ

- บิลยาง: `https://script.google.com/macros/s/AKfycbw4ARw_3HFU2GC7u9_ovMfKcHMqoHRUcPTydAsmLjKdaDVsRwhh16O3U3zGUH65R8I/exec`
- รายรับรายจ่าย: `https://script.google.com/a/macros/dodocare.org/s/AKfycby0nbqPI9NKYV0MeZGTnN33SGUDmaG1In2jPOMNo1XU6wPC-vF-MLZlcUfwP5TcdqKg/exec`

หมายเหตุ: หน้า GAS จริงอยู่ใน iframe ชื่อ `userHtmlFrame` ส่วนหน้า outer ของ Apps Script มีเฉพาะแถบแจ้งเตือนของ Google Apps Script

## สิ่งที่พบจากระบบบิลยาง

### ตารางบิลยาง

- มีปุ่มหลักด้านบน:
  - รายงาน
  - จับเวลาเทิร์นน้ำ
  - เพิ่มข้อมูล
  - ข้อมูลทั้งหมด
  - เปิดกรองข้อมูล
- ตารางมีคอลัมน์สำคัญ:
  - Delete/Edit/View
  - เลขที่บิล
  - วันที่ออกบิล
  - TimestampBill
  - ชื่อลูกค้า
  - ประเภทลูกค้า
  - ประเภทบิล
  - น้ำหนักที่หัก
  - น้ำหนักรวม
  - รวมมูลค่ายาง(บาท)
  - ราคาเฉลี่ย
  - ยอดรวมที่ถูกหัก
- Action ในแถวมี:
  - ลบ
  - แก้ไข
  - พิมพ์
  - จ่ายเงิน
- มี DataTable behavior:
  - เลือกจำนวนแถว
  - ค้นหา
  - pagination
  - แสดงจำนวนแถว เช่น `1 ถึง 1 จาก 1`

### ฟอร์มบิลยาง

- ปุ่ม `เพิ่มข้อมูล` เปิด modal บิลเครื่องชั่งเล็ก
- เลขที่บิล generate อัตโนมัติ และต้องรอให้พร้อมก่อน submit
- ข้อมูลลูกค้า:
  - เลขที่บิล
  - วันที่
  - สถานะสมาชิก
  - ชื่อลูกค้า
  - ประเภทลูกค้า
- ส่วนชั่งสินค้า:
  - เพิ่มรายการชั่งได้หลายแถว
  - คอลัมน์รายการชั่ง, น้ำหนักเข้า, น้ำหนักออก, น้ำหนักสุทธิ, ราคาสินค้า, ยอดเงิน, ลบ
  - ทดสอบกรอกน้ำหนักเข้า 150, น้ำหนักออก 50, ราคา 30 ได้ผลรวม 3000
- ส่วนหักสินค้า:
  - ปุ่มเพิ่มน้ำกรด
  - รองรับรายการหักพร้อมจำนวน, หน่วย, ราคาต่อหน่วย, ยอดเงิน
- ส่วนหักเงิน:
  - ปุ่มหักหนี้
  - รองรับยอดหักหนี้
- Summary:
  - ราคาเฉลี่ยยาง
  - รวมมูลค่ายาง
  - ยอดรวมที่ถูกหัก
  - ยอดสุทธิที่ต้องจ่ายลูกค้า

### ผล CRUD บิลยาง

- Create ผ่าน
  - สร้างบิลทดสอบ `Codex CRUD Test Rubber 180618`
  - ตารางแสดงน้ำหนักรวม 100, ราคาเฉลี่ย 30, รวมมูลค่ายาง 3000
- Update ผ่าน
  - เปลี่ยนชื่อเป็น `Codex CRUD Test Rubber EDITED 180618`
  - Timestamp เปลี่ยนเป็นรูปแบบมี suffix เช่น `แก้ไขครั้งที่ 1`
- Delete ผ่าน
  - กดลบแล้วมี SweetAlert ยืนยัน
  - ข้อความเตือนบอกว่าข้อมูลจะถูกย้ายไปชีทลบข้อมูล และเลขบิลจะถูกยกเลิก
  - หลังยืนยัน record หายจากตาราง

## สิ่งที่พบจากระบบรายรับรายจ่าย

### หน้าหลัก

- มี summary cards:
  - รายจ่ายวันนี้
  - รายจ่ายเดือนนี้
  - รายจ่ายปีนี้
  - รายรับปีนี้
- มีปุ่มกราฟ:
  - แสดงกราฟแท่ง
  - แสดงกราฟวงกลม
- มีตัวกรอง:
  - Select Month
  - Select Year
  - รายงาน
- แยกตารางรายจ่ายและรายรับคนละฝั่ง
- แต่ละตารางมี:
  - เลือกจำนวนแถว
  - ค้นหา
  - pagination
  - คอลัมน์เลขที่, วันที่, รายการ, จำนวนรายการ, รวมค่าใช้จ่าย, แก้ไข

### ฟอร์มรายรับรายจ่าย

- มี modal `เพิ่ม/แก้ไข บิลเงินสด`
- แยก modal ตามฝั่งรายจ่ายและรายรับ
- ต้องเลือก:
  - ช่องทางการรับจ่ายเงิน
  - รูปแบบ
- ถ้ากด `เพิ่มรายการ` ก่อนเลือกเงื่อนไข ระบบแจ้งเตือน:
  - กรุณาเลือกช่องทางการรับจ่ายเงินและรูปแบบก่อนเพิ่มรายการ
- ปุ่ม `เพิ่มรายการ` เพิ่ม row รายการใน modal
- ปุ่ม `บันทึกบิล` บันทึกข้อมูล
- ปุ่ม `ยกเลิก` ปิด modal

### พฤติกรรมสำคัญที่ต้องระวัง

- ต้องรอให้เลขที่บิล generate ก่อนกดบันทึก
- ถ้ากดบันทึกเร็วเกินไปตอนเลขที่ยังว่าง ข้อมูลไม่ขึ้นในตารางใช้งาน
- Console ระบุกรณีผิดพลาดว่า record ไปอยู่ฝั่งลบแล้ว เช่น:
  - `expendที่ลบแล้ว: 1 แถว`
  - `expendที่เก็บไว้: 0 แถว`
- เมื่อรอเลขที่พร้อมก่อน submit ข้อมูลจึงขึ้นตารางใช้งานปกติ

### ผล CRUD รายจ่าย

- Create ผ่าน
  - สร้าง `Codex CRUD Test Expense OK 180618`
  - ยอด 789.00
- Update ผ่าน
  - เปลี่ยนเป็น `Codex CRUD Test Expense EDITED 180618`
  - ยอด 987.00
- Delete ผ่าน
  - กดลบแล้วมี SweetAlert ยืนยัน
  - หลังยืนยัน record หายจากตาราง

### ผล CRUD รายรับ

- Create ผ่าน
  - สร้าง `Codex CRUD Test Income 180618`
  - ยอด 222
- Update ผ่าน
  - เปลี่ยนเป็น `Codex CRUD Test Income EDITED 180618`
  - ยอด 333
- Delete ผ่าน
  - กดลบแล้วมี SweetAlert ยืนยัน
  - หลังยืนยัน record หายจากตาราง

## ฟังก์ชันที่ควรนำมาใช้กับ LanFlow

### 1. Offline-first Bill Number

สิ่งที่พบ:
- GAS ต้องรอเลขที่บิลก่อน submit
- ถ้า submit ตอนเลขว่าง ข้อมูลอาจผิดสถานะ

แนวทางใน LanFlow:
- ไม่ควรบังคับให้ PWA รอเลขบิลจาก server ก่อนบันทึก
- ให้ผู้ใช้บันทึกได้ทันทีแม้ออฟไลน์
- ตอน offline ให้สร้าง `client_temp_id` และ `local_bill_no` เช่น:
  - `TEMP-LY01-TAB03-00012`
  - `branchId-deviceId-ULID`
- ตารางและใบพิมพ์ offline แสดงเลขชั่วคราว พร้อมสถานะ `รอซิงก์`
- เมื่อ sync สำเร็จ server ค่อยออก `server_bill_no` หรือ `official_bill_no`
- UI ควรแสดงทั้งสองสถานะ:
  - ก่อน sync: `เลขชั่วคราว TEMP-LY01-TAB03-00012`
  - หลัง sync: `เลขบิลจริง 260618-001`
- ถ้าต้องการให้พิมพ์เลขจริงตอนออฟไลน์ อาจใช้วิธีจองเลขล่วงหน้าเป็นชุดต่อเครื่อง เช่น `260618-001` ถึง `260618-100`
- เลขที่จองแล้วแต่ไม่ได้ใช้ ต้อง mark เป็น `void` หรือ `unused` ห้าม reuse แบบเงียบ ๆ
- หลังลบหรือยกเลิกบิล ให้เก็บสถานะเลขบิลเป็น `cancelled` ไม่ reuse เลขเดิม

### 2. Soft Delete / Trash

สิ่งที่พบ:
- GAS ลบโดยย้ายข้อมูลไปชีทลบข้อมูล
- เลขบิลถูกยกเลิก ไม่ได้หายเงียบ ๆ

แนวทางใน LanFlow:
- ไม่ควร hard delete ทันที
- เพิ่ม field:
  - `deleted_at`
  - `deleted_by`
  - `delete_reason`
  - `status = active | deleted | cancelled`
- Admin สามารถดูรายการที่ถูกลบได้
- RLS ต้องยังแยกตาม `location_id`

### 3. Audit Trail / Revision

สิ่งที่พบ:
- ตอนแก้บิลยาง Timestamp แสดง `แก้ไขครั้งที่ 1`

แนวทางใน LanFlow:
- เพิ่มตาราง audit log เช่น `audit_logs`
- เก็บ:
  - entity_type
  - entity_id
  - operation
  - old_data
  - new_data
  - actor_name
  - actor_phone
  - server_created_at
- บิลควรมี `revision_no`
- แสดงในตารางว่าแก้ไขครั้งที่เท่าไร

### 4. Rubber Bill Details แบบ Parent-Child

สิ่งที่พบ:
- 1 บิลยางมีหลายรายการชั่ง
- มีรายการน้ำกรด
- มีรายการหักหนี้
- Summary คำนวณจากรายการย่อย

แนวทางใน LanFlow:
- ใช้โครงสร้าง parent-child:
  - `rubber_bills`
  - `rubber_weigh_items`
  - `rubber_acid_items`
  - `rubber_debt_items`
- ตอน offline ให้เก็บ `client_temp_id` ทุกตาราง
- ตอน sync ให้ insert parent ก่อน แล้ว map child ด้วย id ที่ server สร้าง
- Summary ใน parent ควรเป็น cached totals เพื่อให้ตารางโหลดเร็ว

### 5. Income/Expense Bill Details

สิ่งที่พบ:
- รายรับและรายจ่ายเป็นคนละตาราง UI
- 1 บิลเงินสดมีหลายแถวรายการได้
- หน้า summary แสดงจำนวนรายการและยอดรวม

แนวทางใน LanFlow:
- ควรปรับจากการเก็บแต่ละ line เป็น record เดี่ยว ไปเป็น:
  - `cash_bills`
  - `cash_bill_items`
- `cash_bills` เก็บ:
  - type: income | expense
  - number
  - tx_date
  - bill_option
  - transaction_option
  - item_count
  - total_amount
  - location_id
  - created_by_name
  - created_by_phone
- `cash_bill_items` เก็บ:
  - title
  - quantity
  - unit_price
  - amount

### 6. Validation ก่อนเพิ่มรายการและบันทึก

สิ่งที่พบ:
- รายรับรายจ่ายบังคับเลือกช่องทางและรูปแบบก่อนเพิ่มรายการ
- GAS บังคับรอเลขที่ก่อนบันทึก แต่แนวทางนี้ไม่เหมาะกับ PWA offline-first

แนวทางใน LanFlow:
- เพิ่ม validation ใน modal:
  - ต้องเลือกสาขา
  - ต้องมี `client_temp_id`
  - ต้องมี `local_bill_no` หรือเลขชั่วคราว
  - ต้องเลือกช่องทาง
  - ต้องเลือกรูปแบบ
  - ต้องมีอย่างน้อย 1 row
  - row ต้องมีชื่อรายการและยอดเงินมากกว่า 0
- ไม่ต้องรอ `server_bill_no` ก่อนบันทึก
- ถ้า offline ให้บันทึกเป็น `sync_status = pending`
- ถ้า online แล้ว server ออกเลขจริงสำเร็จ ให้เปลี่ยนเป็น `sync_status = synced`
- แสดง toast/modal แจ้งเตือนแบบชัดเจน

### 7. DataTable UX

สิ่งที่พบ:
- ทั้งสองระบบใช้ table แบบ DataTables:
  - page size
  - search
  - pagination
  - row count
  - action buttons

แนวทางใน LanFlow:
- เพิ่ม component กลาง `DataEntryTable`
- รองรับ:
  - page size
  - local search
  - pagination
  - empty state
  - action slot
  - sticky header ในหน้าจอ tablet
- ตารางบิลยางควรรองรับ horizontal scroll บนจอเล็ก

### 8. Print / Report / Payment Flow

สิ่งที่พบ:
- บิลยางมีปุ่มพิมพ์และจ่ายเงิน
- รายรับรายจ่ายมีปุ่มพิมพ์
- มีรายงานและ filter

แนวทางใน LanFlow:
- เพิ่ม view สำหรับ:
  - print bill
  - print report
  - payment modal
  - report filter by date, bill no, customer type, bill type, payment type
- แยก payment status:
  - unpaid
  - partially_paid
  - paid
- เก็บ cash/transfer แยกชัดเจน

### 9. Timer / Turn Water

สิ่งที่พบ:
- บิลยางมีฟังก์ชันจับเวลาเทิร์นน้ำ
- มีปุ่มเพิ่มเวลา เช่น +40, +15, +10 นาที

แนวทางใน LanFlow:
- ทำ module ย่อย `TurnTimer`
- เก็บเวลาแบบ offline-first:
  - client_started_at
  - client_ended_at
  - duration_minutes
  - server_received_at
  - created_by
  - location_id
- ใช้เวลา client สำหรับแสดงผลทันที
- ใช้เวลา server ตอน sync สำหรับ audit และการเรียงข้อมูลกลาง

### 10. Offline-first Timestamp และ Conflict Prevention

สิ่งที่พบ:
- ระบบเดิมพึ่ง TimestampBill เพื่อเรียงและ audit
- ถ้าบันทึกเร็ว/สถานะไม่พร้อม ข้อมูลอาจผิดกลุ่ม

แนวทางใน LanFlow:
- ไม่ควรบังคับให้ PWA รอ `server_created_at` ก่อนบันทึก
- ทุก record ต้องมีเวลาสองชุด:
  - `client_recorded_at`: เวลาที่ผู้ใช้กดบันทึกบนเครื่อง ใช้แสดงทันทีตอน offline
  - `server_received_at`: เวลาที่ server รับข้อมูล ใช้ audit และเรียงข้อมูลกลางหลัง sync
- ทุก record ต้องมี id สองชุด:
  - `client_temp_id`: สร้างบนเครื่อง เช่น ULID/UUID พร้อม device id
  - `server_id`: ได้หลัง sync สำเร็จ
- ใช้ `idempotency_key` ต่อการ submit เพื่อกันกดซ้ำแล้วเกิด record ซ้ำ
- บันทึก data entry แบบ insert-first ไม่แก้ทับ record เดิมทันที
- การแก้ไขควรสร้าง revision หรือ audit log เพิ่ม
- Sync engine ต้อง map `client_temp_id -> server_id`
- ถ้า sync ซ้ำด้วย `idempotency_key` เดิม server ต้องตอบ record เดิม ไม่สร้างใหม่
- ถ้าข้อมูลชนกัน ให้ใช้ conflict state เช่น:
  - `synced`
  - `pending`
  - `failed`
  - `conflict`
- กรณี conflict ให้ admin เลือกเก็บ version ที่ถูกต้อง หรือ merge ตาม field

## Task แนะนำสำหรับ LanFlow รอบถัดไป

1. ปรับ schema ให้รองรับ parent-child สำหรับบิลยางและบิลเงินสด
2. เพิ่ม soft delete และ audit log
3. เพิ่ม `client_temp_id`, `local_bill_no`, `server_bill_no`, `sync_status`, `idempotency_key`
4. ปรับ modal ให้บันทึก offline ได้ทันที และแสดงสถานะรอซิงก์
5. เพิ่ม validation ก่อนเพิ่มรายการและก่อนบันทึก
6. เพิ่ม payment modal สำหรับบิลยาง
7. เพิ่ม print view สำหรับบิลยางและรายรับรายจ่าย
8. เพิ่ม report/filter modal
9. เพิ่ม TurnTimer module
10. ปรับ offline queue ให้ sync parent-child แบบปลอดภัย และ map `client_temp_id -> server_id`
11. เพิ่ม server sync endpoint/RPC สำหรับออกเลขบิลจริงตอน online
12. เพิ่ม idempotent sync เพื่อกันข้อมูลซ้ำจากการกดบันทึกหรือ retry
