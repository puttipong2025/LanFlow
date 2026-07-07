# Income/Expense Offline-First Remaining Phases

## Summary

เอกสารนี้เริ่มจากแผน remaining phases ของ Income/Expense Offline-First และตอนนี้ถูกอัปเดตเป็นสถานะหลังดำเนินงาน Phase 1-5 แล้ว.

สถานะล่าสุด: **Income/Expense เป็น Full Offline หลัง Phase 1-4 ผ่านครบ และ Phase 5 อัปเดตเอกสารแล้ว** ในบริบท Supabase local dev.

## Current Status

### ทำแล้ว

- `sync_income_expense(payload jsonb)` และ `POST /api/lanflow/income-expense`
- `buildIncomeExpensePayload`
- `useIncomeExpense` เปลี่ยนเป็น IndexedDB queue + API/RPC sync
- UI แสดง `syncErrorMessage` ผ่าน `SyncStatusBadge`
- `tests/income-expense-offline.spec.ts` ผ่าน 11/11
- `tests/income-expense-pwa.spec.ts` ผ่าน
- `income_expense` ถูก lock down แล้ว: authenticated เหลือ `SELECT`, write ผ่าน RPC เท่านั้น
- docs หลักอัปเดตให้ระบุว่า Income/Expense เป็น Full Offline หลัง Phase 1-4 ผ่านครบ

### ยังเหลือ

- Remote deploy / production migration ยังควรทำเป็นขั้นตอนแยกหลังตรวจ diff และเลือกเวลาปล่อยขึ้น production
- Phase ถัดไปที่แนะนำ: commit งานทั้งหมด หรือเตรียม release checklist สำหรับ remote Supabase

## Phase 1 - Dev E2E Offline Proof

**Status:** Completed. `tests/income-expense-offline.spec.ts` ผ่านและถูกขยายเป็น 11 tests หลัง Phase 4.

เป้าหมาย: พิสูจน์ว่า Income/Expense offline queue ทำงานจริงใน dev server

### Tasks

- สร้าง `tests/income-expense-offline.spec.ts`
- ทดสอบอย่างน้อย:
  - offline create รายรับทั่วไป แล้ว reconnect sync
  - offline create รายจ่าย แล้ว reconnect sync
  - synced row -> offline edit twice -> sync แล้วเหลือ update ล่าสุด
  - synced row -> offline edit -> delete -> sync แล้วเป็น soft delete
  - offline create -> delete before sync -> no-op, DB ไม่เกิด row
  - replay payload เดิมแล้ว DB ไม่ duplicate
- ใช้ `/api/auth/me` เพื่อหา `locationIds[0]`
- cleanup test rows ทุกเคส และ assert cleanup response

### Verification

```powershell
npx.cmd tsc --noEmit
npx.cmd playwright test tests/income-expense-offline.spec.ts --project=chromium
```

### Review Gate

หยุดหลัง Phase นี้ แล้วให้ Codex `$scrutinize` ตรวจ call graph + test coverage ก่อนทำ Phase 2

## Phase 2 - PWA Offline Reload Proof & Approval Offline Rules
**Status:** Completed.
- ทดสอบ PWA offline reload เดิมใน `tests/income-expense-pwa.spec.ts` ผ่าน
- เพิ่มการบล็อกการโอนเงิน (Branch Transfer) เมื่อ offline ในระดับ UI (ปิดปุ่ม บันทึก และแสดงข้อความเตือน)
- เพิ่ม test ไฟล์ `tests/income-expense/branch-transfer-offline.spec.ts` เพื่อทดสอบพฤติกรรม Offline Rules ของ Branch Transfer และ Approval Request ตามแผน `income-expense-branch-transfer-approval-plan.md` เรียบร้อยแล้ว (4/4 passed)
  - create transaction
  - reload while offline
  - assert app ยัง render ได้, tab รายรับ-รายจ่าย clickable, row pending visible
  - online แล้ว sync สำเร็จ
- ห้ามเพิ่ม behavior ใหม่ใน UI ถ้าไม่จำเป็น ให้ reuse bootstrap/PWA behavior เดิมของ LanFlow

### Verification

```powershell
npm run build
$env:PW_PROJECT="pwa"; npx.cmd playwright test tests/income-expense-pwa.spec.ts --project=chromium-pwa
```

### Review Gate

หยุดหลัง Phase นี้ แล้วให้ Codex `$scrutinize` ตรวจว่า PWA test ไม่ได้ skip path สำคัญ

## Phase 3 - Lock Down DB Writes

