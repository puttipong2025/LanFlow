# Income/Expense Branch Transfer And Approval Remaining Plan

Created: 2026-07-07

ไฟล์นี้ตัดส่วนที่ทำเสร็จแล้วออกจาก `docs/income-expense-branch-transfer-approval-plan.md` และเหลือเฉพาะงานที่ยังไม่ครบหรือยังต้องตัดสินใจเพิ่ม

## Owner Decisions (2026-07-07)

ตัดสินใจแล้ว:

1. ใช้ **Derived Model** จาก `money_transfers` ต่อไป ไม่สร้าง row จริงคู่ใน `income_expense`
2. ผู้สร้าง `โยกเงินไปสาขาอื่น` ต้องมีสิทธิ์เฉพาะสาขาต้นทางก็พอ ไม่จำเป็นต้องมีสิทธิ์สาขาปลายทาง
3. ต้องมีปุ่มหรือลิงก์ `เปิดรายการโอนเงินต้นทาง` จาก row ที่ locked ในรับ-จ่าย
4. rejected approval ต้องสร้างคำขอใหม่เสมอ ไม่แก้หรือ reuse คำขอเดิม
5. การลบรายการที่เคย approved ไม่ต้องขออนุมัติ
6. Approval queue ของ `super_admin` แสดงรวมทุกสาขาเป็นค่าเริ่มต้น และมี filter ให้เลือกสาขาได้

## Current Answer

แผนหลักทำครบในระดับใช้งานจริงแล้ว:

- มีปุ่ม `โยกเงินไปสาขาอื่น` ในโมดูลรับ-จ่าย
- บันทึก branch transfer เข้า `money_transfers`
- สาขาต้นทางเห็นรายจ่ายแบบ derived row
- สาขาปลายทางเห็นรายรับแบบ derived row
- derived rows ถูก relation lock ใน UI และต้องแก้/ลบจากรายการโอนเงินต้นทาง
- row ที่ locked และผู้ใช้มีสิทธิ์สาขาต้นทางมีปุ่มเปิดรายการโอนเงินต้นทาง
- รับ-จ่ายแสดงรายจ่ายรวมรายวันจากบิลยางที่ยังไม่ถูกเลือกไปโอนเงิน และล็อกให้แก้/ลบจากโมดูลบิลยางต้นทางเท่านั้น
- row ที่ locked จากบิลยางมีปุ่มเปิดโมดูลบิลยางต้นทางพร้อม filter วันที่ เฉพาะผู้ใช้ที่มีสิทธิ์สาขาต้นทางหรือ `super_admin`
- มี approval keyword/config/queue
- `super_admin` อนุมัติหรือปฏิเสธรายการที่ match keyword/threshold ได้
- keyword เช่น `เบิก`, `ค่าแรง`, `กับข้าว` ไม่เกี่ยวกับ `bill_option`
- rejected approval resubmit จะสร้าง request ใหม่
- approval queue มี filter สาขา โดย default เป็นทุกสาขา

แต่แผนเดิมยังเหลือส่วนที่ยังไม่ได้ทำในเชิง hardening/test หรือเป็นทางเลือก architecture ที่ต้องให้เจ้าของระบบตัดสินใจ

## Remaining Work

### 1. Automated Tests

ยังไม่มี test เฉพาะสำหรับ branch transfer + approval flow ใหม่ครบชุด

ควรเพิ่ม tests:

- กดปุ่ม `โยกเงินไปสาขาอื่น` จากโมดูลรับ-จ่ายแล้วสร้าง `money_transfers.transfer_type = 'branch'`
- สาขาต้นทางเห็น derived expense และแก้/ลบไม่ได้
- สาขาปลายทางเห็น derived income และแก้/ลบไม่ได้
- แก้หรือลบรายการโอนเงินต้นทางแล้ว derived rows เปลี่ยนหรือหายตาม
- บิลยางที่ยังไม่อยู่ใน `money_transfer_items` ถูกรวมยอดต่อวันเป็น derived expense ในรับ-จ่าย
- เมื่อนำบิลยางไปเลือกในรายการโอนเงินแล้ว ยอด derived expense รายวันต้องตัดบิลนั้นออก
- derived expense จากบิลยางแก้/ลบจากรับ-จ่ายไม่ได้ และปุ่มเปิดต้นทางต้องเคารพสิทธิ์สาขาต้นทาง
- ตั้ง keyword approval แล้วรายการที่ match ไปอยู่ในคำขออนุมัติ ไม่เข้า `income_expense` ทันที
- `super_admin` approve แล้วสร้าง/แก้ `income_expense`
- `super_admin` reject แล้วไม่สร้าง row จริง
- user/admin ที่ไม่ใช่ `super_admin` approve/reject ไม่ได้

