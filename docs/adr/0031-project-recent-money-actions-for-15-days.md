---
status: superseded
superseded_by: ADR-0058
---

# Project recent-money actions for 15 Bangkok days

Dashboard แสดง “ประวัติรายการเงินล่าสุด” จาก event projection แยกจาก source records โดยเริ่มเก็บหลัง migration โดยไม่ backfill และเก็บเพียงวันนี้ตาม `Asia/Bangkok` กับ 14 วันก่อนหน้า เราเลือกบันทึก full lifecycle (`create`, `update`, `delete`) ของทุก source ที่มีผลทางการเงินจริง รวมส่งออกยาง แต่ไม่บันทึก projection บิลยางรวมรายวันที่ซ้ำกับบิลยางต้นทาง เพื่อให้ Action และ badge ถูกต้องโดยไม่เปลี่ยนข้อมูลธุรกิจ สูตร Dashboard หรือ relation locks เดิม

Projection เก็บ snapshot ขนาดเล็กและผู้ดำเนินการ ใช้ trigger reconciliation ร่วมกับ baseline state ที่ไม่สร้าง event ย้อนหลัง และลบ event ที่พ้น retention วันละครั้ง การตัดประวัติหลัง 15 วันเป็น trade-off ที่ยอมรับเพื่อจำกัด storage/query cost; source records และรายงานยังคงอยู่ตาม lifecycle เดิม
