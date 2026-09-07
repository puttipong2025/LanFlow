# แผนเพิ่มสิทธิ์จัดการส่งออกยางให้ Admin

สถานะ: ดำเนินการครบและตรวจผ่านเมื่อ 2026-09-07

อ้างอิง: [ADR-0063](adr/0063-delegate-rubber-export-management-within-assigned-branches.md)

## ขอบเขตที่ยืนยัน

- เปิดสิทธิ์ให้ Admin รายบัญชีจัดการงานส่งออกยางได้เหมือนผู้จัดการระบบ เฉพาะสาขาที่บัญชีดูแล
- อำนาจที่เพิ่มมีเฉพาะตรวจสอบ ลบ และดูประวัติการลบรายการส่งออกยาง
- ปิดสิทธิ์แล้ว Admin ยังคงดู สร้าง แก้ฉบับร่าง และใช้คำสั่งพื้นฐานเดิม
- Super Admin และผู้จัดการระบบเปิด–ปิดสิทธิ์ได้ ผู้ได้รับสิทธิ์ส่งออกยางมอบหมายต่อไม่ได้
- การระงับบัญชีหยุดการใช้และการแก้สิทธิ์ แต่เก็บค่าเดิมไว้เพื่อคืนเมื่อกู้บัญชี การลดบทบาทเป็น User จึงเป็นกรณีที่ต้องล้างสิทธิ์
- สิทธิ์ใหม่ไม่ข้ามสถานะรายการ, Report Lock, บิลรับยาง, WEX reservation, audit หรือกฎค่าใช้จ่ายเดิม

## ขอบเขตการแก้ที่เล็กที่สุด

- ใช้ Boolean capability ใหม่หนึ่งค่า ไม่เพิ่ม role หรือ permission table
- ไม่เปลี่ยน navigation หรือสิทธิ์พื้นฐานของ Rubber Export
- ไม่แก้ create, preview, options, edit membership, update draft หรือ sold-out flow
- ไม่ขยาย `private.can_delete_reports()` เพราะจะให้อำนาจลบรายงานและเอกสารชนิดอื่น
- ให้ RPC เป็นจุดตัดสินสิทธิ์สุดท้ายของคำสั่งตรวจสอบและลบ เพื่อตรวจข้อมูลและสิทธิ์ใน transaction เดียว

## Phase 1 — Schema และ capability

- [x] เพิ่ม forward migration สำหรับ `profiles.can_manage_rubber_exports boolean not null default false`
- [x] ขยาย `profiles_admin_only_elevated_access` ให้ capability เป็นจริงได้เฉพาะ role `admin` โดยไม่ผูก constraint กับ `is_active`
- [x] เพิ่ม `private.can_manage_rubber_exports(location_id)` ซึ่งอนุญาตผู้จัดการระบบทุกสาขา หรือ active Admin ที่เปิด capability และยังได้รับมอบหมายสาขานั้น
- [x] แก้ role-demotion update ให้ล้าง capability ใหม่พร้อมสิทธิ์เสริมเดิมใน statement เดียว รวม concurrent demotion/grant boundary
- [x] ใช้ database default กับบัญชีใหม่ ไม่แก้ `create_admin_user_profile` เพียงเพื่อส่งค่า `false`

## Phase 2 — Admin permission control

- [x] เพิ่ม capability ใน type, effective-capability mapping, server auth profile และ Admin users response; ไม่เพิ่มใน `/api/auth/me` เพราะ client profile ปัจจุบันไม่ใช้ค่านี้
- [x] เพิ่ม `PATCH /api/lanflow/admin/users/[id]/rubber-export-access` ตามรูปแบบ Time/Payroll: ผู้ดำเนินการต้องเป็น Super Admin หรือผู้จัดการระบบ และเป้าหมายต้องเป็น active Admin ที่ไม่ใช่ผู้จัดการระบบ
- [x] เพิ่มปุ่ม `เปิดสิทธิ์จัดการส่งออกยาง` / `ปิดสิทธิ์จัดการส่งออกยาง` พร้อม confirmation และ server-confirmed state update
- [x] แสดง `ต้องตั้งเป็น Admin ก่อน` สำหรับ User, readonly เมื่อบัญชีถูกระงับ และ automatic state เมื่อเป็นผู้จัดการระบบ
- [x] เพิ่ม capability ใน response/state patch ของ system-manager toggle เพื่อให้สถานะหลังเปิด–ปิดผู้จัดการระบบไม่ค้างจน reload

## Phase 3 — Rubber Export authorization

- [x] คง helper สิทธิ์พื้นฐานสำหรับดู สร้าง และแก้ฉบับร่าง แล้วเพิ่ม helper แยกสำหรับสิทธิ์จัดการตามสาขา
- [x] ให้ GET list คำนวณ `canVerify` และ `canDelete` จากสิทธิ์จัดการของสาขาปัจจุบัน และให้ deletion view ใช้เงื่อนไขเดียวกัน
- [x] เปลี่ยน verify/delete route จาก `requireSystemManager` เป็น `requireAuth` โดยไม่ prefetch เพื่ออนุมัติคำสั่งใน API; ให้ RPC ตรวจสิทธิ์จริงจากข้อมูลที่ล็อกแล้ว
- [x] ใน `verify_rubber_export_atomic` ให้ล็อกและโหลด export แล้วตรวจ capability ด้วย `export.location_id` ก่อน mutation
- [x] ใน `delete_rubber_export` ให้ล็อกและโหลด export แล้วตรวจ capability ด้วย `export.location_id`; กรณีลบซ้ำให้โหลด audit และตรวจ `audit.location_id` ก่อนคืนผล idempotent
- [x] แก้ RLS ของ `document_deletion_audits` เป็นสิทธิ์ผู้จัดการระบบเดิม หรือ `document_kind = 'rubber_export'` พร้อม capability ของสาขา ห้ามเปิด report/cash-count audit
- [x] ให้ denial จาก RPC ถูกแปลงเป็น HTTP 403 และยึด profile, capability และ assignments ปัจจุบันทุกคำสั่ง

