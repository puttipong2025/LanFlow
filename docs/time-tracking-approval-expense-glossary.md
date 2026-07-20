# Time Tracking Approval Expense Glossary

คำศัพท์กลางสำหรับ feature ที่เชื่อมการอนุมัติใน Time Tracking เข้ากับค่าใช้จ่ายสาขา รายละเอียด decision อยู่ที่ `docs/adr/0006-time-tracking-approval-expense-relation.md`

| Term | ความหมายใน LanFlow |
| --- | --- |
| Approval source | record ต้นทางที่ถูกอนุมัติ ได้แก่ `financial_transactions` ประเภท `WITHDRAWAL` หรือ `payroll_slips` |
| Approver | ผู้ใช้ที่มีสิทธิ์อนุมัติตามกฎเดิมของ Time Tracking; feature นี้ไม่เพิ่มสิทธิ์อนุมัติให้ role `user` |
| Managed branch | สาขา active ที่ผูกกับผู้อนุมัติผ่าน `user_locations` |
| Expense location | สาขาเดียวที่ผู้อนุมัติเลือกให้รับภาระค่าใช้จ่ายของ source record |
| Withdrawal expense | ค่าใช้จ่าย derived จาก `WITHDRAWAL` ที่อนุมัติแล้ว ใช้ยอด `financial_transactions.amount` |
| Payroll expense | ค่าใช้จ่าย derived จากสลิปที่อนุมัติแล้ว ใช้ `payroll_slips.net_pay` เฉพาะเมื่อมากกว่า 0 |
| Cash-basis date | วันที่อนุมัติจริงจากเวลา server แปลงเป็นวันที่ `Asia/Bangkok` |
| Derived expense | แถว read-only ใน Income/Expense feed ที่คำนวณจาก source โดยไม่สร้างสำเนาในตาราง `income_expense` |
| Relation Lock | กฎที่ห้ามแก้หรือลบ derived expense จากโมดูลปลายทาง และต้องกลับไปจัดการที่ source |
| Source route | เส้นทางจาก derived expense กลับไปเปิด record ใน Time Tracking เมื่อตัวผู้ชมมีสิทธิ์ |
| Branch correction | การเปลี่ยน `expense_location_id` ที่ source โดยผู้แก้ต้องดูแลทั้งสาขาเดิมและสาขาใหม่ |
| Soft cancel | การยกเลิก source โดยคง record และ audit history ไว้ แต่เอาผลของมันออกจาก active Income/Expense feed |
| Idempotent approval | การ retry approval เดิมแล้วไม่สร้างผลซ้ำ; decision หรือ branch ที่ขัดกันต้องเป็น conflict |
| One source, one row | source ที่ active และเข้าเงื่อนไขหนึ่งรายการต้องปรากฏเป็น derived expense ไม่เกินหนึ่งแถว |

## Display Contract

| Source | Title | Amount |
| --- | --- | ---: |
| `WITHDRAWAL` | `เบิกเงิน — {ชื่อพนักงาน}: {รายละเอียด}` | `amount` |
| `PAYROLL_SLIP` | `เงินเดือน — {ชื่อพนักงาน} — {เดือนสลิป}` | `net_pay` เมื่อ `net_pay > 0` |

ทั้งสองแบบใช้ `type = expense`, `billOption = ค่าใช้จ่าย` และวันที่ cash basis