**Status:** Completed. 
- `income_expense` เหลือ direct `SELECT` สำหรับ authenticated และ write ผ่าน `sync_income_expense(jsonb)` เท่านั้น.
- เพิ่มการล็อกลึกถึงระดับ RPC: `sync_income_expense` ไม่รับ payload ของการโอนเงิน (Branch Transfer) โดยตรง เพื่อป้องกันการส่ง fake data
- `sync_income_expense` จะดีดกลับ (`status: 'conflict'`) ทันทีถ้ารายการตรงกับ approval keyword หรือเกิน threshold แล้วพยายามบันทึกตรงๆ โดย bypass คิวอนุมัติ
- ใช้ `app.bypass_income_expense_approval` เป็น internal flag ที่อนุญาตเฉพาะ `super_admin` ผ่าน `decide_income_expense_approval_request` ในการ override กติกานี้

เป้าหมาย: ปิดช่องโหว่ทั้งหมดที่อาจเกิดขึ้นจากการพยายามยิง RPC เพื่ออ้อมผ่าน Approval Queue และระบบโอนเงินของสาขา

### Tasks

- เพิ่ม migration ใหม่แบบ append-only
- Drop policy เดิม `"income expense location scoped"` ที่เป็น `for all`
- สร้าง SELECT-only policy สำหรับ authenticated users ที่เข้าถึง `location_id` ได้
- `revoke all on public.income_expense from anon, authenticated`
- `grant select on public.income_expense to authenticated`
- คง `grant execute on function public.sync_income_expense(jsonb) to authenticated`
- อัปเดต `supabase-schema.sql` ให้ตรง migration

### Verification

```powershell
npx.cmd supabase db reset
npx.cmd tsc --noEmit
npx.cmd playwright test tests/income-expense-offline.spec.ts --project=chromium
```

ต้องเช็ก DB grants:

- `authenticated` มีแค่ `SELECT` บน `income_expense`
- `anon` ไม่มีสิทธิ์
- `authenticated` execute `sync_income_expense` ได้

### Review Gate

หยุดหลัง Phase นี้ แล้วให้ Codex `$scrutinize` ตรวจ RLS/grants/RPC path

## Phase 4 - Hardening Tests

**Status:** Completed. 
- Hardening cases เดิมถูกเพิ่มใน `tests/income-expense-offline.spec.ts` และผ่าน 11/11.
- เพิ่มการทดสอบการเจาะระบบเพื่อทำ DB Bypass (Branch Transfer / Approval Keyword) ใน `tests/income-expense/hardening-db-lockdown.spec.ts` และผ่านฉลุยครบถ้วน

เป้าหมาย: ปิด edge cases ก่อนประกาศ Full Offline

### Tasks

- conflict: stale `expectedRevisionNo` ต้อง mark `conflict` และ UI แสดง error
- failed: invalid payload ต้อง mark `failed` ไม่ถูกลบจาก queue
- concurrent create: server bill number ไม่ซ้ำ
- bill number sequence ใช้ร่วมกันระหว่าง income/expense ต่อ location/date ตาม behavior เดิม
- delete ใช้ soft delete เท่านั้น และ approved/record history ไม่หาย

### Verification

```powershell
npx.cmd tsc --noEmit
npx.cmd playwright test tests/income-expense-offline.spec.ts --project=chromium
```

### Review Gate

หยุดหลัง Phase นี้ แล้วให้ Codex `$scrutinize` ตรวจว่า tests ครอบ behavior จริง ไม่ใช่ assert แค่ intermediate state

## Phase 5 - Docs And Status Update

**Status:** Completed. เอกสารหลักถูกอัปเดตให้สะท้อนสถานะ Full Offline หลัง Phase 1-4 ผ่านครบ.

เป้าหมาย: อัปเดตเอกสารหลังระบบผ่านจริงเท่านั้น

### Tasks

- อัปเดต `docs/system-architecture-technical-summary.md`
- อัปเดต `docs/income-expense-offline-first-upgrade-plan.md`
- ระบุว่า Income/Expense เป็น Full Offline เฉพาะหลัง Phase 1-4 ผ่านครบ
- เพิ่มตารางเปรียบเทียบ Rubber Bills vs Income/Expense เวอร์ชันล่าสุด

### Verification

```powershell
git diff --check
npx.cmd tsc --noEmit
```

## Non-Negotiables

- ห้ามใช้ `service_role` ใน browser
- ห้ามสร้าง `server_bill_no` ฝั่ง client
- ห้ามปิด direct DB writes ก่อน E2E dev และ PWA ผ่าน
- ห้ามเปลี่ยนรูปแบบตารางรายรับ-รายจ่ายโดยไม่จำเป็น
- ห้ามลบ failed/conflict queue อัตโนมัติ
- ทุก Phase ต้องหยุดให้ Codex `$scrutinize` ตรวจ ก่อนเริ่ม Phase ถัดไป

## Assumptions

- ใช้ Supabase local dev และ `supabase db reset` ก่อนคิดเรื่อง remote
- ใช้เลขบิล server sequence ร่วมกันระหว่าง income และ expense ต่อสาขา/วัน
- ใช้ IndexedDB queue เดียวกับ Rubber Bills ผ่าน `lanflow_sync_db`
- Remote deploy/production migration ทำหลังทุก phase ผ่านเท่านั้น