## Phase 4 — Verification และเอกสาร

- [x] ขยาย `tests/admin-permission-boundary.spec.ts` สำหรับ role invariant, grant/revoke, inactive persistence และ concurrent demotion/grant
- [x] ขยาย `tests/admin-user-immediate-state.spec.ts` สำหรับปุ่ม, automatic state และ system-manager toggle response
- [x] ขยาย `tests/rubber-export.spec.ts` สำหรับ delegated assigned branch, revoked access, basic access และ deletion-history; ใช้ pgTAP ยืนยัน unassigned branch และ RLS โดยตรง
- [x] เพิ่ม pgTAP ชุดเดียวสำหรับ helper, verify/delete RPC, idempotent delete, audit RLS และการไม่เห็น report/cash-count audit
- [x] รัน focused Playwright/API tests, `npm run test:db`, migration/schema parity, `npm run verify` และ `git diff --check`
- [x] หลังผลตรวจผ่าน อัปเดต ADR/CONTEXT, Rubber Export contract, Obsidian checklist และหลักฐานทดสอบ

## เกณฑ์ตรวจรับ

- Admin ที่เปิดสิทธิ์ตรวจสอบ ลบ และดูประวัติการลบรายการส่งออกยางในสาขาที่ดูแลได้ รวมรายการที่ตนสร้าง
- Admin ที่ปิดสิทธิ์ยังใช้ฟังก์ชันพื้นฐานเดิมได้ แต่ไม่มีสามอำนาจที่เพิ่ม
- การถอน capability หรือถอนสาขามีผลกับคำสั่งถัดไป แม้ client ยังมี state เก่า
- บัญชีระงับใช้และแก้สิทธิ์ไม่ได้ แต่เมื่อกู้บัญชีกลับมาได้รับค่าเดิม; การลดเป็น User ล้าง capability เสมอ
- การเรียกข้ามสาขาถูกปฏิเสธทั้ง API และ direct RPC/RLS รวม idempotent retry หลังลบ
- Delegated Admin อ่าน deletion audit ได้เฉพาะ `rubber_export` และไม่เห็น `report_batch` หรือ `cash_count`
- ผู้จัดการระบบยังทำงานทุกสาขาตามเดิม และ Admin ทั่วไปหรือ delegated Admin มอบหมายสิทธิ์ต่อไม่ได้
- Report Lock, บิลรับยาง, WEX reservation, audit actor และสูตรค่าใช้จ่ายไม่ถดถอย

## จุดอ้างอิงสำหรับ implementation

- `src/components/admin/AdminContent.tsx` และ `src/components/AdminModule.tsx`
- `src/lib/permissions.ts`, `src/lib/server/auth.ts` และ `src/types/index.ts`
- `src/app/api/lanflow/admin/users/route.ts`, role route และ system-manager-access route
- `src/lib/server/rubber-export-response.ts`
- `src/app/api/lanflow/rubber-exports/route.ts`, `[exportId]/route.ts` และ `[exportId]/verify/route.ts`
- `private.can_delete_reports`, `private.can_manage_reports`, `public.verify_rubber_export_atomic`, `public.delete_rubber_export` และ RLS ของ `document_deletion_audits`

## ผลตรวจ

- Focused Playwright/API: 15 tests ผ่าน
- pgTAP ทั้งโครงการ: 22 files, 393 tests ผ่าน
- `npm run verify`: typecheck, production build และ service-worker checks ผ่าน
- schema snapshot ตรงกับ local dump ในส่วนโครงสร้างและ SQL; ต่างเพียงบรรทัดว่างท้ายไฟล์
- `git diff --check`: ผ่าน
- Follow-up `$scrutinize` พบว่า verify route ตรวจ payload ก่อน capability แม้ RPC เรียงลำดับถูกแล้ว; regression ทำซ้ำได้เป็น HTTP 400 สำหรับผู้ไม่มีสิทธิ์
- แก้ verify route ให้ตรวจ UUID และสิทธิ์จัดการต่อ export/สาขาก่อนอ่าน payload โดย RPC ยังคงตรวจซ้ำภายใต้ row lock; ผู้ไม่มีสิทธิ์ได้ 403 และผู้มีสิทธิ์ที่ส่ง payload ผิดยังได้ 400
- ตรวจ dead code ด้วย TypeScript `noUnusedLocals`/`noUnusedParameters` และ reference search ไม่พบ symbol หรือ handler ใหม่ที่ไม่มีผู้ใช้; focused Playwright/API 15/15, pgTAP 393 tests และ `npm run verify` ผ่านหลังแก้
