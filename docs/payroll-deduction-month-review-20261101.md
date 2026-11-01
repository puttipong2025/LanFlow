# ตรวจเดือนหักเบิกและหนี้ — 2026-11-01

สถานะล่าสุด: Local implemented and verified 2026-11-02; ยังไม่ apply Cloud, commit, push หรือ deploy ข้อความการทดลองเดิมด้านล่างเป็นประวัติการวิเคราะห์ก่อนแก้

## ปัญหาที่ผู้ใช้รายงาน

รายการเบิกหรือหนี้เดือนก่อนดูเหมือนมาหักเดือนปัจจุบัน ทั้งที่เดือนก่อนมีวันทำงาน ต้องการกติกาและการแสดงผลที่เข้าใจง่ายที่สุด

## ข้อเท็จจริงที่ตรวจแล้ว

- `CONTEXT.md` นิยามวันที่รายการเป็นตัวกำหนดเดือนเริ่มหัก และให้ใช้ค่าแรงคงเหลือของเดือนนั้นก่อนยกส่วนที่หักไม่หมดไปเดือนถัดไป โดยไม่ให้รายการชนิดใดแซงคิว
- planner ใน `supabase/migrations/20260915010000_time_payroll_wage_recalculation.sql` เริ่มจากเดือนของวันที่รายการ ไล่เดือนเก่าไปใหม่ ใช้วันทำงานกับค่าแรง หักยอดที่จัดสรรแล้ว และข้ามเดือนที่มีสลิป PENDING/APPROVED
- การอนุมัติ/งานหักปกติเติมยอดจัดสรรที่ยังเหลือ ส่วนการแก้ค่าแรงหรือวันทำงานสามารถคำนวณยอดจัดสรรเดือนเปิดใหม่ ตาม ADR-0066/0069
- `EmployeeTransactionHistory.tsx` แสดงวันที่รายการ เวลาสร้าง เวลาอนุมัติ และ applied_month แยกกัน แต่เรียกยอดจัดสรรทั้งหมดว่า “หักแล้ว” แม้เดือนยังเปิด และเรียก remaining_amount ว่า “ยอดค้างยกไปเดือนถัดไป” โดยไม่ระบุเดือนอ้างอิง
- `EmployeeFinancialSummary.tsx` แสดง “ยอดเงินคงเหลือ” และ “ยอดหนี้สินค้างชำระ” โดยไม่มีชื่อเดือนบนการ์ด ข้อสังเกตนี้เป็นประเด็นด้านความชัดเจน ไม่ใช่หลักฐานว่าคำนวณผิด

## บันทึกการทดลอง

1. Local Supabase, transaction ชั่วคราว: สร้างพนักงานทดสอบค่าแรง 100 บาท เริ่มช่วงทำงานต้นเดือนก่อน เพิ่มหนี้อนุมัติแล้ว 500 บาทลงวันที่ต้นเดือนก่อน เรียกเครื่องยนต์หักถึงเดือนปัจจุบัน
2. คำสั่งที่รัน: `Get-Content -LiteralPath "$env:TEMP\lanflow-payroll-month-probe.sql" -Raw | docker exec -i supabase_db_webapp psql -U postgres -d postgres -v ON_ERROR_STOP=1`
3. ผล: `PASS: prior-month wage absorbs prior-month debt` — applied_month = 2026-10-01, หัก 500 บาท, remaining_amount = 0 ไม่มีการหักเดือนปัจจุบันในกรณีนี้
4. ทุกรายการทดสอบ rollback แล้ว ไม่แก้ข้อมูลจริงหรือ Cloud

ข้อจำกัดของการทดลองแรก: ยืนยันเฉพาะกรณีพื้นฐานใน local ไม่ยืนยันว่าข้อมูลหรือระบบที่ผู้ใช้กำลังใช้งานถูกต้องทั้งหมด

## ประเด็นสัมภาษณ์ข้อแรก — ผู้ใช้ยืนยันแล้ว

เดือนก่อนยังเปิด มีค่าแรงเหลือหลังหักรายการอื่น 3,000 บาท และมีรายการเบิก/หนี้ลงวันที่เดือนก่อน 5,000 บาท: ให้หักเดือนก่อน 3,000 บาท แล้วส่งต่อเฉพาะ 2,000 บาทไปเดือนถัดไปหรือไม่

