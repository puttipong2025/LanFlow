# ลบประวัติปรับยอดเบิกและชำระส่วนต่างนอกระบบ

สถานะ: ผู้ใช้สั่งเริ่มครบทุก Phase แล้ว พัฒนาและตรวจใน local เมื่อ 2026-10-31; ผลตรวจและข้อจำกัดอยู่ใน withdrawal-adjustment-verification.md ยังไม่ได้ commit, push หรือ deploy Cloud

อ้างอิง: [ADR 0092](adr/0092-delete-unreported-withdrawal-adjustments.md), [อภิธานศัพท์](../CONTEXT.md)

## การลบประวัติ

- แสดงปุ่มคำว่า “ลบ” พร้อมชื่อที่สื่อว่าลบการปรับยอดและ tooltip ตามคำสั่งผู้ใช้ล่าสุด เฉพาะรายการปรับยอดล่าสุดที่อนุมัติแล้วและผู้ใช้มีสิทธิ์จัดการตามกติกาเบิกเงินเดิม โดยปุ่มยืนยันในหน้าต่างใช้คำว่า “ยืนยันลบ” รายการก่อนหน้าแสดงประวัติตามปกติโดยไม่มีปุ่มลบ
- เมื่อลบสำเร็จ ปุ่มลบย้ายไปที่รายการก่อนหน้าซึ่งกลายเป็นรายการล่าสุด แล้วตรวจข้อจำกัดการลบของรายการนั้นใหม่ หากลบไม่สำเร็จปุ่มยังอยู่ที่รายการเดิม และหากไม่มีรายการปรับยอดที่อนุมัติแล้วเหลืออยู่ จะไม่มีปุ่มลบประวัติปรับยอด
- ลบรายการปรับยอดพร้อมผลรับ–จ่ายที่คู่กัน คืนยอดเบิกเป็นยอดก่อนปรับ และคำนวณยอดหักของเดือนเปิดตามกติกาเดิม ทั้งหมดต้องสำเร็จพร้อมกัน
- คงรายการเบิกต้นฉบับและรายงานเดิม รายงานของต้นฉบับเพียงอย่างเดียวไม่ขวางการลบส่วนปรับยอด
- ถ้าส่วนปรับยอดหรือรับ–จ่ายคู่กันเข้ารายงานแล้ว ห้ามลบและแสดงเลขรายงานพร้อมเหตุผล
- ลบได้ตามลำดับย้อนกลับเท่านั้น เช่น 1,000 → 1,500 → 1,200 ต้องลบครั้งหลังให้กลับเป็น 1,500 ก่อน จึงลบครั้งแรกให้กลับเป็น 1,000 ได้ ห้ามลบข้ามรายการที่เข้ารายงานแล้ว
- หากมีคำขอปรับยอดครั้งใหม่รออนุมัติ ห้ามลบฐานยอดของคำขอนั้น ต้องถอนหรือปฏิเสธคำขอใหม่ก่อน ระบบไม่ยกเลิกคำขอให้อัตโนมัติ
- การถอนคำขอที่ยังรออนุมัติเป็น flow เดิม ไม่ใช่การลบรายการปรับยอดที่มีผลแล้ว คำขอที่ถูกปฏิเสธไม่ใช่ยอดล่าสุดที่มีผล

## สิทธิ์และสลิป

- ใช้กติกาเดียวกับเบิกเงิน ทั้งสิทธิ์จัดการพนักงาน ขอบเขตสาขา และข้อจำกัดเดือนที่มีสลิป
- สลิปสถานะรออนุมัติหรืออนุมัติแล้วที่ใช้ยอดหลังปรับขวางการลบ ต้องเปิดเดือนตามขั้นตอนเดิมก่อน แจ้งเดือนและเลขสลิปที่ขวาง
- ไม่แก้สลิปที่ปิดแล้วให้อัตโนมัติ และสลิปเก่าที่ไม่เกี่ยวข้องกับการปรับครั้งนั้นไม่ควรขวางการลบ

## จ่ายนอกระบบ