Verification target:

```powershell
npx.cmd tsc --noEmit
npm run build
npx.cmd supabase db reset
npx.cmd playwright test
```

### 2. Branch Transfer Data Model Follow-Up

ตัดสินใจใช้ implementation แบบ derived จาก `money_transfers` ต่อไป:

- ไม่สร้างคู่ row จริงใน `income_expense`
- ไม่ต้องมี `income_expense_relations`
- ลดความเสี่ยงข้อมูลสองฝั่งไม่ตรงกัน
- relation lock ฝั่งรับ-จ่ายทำใน UI เพราะ row ที่เห็นไม่ใช่ row จริงของ `income_expense`

ยังไม่ต้องทำ strict model เว้นแต่อนาคตต้องการ audit เป็น row จริงใน `income_expense`:

- table หรือ columns สำหรับ relation จริง เช่น `income_expense_relations`
- RPC เฉพาะ branch transfer:
  - `create_income_expense_branch_transfer`
  - `update_income_expense_branch_transfer`
  - `delete_income_expense_branch_transfer`
- server-side lock ห้ามแก้/ลบ target `income_expense` โดยตรง
- cascade/update ภายใน transaction เดียว

### 3. Source Entry Point Hardening

มีปุ่ม `เปิดรายการต้นทาง` แล้วสำหรับ row ที่ locked และผู้ใช้มีสิทธิ์สาขาต้นทาง:

- row จาก `money_transfers` เปิดรายการโอนเงินต้นทาง
- row จาก `rubber_bills` เปิดโมดูลบิลยางต้นทางและใส่ filter วันที่

งานที่ยังเหลือได้:

- ปรับ empty/error state ถ้าเปิดต้นทางแล้วผู้ใช้ไม่มีสิทธิ์หรือรายการต้นทางถูกลบ
- เพิ่ม highlight row ในตารางโอนเงินหลังปิดฟอร์มแก้ไข
- เพิ่ม deep-link URL state ถ้าต้องการให้ refresh แล้วยังเปิดรายการเดิมได้

### 4. Approval UX Before Submit

ตอนนี้ระบบตรวจตอนกดบันทึก ถ้า match keyword/threshold จะส่งเข้า approval queue

ยังไม่ได้ทำ:

- แจ้งเตือน live ใน modal ขณะพิมพ์ว่า `รายการนี้ต้องรออนุมัติ`
- badge preview ว่า match keyword ไหน
- แสดงเหตุผลก่อน submit เช่น `พบคำว่า เบิก` หรือ `ยอดถึงเกณฑ์ 5,000`

Recommendation: ทำถ้าผู้ใช้ต้องการ feedback ก่อนกดบันทึก

### 5. Approval Re-Submit / Update Policy

ตัดสินใจแล้ว:

- rejected request ต้องสร้างคำขอใหม่เสมอเพื่อ audit ชัดเจน
- delete รายการที่เคย approved ไม่ต้องผ่าน approval
- รายการที่ approved แล้ว ถ้าแก้ amount/title แล้ว match rule อีก ต้อง re-approve เสมอไหม

ยังเหลือ:

- เพิ่ม UX แสดงประวัติคำขอเดิมเมื่อผู้ใช้ส่งใหม่หลังถูก reject
- เพิ่ม tests สำหรับ rejected -> resubmit -> request ใหม่

### 6. Approval Queue Scope

ตัดสินใจแล้ว: `super_admin` เห็นรวมทุกสาขาเป็นค่าเริ่มต้น และมี filter เลือกสาขาได้

ทำแล้ว:

- เพิ่ม filter สาขาใน `IncomeExpenseApprovalModal`

ยังไม่ได้ทำ:

- filter status: pending/approved/rejected
- search by title/requester
- pagination จริง

Recommendation: เพิ่ม filter `pending` ก่อน เพราะใช้งานประจำสุด

## Next Recommended Slice

ถ้าจะทำต่อ แนะนำลำดับนี้:

1. เพิ่ม filter status `pending/all/approved/rejected` ใน `IncomeExpenseApprovalModal`
2. เพิ่ม Playwright/API tests สำหรับ branch transfer derived rows และ approval queue
3. เพิ่ม UX แสดงประวัติคำขอเดิมเมื่อ rejected แล้วส่งใหม่
4. ค่อยพิจารณา strict DB relation model เฉพาะถ้าพบว่าต้องการ audit row จริงใน `income_expense`