คำตอบผู้ใช้: ยืนยัน ให้หักค่าแรงคงเหลือของเดือนก่อน แล้วส่งต่อเฉพาะส่วนที่ไม่พอไปเดือนถัดไป

ผู้ใช้ให้ข้อมูลเพิ่ม: เมื่อบันทึกปฏิทินเดือนก่อน รายการเบิกที่เดิมหักเดือนปัจจุบันย้ายกลับมาหักเดือนก่อนตามต้องการ แต่ก่อนบันทึกก็มีค่าแรงเดือนก่อนอยู่แล้ว

## การทดลองที่สอง — แยกผลของการบันทึกปฏิทิน

- คำสั่ง: `Get-Content -LiteralPath "$env:TEMP\lanflow-payroll-stale-allocation-probe.sql" -Raw | docker exec -i supabase_db_webapp psql -U postgres -d postgres -v ON_ERROR_STOP=1`
- สร้างกรณีจำลองที่มีค่าแรงเดือนก่อน 3,100 บาท หนี้ 100 บาทลงวันที่เดือนก่อน และมีผลหักเดิม 100 บาทอยู่เดือนปัจจุบันจน remaining_amount เป็นศูนย์ ทั้งสองเดือนยังเปิด
- เรียกเครื่องยนต์ปกติ: คืน deducted = 0 และผลหักยังอยู่เดือนปัจจุบัน
- เรียก public RPC บันทึกปฏิทินเดือนก่อนด้วยรายการวันหยุดว่างชุดเดิม: คืน changed = 0 แต่ deductionsChanged = true และผลหัก 100 บาทย้ายกลับเดือนก่อน
- รันทดสอบสำเร็จสองครั้ง ผลเหมือนกัน ทุกครั้ง rollback หลังตรวจผล
- การเตรียม fixture สองครั้งแรกถูก constraint ปฏิเสธ (สิทธิ์พิเศษต้องเป็น admin และมี super_admin ได้คนเดียว) จึงใช้ admin ที่มีสิทธิ์จัดการส่วนกลาง ไม่มีการเปลี่ยน constraint หรือข้อมูลที่ใช้งานจริง

ผลที่พิสูจน์ได้: การเพิ่มวันทำงานไม่ใช่เงื่อนไขจำเป็นสำหรับการย้ายยอด การกดบันทึกข้อมูลเดิมก็เรียกการจัดสรรใหม่ได้ ส่วนเครื่องยนต์ปกติไม่จัดยอดที่หักไปแล้วใหม่แม้เดือนก่อนมีค่าแรงเหลือ

เส้นทางโค้ด:

- `private.apply_time_tracking_deductions` เรียก planner ด้วย p_rebuild_open = false จึงคงผลหักเดิม และ parent ที่ remaining_amount = 0 ไม่ถูกนำมาจัดสรรต่อ
- `public.deduct_debts_daily` เลือกเฉพาะพนักงานที่มี parent อนุมัติแล้วและ remaining_amount > 0 จึงไม่ตรวจแก้กรณีจัดสรรหมดแล้วแต่ยังอยู่ผิดเดือน
- `public.replace_time_payroll_attendance_exceptions` เรียก `private.rebuild_open_deductions_after_attendance` ซึ่งเรียก planner ด้วย p_rebuild_open = true คืนยอดจัดสรรของเดือนเปิดแล้วเรียงเดือนใหม่ตามกติกาเดิม แม้ changed = 0

ขอบเขตข้อสรุป: พิสูจน์กลไกที่คงยอดเก่าไว้และทำให้การบันทึกปฏิทินแก้ได้แล้ว แต่ยังไม่ทราบเหตุการณ์ต้นทางที่ทำให้รายการจริงของผู้ใช้ไปหักเดือนปัจจุบันตั้งแต่แรก ต้องตรวจลำดับ audit ของพนักงานที่เกี่ยวข้อง ไม่ถือว่าการ seed ผลหักเดิมเป็นหลักฐานของเหตุการณ์ต้นทาง