- เพิ่มตัวเลือก “จ่ายนอกระบบ” ใน dropdown ที่เลือกสาขารับ–จ่ายส่วนต่าง ทั้งกรณีผู้จัดการสร้างปรับยอดให้มีผลทันทีและอนุมัติคำขอของพนักงาน
- ใช้ได้ทั้งปรับเพิ่มและปรับลด เช่น 1,000 → 1,500 คือจ่ายเพิ่มนอกระบบ 500 บาท ส่วน 1,500 → 1,000 คือรับคืนส่วนต่างนอกระบบ 500 บาท
- เปลี่ยนยอดเบิกและยอดหักเงินเดือนตามปกติ แต่ไม่สร้างรับ–จ่ายของสาขา เก็บประวัติยอดก่อนปรับ ยอดหลังปรับ และวิธีชำระไว้ตรวจสอบ
- ข้อความผลกระทบในหน้าต่างต้องตรงกับตัวเลือก ไม่แสดงว่าจะเพิ่มรับหรือจ่ายของสาขาเมื่อเลือกจ่ายนอกระบบ
- การลบส่วนปรับยอดนอกระบบยังใช้ข้อจำกัดลำดับ คำขอรออนุมัติ และสลิปเดียวกัน

## แนวทางดำเนินงานและตรวจสอบ

### ขอบเขตที่เล็กที่สุด

- ขยาย RPC ลบเดิมด้วยทางแยกสำหรับ ADJUSTMENT ก่อนเข้าทางลบต้นฉบับ ใช้สิทธิ์และข้อจำกัดร่วมเท่าที่ตรงกัน แต่ไม่ส่ง adjustment ผ่าน flow ลบ WITHDRAWAL โดยเปลี่ยนเพียง type ที่อนุญาต
- ใช้ admin POST เดิมสำหรับลบรายการที่อนุมัติแล้ว และ user GET เดิมสำหรับอ่านประวัติ ไม่เพิ่มสิทธิ์ลบ approved adjustment ให้ user POST และไม่แก้ flow ถอนคำขอเดิมโดยไม่จำเป็น
- ไม่สร้างตารางคู่รับ–จ่ายใหม่ ไม่สร้าง endpoint ตรวจการลบแยกทุกแถว และไม่เพิ่ม payment/transfer workflow ใหม่
- รับ–จ่ายของ adjustment เป็น derived feed จาก source; ลบ source พร้อม projection ที่เกี่ยวข้องใน transaction เดียว ไม่ค้นแล้วลบ income_expense ที่ไม่เกี่ยวข้อง

### ลำดับคืนยอดและตัวคำนวณ

- Helper เดิม `private.rebuild_open_deductions_for_adjustment` อาศัยแถว adjustment ที่ `p_adjustment_id` ชี้อยู่ จึงห้ามลบแถวแล้วเรียก helper เดิมตรง ๆ
- แยกส่วน rebuild ให้รับรหัส WITHDRAWAL ต้นทาง โดยให้ approval และ deletion ใช้ส่วนคำนวณเดียวกัน เก็บรหัส adjustment สำหรับบริบท audit แยกจากรหัสที่ใช้หา source และรักษา wrapper เดิมเมื่อมี caller/tests พึ่งอยู่
- ขั้นลบต้องเก็บ source ID/ข้อมูลที่ใช้ตรวจสิทธิ์ก่อน แล้วตรวจ latest, pending, reports และ slips ภายใต้ lock ก่อน mutation; ลบ adjustment ด้วย guard เดิมที่อนุญาตเฉพาะเส้นทางนี้ แล้ว rebuild จาก latest target ที่เหลือหรือยอดต้นฉบับ
- ใช้ลำดับ restore-before-delete ของ deduction เดือนเปิดตามเดิม จากนั้น seed remaining ด้วย target ที่เหลือหัก closed floor และใช้ planner เดิม ตรวจกรณีลบการปรับเป็นศูนย์ที่ไม่มี deduction เหลือให้คืนเป็นพิเศษ
- คง Report Lock ของต้นฉบับและข้อยกเว้น settlement ที่แก้ได้เฉพาะ remaining; หากผิดพลาดให้ rollback ทั้งการลบ ยอด และ projection

### สลิปที่เกี่ยวข้องเป็นเงื่อนไขก่อนเริ่มเขียน mutation

