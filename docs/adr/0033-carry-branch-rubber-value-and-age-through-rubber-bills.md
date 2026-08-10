---
status: accepted
---

The deleted-receipt relation is refined by ADR-0034: after a branch receipt is successfully soft-deleted, it retains the `REX` number snapshot but detaches `source_rubber_export_id` so the inactive receipt does not block permanent deletion of the source export.

# Carry branch Rubber Export value and age through Rubber Bills

LanFlow รับรายการส่งออกยางที่ตรวจสอบแล้วจากสาขาอื่นเข้าปลายทางเป็นบิลยางปกติหนึ่งใบ โดยไม่สร้างตารางรับโอนหรือสถานะรับโอนใหม่ บิลรับอ้าง `source_rubber_export_id` เพียงรายการเดียว เก็บเลข REX, เวลารับ, อายุเฉลี่ย ณ เวลารับ และสถานะประมาณการเป็น snapshot และใช้ `source_rubber_export_id IS NOT NULL` ระบุชนิดรายการ บิลรับไม่มีการแก้ไข แต่ลบผ่านกติกาเวลา การอนุมัติ และ relation lock เดิมของบิลยางได้

การรับเข้าเป็น Server-authoritative transaction เดียว: ล็อก REX ต้นทาง ตรวจว่า verified อยู่คนละสาขาและยังไม่มี receipt active จองเลขบิลตามลำดับเดิม สร้าง weigh item จาก `current_weight` และต้นทุนซื้อเดิมจาก `paid_total` แล้วสร้าง debt deduction เท่ามูลค่ายาง จึงทำให้ยอดต้องจ่ายลูกค้าเป็นศูนย์ Partial unique index บน REX ต้นทางป้องกันการรับซ้ำพร้อมกัน และการลบบิลรับสำเร็จจึงปลดให้เลือก REX เดิมได้อีกครั้ง

อายุตอนรับคำนวณจาก `average_age_hours + (received_at - verified_at)` โดยใช้เวลา Server และไม่ให้อายุติดลบ เมื่อบิลรับถูกส่งออกต่อ `rubber_export_items.carried_age_hours` จะ snapshot อายุฐาน และอายุ ณ cutoff คำนวณเป็น `carried_age_hours + (cutoff_at - received_at)` ก่อนนำไปถ่วงน้ำหนักด้วยสูตรเดิม สถานะประมาณการถูกส่งต่อหาก REX ต้นทางมีรายการประมาณการอย่างน้อยหนึ่งรายการ

บิลรับยอดศูนย์ผ่าน Report ได้เฉพาะ receipt shape ที่สมบูรณ์และมีมูลค่ายางมากกว่าศูนย์ โดยอยู่กลุ่ม `branch_receipt` แยกจากผู้ค้าขายและชาวสวน ส่วน ledger เงินสด รายรับ รายจ่าย และยอดคงเหลือยังใช้ `net_total > 0` จึงไม่บันทึกต้นทุนรับข้ามสาขาซ้ำ การส่งออกครั้งถัดไปใช้ `rubber_value` เป็น cost amount แทนยอดที่จ่ายลูกค้า

## Consequences

- REX verified หนึ่งรายการมีบิลรับ active ได้หนึ่งใบ และลบ REX ต้นทางไม่ได้จนกว่าจะลบบิลรับตาม relation chain
- UI ใช้โมดูลบิลยางเดิม เพิ่มเฉพาะปุ่มเลือกหนึ่งรายการ ป้ายรับจากสาขา รายละเอียด read-only และ PDF metadata
- Receipt creation/deletion ต้องออนไลน์ แต่ snapshot PDF ที่ซิงก์แล้วเปิดและแชร์ออฟไลน์ได้ตามระบบเดิม
- คอลัมน์ `paid_amount` ของ Rubber Export item ยังคงเป็น cost basis ภายใน เพื่อหลีกเลี่ยงการเปลี่ยนสัญญาทั้งระบบ แม้ receipt จะมียอดจ่ายลูกค้าเป็นศูนย์