แนวทางเสนอ ยังไม่อนุมัติ implementation: ทำให้การตรวจยอดหักของเดือนเปิดใช้กติกาจัดสรรเดียวกัน ไม่ปล่อยให้การบันทึกปฏิทินเป็นวิธีกระตุ้นแก้ยอด ผู้ใช้ไม่ต้องกดบันทึกวันทำงานซ้ำเพื่อให้เดือนหักถูกต้อง และต้องไม่แก้ยอดของเดือนที่ปิดสลิปแล้ว

กติกาที่ผู้ใช้ยืนยันตรงกับคำศัพท์ “การหักรายการย้อนหลัง” และ “ยอดจัดสรรหักเงินเดือนชั่วคราว” ที่มีอยู่ใน CONTEXT.md จึงไม่สร้างคำศัพท์ซ้ำ ยังไม่สร้าง ADR ใหม่เพราะยังไม่เลือกขอบเขตและจุดเรียกการจัดสรรใหม่ร่วมกัน

## ตรวจกรณี Production ที่ผู้ใช้ระบุ — อ่านอย่างเดียว

เป้าหมาย: linked Production project `psxwhhwjmolqperxrlzj`, migration ล่าสุดขณะตรวจ `20261101023000`, วันที่ 2026-11-01 ประมาณ 22:27–22:32 น. เวลา Bangkok ใช้ข้อมูลเชื่อมต่อ Production ที่มีอยู่และตรวจ hostname ให้ตรง project ref ก่อนเชื่อมต่อ บังคับ default_transaction_read_only และเปิด transaction READ ONLY ทุก query ไม่เรียก mutation หรือ worker บน Cloud

สรุปจากหลักฐานโดยไม่เก็บชื่อบุคคล รหัสพนักงาน หรือแถวข้อมูล Production ดิบในเอกสาร:

1. Audit วันที่ 31 ต.ค. เวลา 20:00:15 บันทึกการเปลี่ยนค่าแรงจาก 0 เป็น 600 บาท ผล preview/rebuild ณ เวลานั้นระบุ ก.ย. และ ต.ค. เป็น closed = true, slipStatus = APPROVED จึงไม่มีการหักเพิ่มในสองเดือนนั้น
2. Audit วันที่ 1 พ.ย. เวลา 15:09:42 บันทึกการหักเงินเบิกของ ก.ย. รวม 16,800 บาทไว้ใน ต.ค.
3. วันที่ 1 พ.ย. เวลา 16:09:23 การบันทึกปฏิทิน ก.ย. เรียก attendance rebuild ผลก่อนคำนวณมีการหัก ต.ค. 16,800 บาท ส่วนผลหลังคำนวณมี ก.ย. 16,800 บาทและ ต.ค. 10,000 บาท ค่าแรงตามวันทำงานทั้ง ก.ย./ต.ค. เท่ากับ 16,800 บาทต่อเดือน
4. Snapshot หลัง rebuild ระบุทั้งสามเดือน ก.ย.–พ.ย. เปิดอยู่ และขณะตรวจไม่มีสลิปของกรณีนี้ จึงยืนยันการเปลี่ยนจากเดือนปิดกลับเป็นเดือนเปิดได้ แต่ยังระบุเวลาลบสลิปจริงไม่ได้ เพราะ RPC ลบสลิปพร้อม audit ของสลิป และไม่มี deletion receipt สำหรับ payroll ในตาราง document_deletion_audits
5. นิยาม RPC ลบสลิปบน Production ลบสลิปและข้อมูลผูกพันแล้ว return โดยไม่เรียกจัดสรรยอดหักใหม่ Trigger DELETE ของสลิปที่ตรวจไม่เรียก deduction/rebuild เช่นกัน ส่วน engine ปกติยังใช้ p_rebuild_open = false

ข้อสรุป: การมีค่าแรงที่แสดงย้อนหลังไม่เพียงพอเมื่อการคำนวณก่อนหน้าพบเดือนปิดอยู่ หลังเปิดเดือนกลับ เส้นทางลบสลิปไม่จัดยอดใหม่ และเครื่องยนต์แบบเพิ่มยอดไม่ย้ายยอดเดิมกลับ การบันทึกปฏิทินจึงเป็นตัวกระตุ้นที่ทำให้ยอดกลับถูกเดือน ข้อสรุปนี้ตรงกับ audit ของกรณีจริงและ local reproduction ไม่ได้สรุปว่าพนักงานเพิ่งมีวันทำงานเมื่อกดบันทึกปฏิทิน