- ก่อนแก้คำสั่งลบ ต้องสรุป predicate และตัวอย่างที่ตรวจได้จริงจากเวลาสร้างสลิป เวลาอนุมัติ adjustment, source effective month, deduction ledger และ slip_data ไม่คัดลอกเงื่อนไขเดือนของการลบต้นฉบับมาทั้งชุด
- ตรวจเฉพาะ pending/approved ที่ไม่ cancelled และมีความสัมพันธ์กับยอดหลังปรับ; สลิปก่อนการปรับและสลิปที่ไม่เกี่ยวข้องต้องไม่กลายเป็นตัวขวางเพียงเพราะอยู่ในพนักงานเดียวกัน
- อย่าตรวจ closed floor อย่างเดียว: สลิปอาจรับรู้ยอดหลังปรับใน transactions หรือยอดค้าง แม้ยังไม่มียอดหักจาก source นั้น และ snapshot ของ target ศูนย์อาจไม่มี source row อยู่เลย
- Gate ก่อนเริ่ม Phase ฐานข้อมูลคือมี decision table พร้อมตัวอย่างสลิปก่อนปรับ, หลังปรับที่มี deduction, หลังปรับที่มีเฉพาะยอดค้าง และหลังปรับเป็นศูนย์ พร้อมวิธีระบุเดือน/เลขสลิปจากหลักฐานจริง หากข้อมูล snapshot เก่าไม่พอต้องระบุข้อจำกัดให้ชัด ห้ามถือว่าไม่พบ source ID เท่ากับไม่เกี่ยวข้อง

### จ่ายนอกระบบและ Dashboard

- Request/approval API แยก explicit outside-system ออกจากค่าหายหรือ malformed ให้ชัด และอนุญาต null branch เฉพาะวิธีชำระที่ตั้งใจเลือกตาม contract; ปรับ constraint และ branch validation ที่ขวางใน forward migration
- เมื่อไม่มีสาขารับ–จ่าย ต้องไม่เรียกสร้าง `dashboard_money_events` หรือ branch projection ของ adjustment เพราะตาราง event บังคับ location_id; ไม่แก้ให้ตารางทั้งระบบรับ null และไม่ใช้สาขาสมมติ
- ยังคง source history, วิธีชำระ, ผู้สร้าง/อนุมัติ และ audit ที่จำเป็นตามกติกาเดิม การลบ outside-system ที่ไม่มี branch projection ต้องทำได้โดยไม่ต้องมี event คู่ให้ล้าง
- Branch-backed adjustment ยังคงสร้าง/ล้าง event และ projection ตามเดิม ตรวจ feed และ report eligibility ว่า outside-system ไม่ถูกนับเป็นเงินสาขา

### ข้อมูลหน้าจอและเหตุผลที่ลบไม่ได้

- ขยาย `get_withdrawal_adjustment_summaries` เดิมให้ส่ง `latestApprovedAdjustmentId` โดยใช้ลำดับเดียวกับ latest target: approved_at DESC NULLS LAST, created_at DESC, id DESC และข้าม cancelled/rejected/pending
- เพิ่ม expense_location_id, expense_location_name และ report_lock_no ของ adjustment ใน user GET เดิม; ไม่ใช้ report lock หรือสาขาของต้นฉบับแทนของ adjustment
- UI แสดงปุ่มจากรหัส latest ที่ฐานข้อมูลส่งมา ไม่อนุมานจากแถวแรกที่เรียง created_at และไม่ใช้ยอดเท่ากันตัดสินว่าเป็นรายการเดียวกัน
- ก่อนลบแสดงยอดปัจจุบันกับยอดที่จะคืนกลับ หลัง success โหลด summary/history ใหม่แล้วจึงย้ายปุ่ม เมื่อ failure คงปุ่มและข้อมูลเดิมพร้อมเหตุผลที่อ่านได้
- การขอซ้ำหลังลบต้องอ้าง target adjustment ID เดิมเสมอ ไม่เลือก latest ใหม่แล้วลบให้อัตโนมัติ; กรณีอีกเครื่องเปลี่ยน latest ให้ปฏิเสธพร้อม refresh
- อ่านรายงาน/สลิป/สิทธิ์ใหม่ใน mutation เสมอ แม้หน้าจอเห็นสถานะพร้อมลบอยู่

### รายงานและนับเงินปัจจุบัน

