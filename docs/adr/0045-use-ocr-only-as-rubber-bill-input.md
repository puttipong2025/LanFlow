---
status: accepted
---

# ใช้ OCR เป็นวิธีกรอกบิลยางเท่านั้น

LanFlow ยุบ OCR Ticket ซึ่งเคยเป็นต้นทางธุรกิจแยก ให้เหลือเพียงคิวชั่วคราวสำหรับอ่านรูปและเริ่มกรอกบิลยาง ผู้ใช้ยังต้องตรวจและบันทึกผ่านวงจรบิลยางปกติ เพราะการมีสอง source ทำให้ Money Transfer, Report, Income/Expense, Dashboard และ relation lock ต้องรักษากติกาซ้ำกัน รูปต้นฉบับถูกเก็บเป็น provenance แบบ private ของบิลยาง แต่ไม่ใช่หลักฐานน้ำหนักและไม่เข้า PDF หรือรายงานรวม

ผลคือ `rubber_bills` เป็น source of truth เดียวของงานรับซื้อยาง ขณะที่ upload source มีไว้ค้ำความปลอดภัยของ replay/approval และห้ามเปิด storage identifier ให้ browser

## Contract

- ผู้ใช้เลือกได้หลายรูป แต่หนึ่งรูปสร้าง draft ได้หนึ่งรายการ และประมวลผลเรียงทีละรูป
- คิวอยู่ในหน่วยความจำ แยกตามสาขา และ badge แสดงจำนวนรายการของสาขาปัจจุบันที่ยังไม่ถูกบันทึกเป็นบิลยาง
- เมื่อ OCR สำเร็จ ระบบเปิด `RubberBillModal` ปกติให้ผู้ใช้ตรวจและกรอกลูกค้าเอง สูตรฝั่งบิลยางเป็นค่ authoritative หากไม่ตรงกับข้อความที่อ่านได้
- error ทุกชนิดกด Retry เองได้เมื่อ online; ระบบไม่ retry อัตโนมัติ และการยกเลิก draft ที่เปิดอยู่คืนรายการเป็นสถานะพร้อม
- upload source ใช้ lifecycle `staged -> reserved -> attached` หรือ `reserved -> abandoned` และ bind ด้วยเจ้าของ สาขา client temp ID และ idempotency identity เดียวกัน
- replay identity เดิมต้องคืนผลเดิมได้ทั้งตอน staged และ attached; identity อื่นห้ามยึด source เดิม
- ลบรายการออกจากคิวหลังบันทึกเฉพาะเมื่อ durable sync event ถูก enqueue แล้ว หรือ server ยืนยัน authoritative success

## Consequences

- Money Transfer, Income/Expense, Dashboard, Report และ PDF เห็นเฉพาะบิลยาง ไม่ต้องมี compatibility branch สำหรับ `ocr_ticket`
- รูปต้นฉบับเก็บใน Drive แบบ private และเปิดผ่าน endpoint ที่ตรวจผู้ใช้ สิทธิ์สาขา และความสัมพันธ์กับบิลยาง โดย browser ไม่ได้รับ Drive ID หรือ path
- รูปต้นฉบับเป็น provenance เท่านั้น ไม่ใช่หลักฐานน้ำหนัก และไม่เข้า receipt, report หรือ share PDF
- migration cutover ต้องหยุดก่อน DDL หากยังมี legacy OCR rows หรือ dependent rows และห้ามใช้ `CASCADE`