ข้อเท็จจริงด้าน runtime ที่ต้องแยกจากเอกสารเก่า: Production ไม่มี cron deduct-debts-daily แล้ว โดยฟังก์ชัน activation ของโหมด EXCEPTIONS ยกเลิก job นี้ตามการออกแบบ จึงไม่วินิจฉัยว่า scheduler เสียเพียงเพราะไม่มี job และไม่ถือว่าฟังก์ชัน deduct_debts_daily ที่ยังอยู่ใน catalog กำลังรันทุกวัน

## การทดลองที่สาม — เส้นทางเปิดเดือนกลับจริงใน local

- คำสั่ง: `Get-Content -LiteralPath "$env:TEMP\lanflow-payroll-reopen-month-probe.sql" -Raw | docker exec -i supabase_db_webapp psql -U postgres -d postgres -v ON_ERROR_STOP=1`
- สร้างเดือนก่อนที่มีค่าแรงและมีสลิป APPROVED พร้อมรายการหนี้ลงวันที่เดือนก่อน โดยยังไม่ได้ seed child deduction
- เครื่องยนต์ปกติข้ามเดือนก่อนที่ปิดและสร้างผลหักในเดือนปัจจุบันเอง
- เรียก public RPC ลบสลิปเดือนก่อนเพื่อเปิดเดือนกลับ จากนั้นเรียกเครื่องยนต์ปกติอีกครั้ง ผลหักยังอยู่เดือนปัจจุบัน แม้ค่าแรงเดือนก่อนเหลือ 3,100 บาท
- เรียก public RPC บันทึกปฏิทินเดือนก่อนด้วยข้อมูลเดิม ผล changed = 0 แต่ deductionsChanged = true และผลหักย้ายกลับเดือนก่อน
- ผลสอดคล้องกับการทดลองสองครั้งก่อน โดยไม่ต้อง seed child allocation ผิดเดือนเอง ทุกขั้นตอนทดลองใน local และ rollback แล้ว

## ข้อตกลงที่ผู้ใช้ยืนยันภายหลัง

ผู้ใช้ยืนยันแล้ว: เมื่อเปิดเดือนกลับจากการลบหรือปฏิเสธสลิป ให้จัดยอดหักใหม่ของทุกเดือนที่ยังเปิดทันทีในคำสั่งเดียวกัน โดยคงเดือนที่ยังปิดไว้ เพื่อไม่ต้องกดบันทึกปฏิทินซ้ำ ขอบเขตเส้นทางปฏิเสธสลิปและผลกระทบข้ามเดือนยังต้องตรวจให้ครบก่อน implementation

ไม่มีการเปลี่ยนข้อมูลแม่แบบ ข้อมูลพนักงาน ยอดหัก สลิป หรือกติกาบน Production ระหว่างการตรวจนี้


## ผลดำเนินงาน — Local verified 2026-11-02

แผนที่ผู้ใช้สั่งให้ทำและติดตาม checklist อยู่ใน vault `codingDO`, `10_Daily/2026-11-01 1.md` ใช้ karpathy-guidelines, baseline-ui, debug-mantra, scrutinize และ project memory writer ควบคุมงาน ไม่มี production mutation จากงาน implementation นี้