- ใช้ lock ระดับพนักงาน/แถวร่วมกับ `private.lock_report_locations` เดิม จัดลำดับ lock ให้สอดคล้องกับ caller/trigger จริง รวมสาขาของ source และ adjustment ที่ได้รับผล ห้าม bypass guard เพื่อให้ลบผ่าน
- สูตร `private.cash_count_events*` ถูกลบโดย migration 20261024030000 แล้ว ไม่เพิ่มหรือแก้สูตรนั้นกลับมา งานนี้ตรวจ live ledger, branch fence และ immutable snapshots ของระบบนับเงินปัจจุบัน
- เพิ่ม error mapping และ regression สำหรับ CASH_COUNT_ACTIVE และ CASH_COUNT_OVERDUE_LOCKED ทั้งสร้าง/อนุมัติ/ลบ รวม outside-system ซึ่งยังอาจอัปเดต remaining ของต้นฉบับที่ผูกสาขา
- ทดสอบการชนกับ `create_report_batch` จริงและการเปลี่ยน pending/approved ภายใต้ lock ไม่ใช้เพียง insert report_items ผ่าน service role เพื่ออ้างว่าป้องกัน race ได้

### ชุดตรวจที่ต้องเรียกจริง

- รัน focused SQL ของ adjustment และ payment รวมชุดใหม่สำหรับ deletion, floor/snapshot, outside-system, scope และ rollback
- เรียก integration/API จริงและ browser regression ของ adjustment อย่างชัดเจน ชุด UI ที่ mock API ใช้ตรวจปุ่ม/ข้อความได้ แต่ไม่ใช่หลักฐานการคืนยอดจริง
- เพิ่มชุด concurrency ใน `playwright.database.config.ts` ถ้าสร้างไฟล์ใหม่ และเพิ่ม route/logic tests ที่เหมาะสมใน isolated config เฉพาะส่วนที่รันแยกได้
- ระบุชื่อไฟล์และจำนวนที่ถูกค้นพบ/รัน บันทึก skip กับสาเหตุ เพราะ `npm run verify` และ `test:db` ไม่ได้ครอบ integration/browser adjustment ทุกไฟล์โดยอัตโนมัติ
- เมื่อ focused checks ผ่านแล้ว รัน `npm run test:db` กับ `npm run verify` รอบ final ที่ครอบคลุมการเปลี่ยนล่าสุด และตรวจ diff/schema ไม่รันซ้ำหากไม่มีการแก้หรือข้อกังวลใหม่

## แผน 4 ช่วงและจุดผ่าน

1. ตรวจฐานงานและปิด contract: หลังได้รับคำสั่งเริ่ม ต้องมี slip decision table, read/error contract, lock order และรายการชุดตรวจจริง ก่อนเริ่ม migration
2. ฐานข้อมูลและ API: forward migration, helper จาก source ID, ทางแยก delete, outside-system/Dashboard, metadata และ guards ต้องมี focused database/API evidence
3. หน้าจอ: dropdown, latest-only delete, เหตุผล และ success/failure refresh ต้องมี browser evidence
4. ตรวจรวมและเอกสาร: focused integration/concurrency, final checks และ memory ตามผลจริง โดยยังแยกการปล่อย Cloud/commit/push/deploy เป็นคำสั่งต่างหาก

Progress checklist หลักอยู่ที่ Vault codingDO: `10_Daily/2026-10-31 2.md` สถานะและ checkbox ปัจจุบันให้ตรวจใน Daily นั้น ผลตรวจรอบพัฒนาอยู่ใน [verification ledger](withdrawal-adjustment-verification.md)

## หลักฐานที่ใช้ตรวจพฤติกรรมปัจจุบัน

