# Time/Payroll manager parity — implementation and review

Intent: ให้ Admin ที่ได้รับสิทธิ์จัดการเวลาและเงินเดือนครบภายในสาขาหลักและสาขาผู้จ่ายที่ดูแล พร้อมเลือกวิธีจ่ายก่อนรายการมีผล โดยใช้โครงสร้างเดิม

Simpler-alternative review: ใช้ predicate ขอบเขตพนักงานและ toggle เดิม แทนการเปลี่ยนความหมายของผู้จัดการระบบ; ใช้ modal วิธีจ่ายร่วมกันแทนเพิ่มหน้าต่างชุดที่สาม ไม่มีตาราง คอลัมน์ role หรือ toggle ใหม่

## Experiment ledger

| Run | Result | Conclusion |
| --- | --- | --- |
| Local migration 20260903030000 | Applied | ฟังก์ชันเดิมและ overload วิธีจ่าย compile ใน Local โดยไม่ reset ข้อมูล |
| TypeScript หลังเชื่อม API/modal | Passed | รูปแบบ props และ API callers ที่แก้สอดคล้องกัน |
| pgTAP parity ครั้งแรก | Fixture failed ก่อน assertions: super admin ซ้ำ | ระบบมี super admin ได้บัญชีเดียว; เปลี่ยน fixture ให้ใช้บัญชี Local เดิม |
| pgTAP parity ครั้งที่สอง | 37/37 passed | ตรวจสิทธิ์รายบุคคล ผู้จ่าย Config การอนุมัติตนเอง การถอนสิทธิ์ และ rollback เมื่อยอดสลิปเปลี่ยน |
| Browser/API regression ครั้งแรก | 36 passed, 2 failed, 4 skipped จาก serial failure | พบ expected รายชื่อผู้จ่ายแบบทุกสาขาตามกติกาเก่า และ source-text assertion รูป payload เดิม; browser modal/refresh/focus ที่รันผ่านทั้งหมด ปรับ test ให้ยึด contract ใหม่ |

| pgTAP parity หลังเพิ่ม resume boundary และ admin-only gate | 39/39 passed | zero-day END คืนเฉพาะ boundary โดยไม่เปิด audit และ role user รับสิทธิ์ delegated ไม่ได้ |
| Focus/payment browser | 3/3 passed | cancel คืน focus, error คง modal, create เลือกผู้จ่ายก่อนมีผล และจอ 390px ไม่ล้น |
| Focused browser/API regression | 59 passed ก่อนเปิด backend ทั้งไฟล์ | access, badge, attendance modal, money contract และ payment flow ผ่าน |
| Exception backend contract | 24 passed, 1 time-dependent skipped | period, attendance, approval, deduction, payment, RLS และ audit visibility ผ่าน |
| DB suites | 66 passed รวม parity | access boundary, cutoff และ parity ผ่าน |
| DB lint | No schema errors | `public` และ `private` ไม่มี error |
| `npm run verify` | Passed | typecheck, production build และ service-worker check ผ่าน |
| Dead-code/bug scrutiny | Passed | ลบ `catch { throw }` ที่ไม่มีผล, ยืนยันด้วย AST ว่า declaration ที่เหลือในไฟล์เปลี่ยนมี caller หรือเป็น export, และเพิ่ม browser regression สำหรับข้อความ/ทางออกเมื่อปฏิเสธรายการผ่าน network ไม่สำเร็จ |

## Scrutinize verdict

Call graph ที่เปลี่ยนจบที่ RPC ซึ่งตรวจ target profile และ payer เดิม/ใหม่ซ้ำ ไม่พึ่งการซ่อนปุ่มใน UI รายการที่จ่ายจากสาขานอกขอบเขตยังอ่านชื่อผู้จ่ายจริงผ่าน computed field แต่ mutation ถูกปฏิเสธ Config ตรวจ super admin ทั้ง route และ RPC การสร้างสลิปใช้ quote เพื่อ UX และตรวจยอดจริงซ้ำใน transaction เดียวก่อนอนุมัติ จึงไม่มีช่องสร้างด้วยยอดเก่า

พบและแก้ระหว่าง review ห้าจุด: resume หลัง zero-day END โดยไม่เปิดสิทธิ์ audit, role user ที่มี flag ผิดปกติไม่ผ่าน helper, native modal ที่คืน focus ผิดเมื่อ autofocus ทำงานก่อน effect, กล่องปฏิเสธที่ใช้ข้อความอนุมัติ, และ network failure จาก decision dialog ที่เคยหลุดเป็น unhandled promise พร้อมลบ catch ที่โยน error เดิมซ้ำ

ตรวจสมมติฐานว่า payroll preview อาจต่างจากยอดสร้างจริงแล้วไม่พบ defect: `private.apply_time_tracking_deductions` รักษา invariant ว่า deduction ที่ลงบัญชีแล้วบวก `remaining_amount` คือภาระสูงสุดที่ยอดงวดปัจจุบันต้องรับ และ RPC สร้างยังตรวจ `p_expected_net_pay` ซ้ำภายใต้ employee lock หากสถานะเปลี่ยนระหว่าง preview กับ submit จึงคงสูตรอ่านอย่างเดียวไว้แทนการเรียก mutation แล้ว rollback ส่วน overload รูปแบบเก่าของ create RPC ยังมี caller ในชุด regression และเป็น rollback compatibility surface จึงไม่ใช่ dead code ที่ลบได้ในงานนี้

ไม่เหลือ finding ระดับ blocker/high ในขอบเขตนี้