- Migration `20261101050000_payroll_reopen_and_attendance_revision.sql` ใช้ planner และ rebuild เดิมร่วมกันผ่าน helper `private.rebuild_open_time_payroll_deductions` โดย attendance helper เดิมเป็น wrapper บาง ๆ ไม่คัดลอกสูตร การลบสลิป PENDING/APPROVED ที่ไม่ยกเลิกและการปฏิเสธสลิปจะจัดยอดเดือนเปิดใหม่ใน transaction เดียวกัน กรณีตัดสินซ้ำ/lบ REJECTED ไม่เปลี่ยนตัวตนผลหัก และ audit เหตุเปิดเดือนใช้ `RECALCULATE_REOPENED_MONTH_DEDUCTIONS`
- ไม่เปลี่ยนการหักรายวันหรือเพิ่ม cron ใหม่ คงเดือนปิด สิทธิ์ Report Lock และ source-owned payment/transfer รวม rollback ทั้งคำสั่งหากจัดยอดหักไม่สำเร็จ
- Attendance GET เพิ่ม `revision` จากข้อมูลช่วงทำงาน/ข้อยกเว้นของเดือนที่อ่าน POST และ public RPC ต้องรับ `expected_revision` / `p_expected_revision` และตรวจภายใต้ attendance lock เดิมก่อนแทนข้อมูลทั้งเดือน ผู้ใช้ข้อมูลเก่าได้รับ 409 `ATTENDANCE_STALE` พร้อมข้อความโหลดใหม่ Public RPC ที่ไม่ส่ง revision ถูกปฏิเสธ และ unchecked writer ถูกย้ายเข้า private พร้อมถอนสิทธิ์ตรงของ client ไม่มีระบบเก็บ/กู้/รวมร่าง
- `PayrollRefresh.tsx` เป็นเจ้าของรอบ TanStack Query 60 วินาทีเพียงจุดเดียวของมุมมองเงินเดือนที่เปิดอยู่ ทุกมุมมองลงทะเบียนตัวอ่านเดิมเพื่อรีเฟรชร่วมหลัง mutation และเมื่อ focus/reconnect ใช้ขอบเวลา payroll เดิมต่อ ส่วน timer Badge เดิมพักเฉพาะเมื่อเปิดโมดูลเงินเดือนและรับ invalidation จากเจ้าของรอบนี้ ไม่อาศัยจำนวน Badge เปลี่ยนเป็นสัญญาณ และไม่เพิ่ม websocket หรือระบบกลางทั้งเว็บ
- อ่านล่าสุดล้มเหลวรักษาหน้าข้อมูลเดิมและมีข้อความ/ปุ่มลองโหลดใหม่ แยกจาก mutation ที่สำเร็จแล้ว Badge ยังคง fail closed เมื่อ RPC ล้มเหลวพร้อมข้อความว่าโหลดไม่ได้ แทนการทำให้เข้าใจว่าไม่มีงาน
- เติม synchronous locks ที่ตั้งค่าเวลาสิ้นสุดวัน ค่าแรง และ approval/ขั้นตอนกรอกเบิก แก้ busy attendance response ไม่ให้คืน success และป้องกันปิดหน้าพนักงานระหว่างคำสั่ง ปุ่มวิธีจ่าย/ปรับยอดใช้ตัวกันเดิม การลบเบิก/หนี้/สลิปใช้ AlertDialog เดิมพร้อมสถานะ busy และ inline error
- ลบ callback รีเฟรชเจ้าของเดิมที่ซ้ำกับทางรีเฟรชร่วม และตัด invalidation Badge ที่ซ้ำใน employee/manager จึงไม่เพิ่มระบบ callback อีกชุด

### หลักฐานตรวจรับ

- DB focused: 10 ชุด / 187 assertions ผ่าน ครอบคลุม debt/withdrawal, เปิดเดือน, closed snapshot, no-op identity, atomic rollback, สิทธิ์ helper, Report Lock, payment, wage และ source details
- Real concurrent connections: `playwright.payroll-db.config.ts` 1/1 ผ่าน ยืนยัน writer ที่รอ lock ตรวจ revision หลังอีก transaction commit แล้วจึงปฏิเสธข้อมูลเก่า
- Route/isolated: `playwright.payroll-unit.config.ts` 51/51 ผ่าน รวม revision validation, conflict 409, error redaction และ Badge/focus/cutoff contract
- Browser component integration: `playwright.payroll-ui.config.ts` 10/10 ผ่าน ใช้ payroll components จริงและ mock read/write transport เพื่อยืนยัน single write, directory/Badge refresh, stale-calendar conflict, minute refresh ที่ Badge เท่าเดิม, hidden/offline/reconnect, write-success/read-error และ delete confirmation กรณีส่วน header แสดง Badge ใช้ hook จริงใน fixture; ไม่อ้างว่าทุก Production screen ถูก click ทดสอบแล้ว
- Existing backend/API integration: 4/4 ผ่าน ครอบคลุม attendance rebuild/no-op, fragmented allocation identity, rollback และ reported withdrawal settlement; existing UI contracts 18/18 ผ่าน
- RED/GREEN: reopen SQL ก่อนแก้ fail สอง assertions แล้วผ่าน; UI fixture ที่โหลด component จาก HEAD แสดง adminReads คง 1 หลังสร้างหนี้ ขณะที่ implementation ใหม่รีเฟรชได้ ทดสอบ baseline ไม่แก้ source ใน working tree
- Strict source TypeScript/unused, scoped ESLint, source-size/import direction, local DB lint ระดับ error และ schema function/ACL parity ผ่าน
- Production build ผ่านในสำเนาแยกเพื่อไม่ชน `.next` ของงานอื่น Service Worker และ bundle budget ผ่าน โดยไม่เพิ่มเกณฑ์: first load 298.8/320.0 kB, dynamic payroll ประมาณ 122.6 kB raw และ 28.7 kB gzip ต่ำกว่าเกณฑ์เดิม
- ตรวจภาพ error ที่หน้ากว้าง 360px แล้ว ข้อความ/ปุ่มยังอ่านและใช้ได้ ไม่มี layout redesign