- `supabase/migrations/20260919010000_time_payroll_withdrawal_adjustments.sql`: ยอดล่าสุด ฐานยอด คำขอรออนุมัติ ส่วนต่าง และตัวห้ามลบรายการปรับยอดที่อนุมัติแล้ว
- `supabase/migrations/20260903030000_time_payroll_branch_manager_parity.sql`: สิทธิ์และข้อจำกัดการลบรายการเบิกเงินเดิม
- `supabase/migrations/20260930030000_time_payroll_slip_outstanding_and_missing_badges.sql`: ยอดล่าสุดและ snapshot สลิป
- `supabase/migrations/20261009013000_time_payroll_payment_allocation.sql`: ส่วนขยายวิธีจ่ายและการลบของระบบเวลาและเงินเดือน
- `src/app/api/lanflow/time-tracking/admin/route.ts`: API สร้าง อนุมัติ และลบ พร้อมการแปลงเหตุผลที่ปฏิเสธคำสั่ง
- `src/components/time-tracking/WithdrawalAdjustmentModal.tsx`: หน้าต่างปรับยอดและตัวเลือกสาขาปัจจุบัน
- `src/components/time-tracking/employee/EmployeeTransactionHistory.tsx`: ประวัติปรับยอดใต้รายการเบิกต้นทาง
- `src/components/time-tracking/manager/ManagerDialogs.tsx`: หน้าต่างอนุมัติส่วนต่าง
- `supabase/migrations/20260928010000_pending_work_report_cash_guards.sql`: lock_report_locations ที่ต้องใช้ร่วมกับรายงาน
- `supabase/migrations/20260806010000_dashboard_money_event_history.sql`: event มี location_id บังคับและ writer ของประวัติการเงิน
- `supabase/migrations/20260930020000_allow_central_time_payroll_approvals.sql`: approval trigger ล่าสุดรองรับ null สำหรับ workflow ที่อนุญาตอยู่แล้ว ไม่ต้องนำ guard รุ่นเก่ากลับมา
- `supabase/migrations/20261024010000_independent_cash_counts.sql`: live-ledger cash count และ movement guard
- `supabase/migrations/20261024030000_retire_cash_prediction.sql`: ยกเลิกสูตรคาดการณ์นับเงินเดิม
- `supabase/migrations/20261026020000_cash_count_overdue_lock.sql`: ตัวขวางเมื่อเกินกำหนดนับเงิน
- `playwright.database.config.ts`, `playwright.isolated.config.ts`, `playwright.config.ts`: ขอบเขตชุดทดสอบและไฟล์ที่ต้องเรียกอย่างชัดเจน

## ผลพัฒนารอบสุดท้าย

- ใช้ migration 20261031030000 และ forward fixes 20261031031000/20261031032000 ใน local; ตรวจสิทธิ์ซ้ำหลังรอ employee lock ทั้งการลบและการอนุมัติเพื่อกันการถอนสิทธิ์ระหว่างคำสั่ง
- Forward fixes 20261031033000/20261031034000 ตรวจสถานะล่าสุดหลังรอคำขอ และล็อก payer/parent branches ตามลำดับเดียวกันทั้ง request/approve เพื่อป้องกัน cross-branch deadlock; หลักฐานใน [second scrutiny](withdrawal-adjustment-second-scrutiny-20261031.md)
- Forward fix 20261031035000 ตรวจ active account หลังรอแถวของการถอนคำขอ; GET ของ user/admin คืน 401/403 ตาม RPC เมื่อสิทธิ์เปลี่ยนระหว่างคำสั่ง รายละเอียด [third scrutiny](withdrawal-adjustment-third-scrutiny-20261031.md)
- Forward fix 20261031036000 ใช้เวลาอนุมัติจริงหลังได้ locks สำหรับลำดับ latest และตรวจ active/employee/payer scope ซ้ำหลังรอ branch fence ก่อนลบ; หลักฐาน [fourth scrutiny](withdrawal-adjustment-fourth-scrutiny-20261031.md)
- Forward fix 20261031037000 บันทึก created_at/lockedAt ของสลิปใหม่จาก RPC หลัง employee fence เพื่อให้ snapshot และตัวห้ามลบรับรู้ adjustment ที่อนุมัติก่อนสร้างจริง; คง explicit historical as-of เดิม หลักฐาน [fifth scrutiny](withdrawal-adjustment-fifth-scrutiny-20261031.md)
- ปุ่ม “ลบ” และ “ยืนยันลบ” ตามคำสั่งล่าสุด โหลด interaction/modal แบบ lazy ตาม pattern เดิมเพื่อคงงบ bundle
- รายละเอียดผล SQL/API/browser/concurrency/build อยู่ใน verification ledger และ Daily; ไม่ใช่การ release Cloud