### Scrutinize: เส้นทางและสิ่งที่แก้เพิ่มจากการรีวิว

1. ลบ/ปฏิเสธสลิป → financial lock เดิม → เปลี่ยนสถานะ/ลบ → shared rebuild → child balances/audit → commit ถ้า child apply ล้มเหลวทั้งสลิปกับยอดย้อนคืน ไม่ acquire attendance lock ย้อนลำดับขณะถือ financial lock
2. Calendar snapshot → pin revision ณ เริ่มแก้ → API validation → attendance lock → fingerprint check → unchecked private writer → rebuild ข้อผิดพลาดไม่ถูกแปลงเป็น success และ old public callers ไม่สามารถข้าม guard
3. Mutation success → shared mounted readers + Badge invalidation → view state ปัจจุบัน การ refresh error ไม่ทำให้ฟอร์มส่ง POST เดิมใหม่ คำตอบอ่านเก่าถูก request-id guard เดิมกันไว้
4. รีวิวพบ callback refreshOwner และ direct Badge invalidation เดิมซ้ำกับ coordinator ใหม่ จึงลบส่วนที่เป็น orphan แทนเก็บสองระบบ รีวิวพบปุ่มปิดพนักงานยังเปิดระหว่าง calendar mutation จึงส่งสถานะ busy ไปที่ ModalShell เดิม
5. Initial UI run ผ่านแอปหลักติด modal/auth และ `.next` ที่มีงานอื่นใช้อยู่ จึงไม่ใช้เป็น verdict ของ feature ย้ายไป fixture แยก port 3017/output ของตัวเอง Build snapshot รอบแรกขาด shared Edge-function re-export จึงเติมไฟล์ประกอบแล้ว build ใหม่ ไม่แก้ product เพื่อกลบ fixture error

Verdict: local ready for review; Production deployment is a separate authorized step. ก่อนเผยแพร่ต้องนำ migration/API/UI ขึ้นให้สอดคล้องกัน client รุ่นเก่าที่ไม่ส่ง revision จะถูกปฏิเสธอย่างปลอดภัยและต้องโหลดรุ่นใหม่ ไม่มี backfill หรือ repair ยอดของบุคคลใดบน Cloud จากงานนี้

## Automatic Business Logic / Route scrutiny — 2026-11-02

Scope: current payroll/time changes, their API routes, attendance actions and the refresh/Badge path; unrelated bill-device/report changes are excluded. Goal: remove proven dead code and fix reproducible failures without adding a parallel service or changing payroll formulas.

Simpler alternative: keep the existing RPC error mapper, mutation locks and attendance actions; add one shared connection-error classifier and small guards. No new framework, polling channel, draft storage, migration or production mutation is needed.

### Debug ledger

The deterministic tests load the actual Route/action modules with controlled RPC/HTTP responses, and the browser fixture renders actual components with delayed transport. A debugger is not attached to these isolated source-module executions; source tracing is used at the response/error branch. Hypotheses, ranked before fixing:

1. Connection failures are classified from their message alone, losing the RPC error code; alternatives: authentication classification is broken, or the mock never reaches the mutation RPC. Disproof controls `P0001/INVALID_AMOUNT` and `P0001/Forbidden` passed for both routes. In the same test, `PGRST000`, `08006`, and `PGRST003` returned 400 instead of 503/504 in both routes. Path: POST DELETE_TRANSACTION → actual RPC → rpcFailure → message-only status mapper. `output/payroll-scan-route-red.log`: 6 failed, 4 passed. Fix: share only connection-code handling before existing business mapping, redact upstream details and ask the user to inspect current data rather than blindly repeat a write. Code/status mapping follows [PostgREST error documentation](https://docs.postgrest.org/en/stable/references/errors.html).
2. A delayed calendar save still permits switching months; alternatives: parent dialog already prevents it, or the save never becomes busy. Real browser test waits for exactly one write, then checks both navigation buttons; previous-month button remains enabled. Path: AttendanceCalendar.save → EmployeeAttendanceActions → pending transport; calendar navigation had no saving guard. `output/payroll-scan-ui-red.log`: 1 failed. Fix: disable both existing month buttons while saving/loading; the same test verifies they unlock after completion.
3. Optional response JSON parsing converts an acknowledged save into a failure; alternatives: HTTP status is actually unsuccessful, or the mutation lock refuses the action. For both calendar replacement and period-start correction, HTTP 400 with invalid JSON correctly remains an error and releases the lock. HTTP 200 with invalid JSON or JSON null incorrectly reports failure and skips the read. `output/payroll-scan-actions-red.log`: 4 failed, 2 passed. Path: successful response → unguarded json()/json.result → catch → failure message. Fix: tolerate missing optional result metadata after HTTP success, refresh current data and retain the saved outcome.

All three fixes passed against the same repros; business errors and failed HTTP writes retain their previous behavior. `output/payroll-scan-unit-green.log`: 67 passed. `output/payroll-scan-ui-green.log`: 11 passed. Strict source TypeScript unused-local/parameter scan, main typecheck, scoped ESLint, source-size and import-direction checks passed. Named runtime-export scan covered 79 exports: the only function without another-file caller, millisecondsUntilNextPayrollCutoff, is called inside its own module and tested directly. No proven dead code was deleted. Migration/rebuild, authorization, settled-month preservation and revision lock ordering were traced without another confirmed defect.

Optimized build passed in the existing isolated local snapshot after copying all five changed product files; service-worker and bundle-budget checks passed there. First load 298.8/320 kB; Time/Payroll 122.7 kB raw / 28.8 kB gzip within the unchanged budget. Verdict: local fixes verified and ready for review; deployment remains separate.

### Second automatic scan — 2026-11-02

Intent: recheck the same payroll Business Logic/Route scope after the preceding fixes. Simpler-alternative pass: leave the working calculation and refresh design in place; no extra helper/service is justified by this scan.

- Removed one unused catch binding in `src/components/time-tracking/manager/ManagerWorkspace.tsx` (submitApproval transport catch). The branch uses the existing failureMessage and providedComment, never the caught error value; retain its error handling unchanged. No test was added merely for this cleanup.
- Trace/control ledger: suspected cross-month summary mixing is disproved because attendance and totals RPCs both receive the same requested `month` in `user/route.ts`; suspected stale payroll employee props are disproved by ManagerWorkspace resolving `payrollUser` from the current users array on each render. Legacy CHANGE_EXPENSE_LOCATION is retained because it remains a tested Route contract; absence of a current UI caller alone does not prove a public action is dead.
- Re-ran actual Route/action regressions, including validation-before-RPC, authentication errors, redaction, connection error classification and acknowledged-save response decoding: `output/payroll-rescan-unit.log`, 67 passed. Actual-component browser regressions cover mutation guards, delayed calendar save, read failures, Badge freshness and reconnect/visibility: `output/payroll-rescan-ui.log`, 11 passed. Strict TypeScript unused/type scan and scoped ESLint passed (`output/payroll-rescan-unused.log`, `output/payroll-rescan-lint.log`); changed-file whitespace check passed.
- No additional reproducible bug or demonstrated performance bottleneck found in this bounded scan. No formula, database migration, Route contract, Production data, commit or deployment changes. Build was not repeated for the unused catch binding; the preceding verified build remains the build evidence. Verdict: ship local cleanup for review; no new blocker identified within the inspected scope.
