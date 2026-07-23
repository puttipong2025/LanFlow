# Income/Expense Cash Branch Transfer Plan

## Goal

เพิ่มวิธี `เงินสด` ให้ฟีเจอร์ `โยกเงินไปสาขาอื่น` ในโมดูลรับ-จ่าย โดยต้นทางและปลายทางนับเหรียญ/ธนบัตรแยกกัน ระบบแสดงยอดจริงของแต่ละสาขา ตรวจจับผลต่าง และคง workflow `โอนธนาคาร` เดิมไว้

แผนนี้เป็น implementation checklist หลักใน repository ส่วนสถานะการทำงานรายวันให้ยึด checklist ใน `10_Daily/2026-07-23.md` ของ vault `codingDO` เป็น progress source of truth

## Confirmed Product Contract

- ฟอร์มที่เปิดจากรับ-จ่ายเลือกได้ระหว่าง `เงินสด` และ `โอนธนาคาร` โดยเริ่มต้นที่เงินสด
- โอนธนาคารใช้ workflow สลิปเดิมและไม่ต้องให้ปลายทางยืนยัน
- เงินสดใช้จำนวนเหรียญ `1, 2, 5, 10` และธนบัตร `20, 50, 100, 500, 1000`
- ทั้งต้นทางและปลายทางต้องกรอกจำนวนชิ้น/ใบครบทั้ง 9 ช่อง รวมถึงพิมพ์ `0`; ไม่มีปุ่มคัดลอกจำนวน
- ต้นทางลงรายจ่ายตามยอดส่ง ณ เวลาเซิร์ฟเวอร์เมื่อสร้างรายการ
- ปลายทางเห็นรายการในคิว `รอรับเงิน` และลงรายรับตามยอดรับจริง ณ เวลาเซิร์ฟเวอร์เมื่อตรวจรับ
- ยอดตรงใช้สถานะ `รับเงินแล้ว`
- ยอดไม่ตรงแสดง `ยอดไม่ตรง ±฿…`; เฉพาะ `super_admin` ยอมรับผลต่างพร้อมเหตุผลได้
- หลังยอมรับแล้วใช้สถานะ `ยอมรับผลต่าง ±฿…` และไม่แก้ทับจำนวนเดิม
- ผู้มีสิทธิ์สาขาต้นทางและเข้าโมดูลรับ-จ่ายสร้างเงินสดได้ โดยไม่ต้องมีสิทธิ์โมดูลโอนเงิน
- ผู้มีสิทธิ์สาขาปลายทางตรวจรับได้
- ผู้สร้างหรือ `super_admin` แก้รายการได้เฉพาะก่อนปลายทางตรวจรับ
- เฉพาะ `super_admin` ลบถาวรได้ทุกสถานะและไม่ต้องกรอกเหตุผล
- ทุก write action เป็น online-only
- ชื่อผู้ทำรายการและผู้ตรวจรับมาจากบัญชีที่ล็อกอิน; หมายเหตุทั่วไปไม่บังคับ
- หน้า `โอนให้สาขา` ในโมดูลโอนเงินยังเป็นโอนธนาคารอย่างเดียว

## Architecture Boundary

```text
IncomeExpenseModule
  -> cash-transfer components/hooks
    -> Next.js App Router API
      -> transactional Supabase RPCs
        -> money_transfers
        -> money_transfer_cash_details (1:1)
  -> get_income_expense_feed (derived expense/income)
```

- `money_transfers` เป็น parent/source record ของการโยกเงินระหว่างสาขา
- `money_transfer_cash_details` เป็นรายละเอียดเฉพาะเงินสดแบบ one-to-one และไม่ใช้ JSON เก็บ denomination
- รายจ่าย/รายรับในโมดูลรับ-จ่ายยังเป็น derived rows ไม่สร้างคู่ row จริงใน `income_expense`
- Browser ห้ามเขียนตารางเงินสดโดยตรง; create/edit/receive/accept-difference/delete ต้องผ่าน API และ RPC แบบ atomic
- เวลาเหตุการณ์สำคัญใช้ server timestamp
- การลบถาวรเป็นข้อยกเว้นเฉพาะฟีเจอร์นี้จากกฎ soft-delete ทั่วไป ตาม `docs/adr/0008-permanently-delete-cash-transfers.md`

## Data Contract

### Parent: `money_transfers`

เพิ่ม field ระบุวิธีโยกเงิน เช่น `transfer_method`:

- `bank` สำหรับรายการเดิมและ workflow สลิป
- `cash` สำหรับ workflow ตรวจรับเงินสด

Migration ต้อง backfill branch transfer เดิมเป็น `bank` ก่อนบังคับ `NOT NULL`.

### Child: `money_transfer_cash_details`

หนึ่งแถวต่อ `money_transfers.id` และใช้ FK แบบ `ON DELETE CASCADE`.

Sent count columns:

- `sent_coin_1_count`
- `sent_coin_2_count`
- `sent_coin_5_count`
- `sent_coin_10_count`
- `sent_banknote_20_count`
- `sent_banknote_50_count`
- `sent_banknote_100_count`
- `sent_banknote_500_count`
- `sent_banknote_1000_count`

Received count columns:

- `received_coin_1_count`
- `received_coin_2_count`
- `received_coin_5_count`
- `received_coin_10_count`
- `received_banknote_20_count`
- `received_banknote_50_count`
- `received_banknote_100_count`
- `received_banknote_500_count`
- `received_banknote_1000_count`

Rules:

- sent counts เป็น integer `>= 0`, กรอกครบ และยอดส่งรวมต้องมากกว่า `0`
- received counts เป็น nullable ระหว่าง `รอรับเงิน`
- เมื่อตรวจรับแล้ว received counts ต้องเป็น integer `>= 0` ครบทั้ง 9 ช่อง; ยอดรับรวมเป็น `0` ได้
- generated totals: `sent_total`, `received_total`, `difference_total`
- `difference_total = received_total - sent_total`
- ผลต่างราย denomination คำนวณจากคู่ sent/received ตอน query หรือแสดงผล ไม่เก็บซ้ำ
- เก็บ `cash_status`, หมายเหตุ, creator/receiver identity, `sent_at`, `received_at`, ผู้ยอมรับผลต่าง, เหตุผล และเวลายอมรับ
- สถานะที่ต้องรองรับ: `pending_receipt`, `received`, `mismatched`, `difference_accepted`

## Phase 0 — Contract And Baseline

- [x] ยืนยัน requirement, permission, lifecycle, accounting dates และ mismatch behavior
- [x] สร้าง glossary ใน `CONTEXT.md`
- [x] บันทึก ADR เรื่องยอดจริงของแต่ละสาขา, การลบถาวร และตารางรายละเอียดเงินสด
- [x] สร้าง phased implementation plan
- [ ] ตรวจ baseline tests ที่เกี่ยวข้องก่อนแก้ และบันทึกผล

Exit criteria:

- Product contract ไม่มี decision สำคัญค้าง
- รู้ baseline failures ที่มีอยู่ก่อนเริ่ม implementation

## Phase 1 — Database Schema And Transactional RPCs

- [x] เพิ่ม append-only migration สำหรับ `transfer_method` และ backfill รายการเดิมเป็น `bank`
- [x] สร้าง `money_transfer_cash_details` พร้อม denomination columns, generated totals, checks, FK และ indexes
- [x] เพิ่ม RLS/select rules ให้ต้นทางและปลายทางอ่านรายการที่เกี่ยวข้องได้
- [x] ปิด direct writes จาก browser และ grant เฉพาะ RPC ที่จำเป็น
- [x] สร้าง RPC แบบ atomic สำหรับ create cash transfer
- [x] สร้าง RPC สำหรับ edit เฉพาะ creator หรือ `super_admin` ขณะ `pending_receipt`
- [x] สร้าง RPC สำหรับ destination receipt พร้อม row lock กันรับซ้ำ
- [x] สร้าง RPC สำหรับ `super_admin` ยอมรับผลต่างพร้อมเหตุผล
- [x] สร้าง RPC hard delete สำหรับ `super_admin` เท่านั้น
- [x] ใช้ server identity/timestamps และตรวจ source/target location permissions ทุก action
- [x] อัปเดต `supabase-schema.sql`
- [x] เพิ่ม database tests สำหรับ constraints, permissions, concurrency และ destructive delete

Exit criteria:

- การสร้าง/แก้/รับ/ยอมรับผลต่าง/ลบ เป็น transaction ที่ bypass ผ่าน client ไม่ได้
- denomination totals และ state transitions ถูก enforce ที่ฐานข้อมูล

## Phase 2 — Server API And Domain Layer

- [x] เพิ่ม TypeScript types สำหรับ method, cash status, sent/received counts และ details
- [x] เพิ่ม pure helpers สำหรับ validation, totals, differences และ Thai status labels
- [x] เพิ่ม payload builders ที่ไม่รับ client timestamps หรือ actor identity เป็น source of truth
- [x] เพิ่ม App Router API สำหรับ list/detail/create/edit/receive/accept-difference/delete
- [x] ตรวจ auth, location scope และ `super_admin` ที่ server boundary
- [x] map database errors เป็น HTTP `400/403/404/409` และข้อความไทยที่ UI ใช้ได้
- [x] เพิ่ม query keys และ invalidation สำหรับ source ledger, destination queue และ details

Exit criteria:

- API contract ครบทุก action และไม่ใช้ direct table mutation จาก browser
- duplicate receipt/edit-after-receipt ถูกตอบเป็น conflict อย่างสม่ำเสมอ

## Phase 3 — Source Form And Method Selection

- [x] แยก cash-specific form/component ออกจาก bank slip form
- [x] เพิ่มตัวเลือก `เงินสด / โอนธนาคาร` เฉพาะ flow ที่เปิดจากรับ-จ่าย
- [x] ตั้งค่าเริ่มต้นเป็นเงินสด; วิธีโยกเงินเปลี่ยนไม่ได้หลังสร้าง
- [x] สร้าง denomination input 9 ช่องที่เริ่มว่างและต้องกรอกครบ
- [x] แสดงยอดรวมแบบ live โดยไม่ให้กรอกยอดรวมเอง
- [x] เพิ่ม target branch, optional note, creator identity และ online-only feedback
- [x] เปิดปุ่มสร้างเงินสดให้ผู้มีสิทธิ์สาขาต้นทางในรับ-จ่าย โดยไม่ผูกสิทธิ์โมดูลโอนเงิน
- [x] รองรับ edit เฉพาะ creator/`super_admin` ก่อนตรวจรับ
- [x] รักษา bank slip workflow และหน้า `โอนให้สาขา` เดิมไม่ให้ regress

Exit criteria:

- ต้นทางสร้างรายการเงินสดที่ถูกต้องได้และเห็น derived expense ตามยอดส่งทันที
- bank transfer behavior เดิมยังทำงานเหมือนเดิม

## Phase 4 — Destination Queue, Receipt, And Details

- [x] เพิ่มปุ่ม/แถบ `รอรับเงิน (n)` ในโมดูลรับ-จ่าย
- [x] query เฉพาะรายการที่ target เป็นสาขาปัจจุบันและ status `pending_receipt`
- [x] อัปเดต badge/list อัตโนมัติขณะเปิดแอป
- [x] สร้าง receipt modal แสดง sent counts และ received inputs ว่างทั้ง 9 ช่อง
- [x] บังคับกรอก received counts ครบ โดยอนุญาตยอดรวม `0`
- [x] แสดงผลต่างราย denomination และผลต่างรวมก่อน submit
- [x] บันทึก receiver identity และเวลาเซิร์ฟเวอร์อัตโนมัติ
- [x] เพิ่ม cash detail modal ภายในรับ-จ่ายสำหรับผู้ไม่มีสิทธิ์โมดูลโอนเงิน
- [x] ล็อก sent/received details หลังตรวจรับ

Exit criteria:

- ปลายทางตรวจรับได้ครั้งเดียวและเห็นผลตรง/ไม่ตรงอย่างชัดเจน
- รายการรอรับไม่ปะปนในตารางรายรับ

## Phase 5 — Ledger Feed, Mismatch Resolution, And Hard Delete

- [x] ปรับ `get_income_expense_feed` ให้ cash source expense ใช้ `sent_total` และ `sent_at`
- [x] ให้ cash destination income เกิดหลังตรวจรับ ใช้ `received_total` และ `received_at`
- [x] แสดง badge `รับเงินแล้ว`, `ยอดไม่ตรง ±฿…`, `ยอมรับผลต่าง ±฿…`
- [x] เพิ่ม `super_admin` action ยอมรับผลต่างพร้อมเหตุผล โดยไม่แก้ original counts
- [x] เพิ่ม `super_admin` permanent delete confirmation โดยไม่ขอเหตุผล
- [x] หลัง hard delete ให้ derived rows, queue item และ details หายตาม source อย่างสอดคล้อง
- [x] รักษา feed ของ bank transfer และ derived sources อื่นไม่ให้เปลี่ยน

Exit criteria:

- Ledger ของแต่ละสาขาสะท้อนเงินจริงและวันที่เกิดจริง
- mismatch ไม่ถูกซ่อน และ privileged actions ถูก enforce ครบสามชั้น

## Phase 6 — Verification And Regression Coverage

- [x] รัน migration reset/schema verification
- [x] ทดสอบ create cash transfer ด้วย `user`, `admin`, `super_admin`
- [x] ทดสอบผู้ไม่มี source access สร้างไม่ได้
- [x] ทดสอบเฉพาะผู้มี target access ตรวจรับได้
- [x] ทดสอบ exact receipt และ derived income/expense คนละวัน
- [x] ทดสอบ shortage, overage และ zero received
- [x] ทดสอบ duplicate/concurrent receipt ได้เพียงครั้งเดียว
- [x] ทดสอบ edit lock หลังตรวจรับ
- [x] ทดสอบ accept difference เฉพาะ `super_admin` และเหตุผลบังคับ
- [x] ทดสอบ hard delete เฉพาะ `super_admin`
- [x] ทดสอบทุก cash action ถูก block เมื่อ offline
- [x] ทดสอบ queue badge และ auto refresh
- [x] รัน regression ของ bank branch transfer, Income/Expense feed และ approval/offline suites ที่เกี่ยวข้อง
- [x] รัน `npx.cmd tsc --noEmit`
- [x] รัน `npm run build`

Exit criteria:

- Tests ที่เพิ่มและ regression suites ที่เกี่ยวข้องผ่าน
- ไม่มี TypeScript หรือ production build error

## Phase 7 — Documentation And Handoff

- [x] อัปเดตเอกสาร architecture/data contract ตาม migration และ API จริง
- [x] ตรวจ ADR/glossary ให้ตรง implementation สุดท้าย
- [x] อัปเดต Daily checklist หลังผล verification แต่ละ Phase
- [x] บันทึก exact migration, routes, tests และผลตรวจสอบใน project memory
- [x] สรุป known limitations และ production migration/rollback notes

Exit criteria:

- เอกสารและ memory อ้างอิง source paths ที่มีอยู่จริง
- Daily checklist ตรงกับสถานะที่ตรวจสอบได้

## Required Test Scenarios

1. ต้นทางส่งตรงและปลายทางรับตรง
2. ปลายทางรับขาดและเห็นผลต่างติดลบ
3. ปลายทางรับเกินและเห็นผลต่างเป็นบวก
4. ปลายทางรับ `0`
5. ส่งวันหนึ่งและรับอีกวันหนึ่ง
6. ผู้รับสองคนกดยืนยันพร้อมกัน
7. ต้นทางพยายามแก้หลังตรวจรับ
8. ผู้ไม่มีสิทธิ์ source/target เรียก API โดยตรง
9. non-super-admin พยายามยอมรับผลต่างหรือลบ
10. super-admin hard delete ทุกสถานะ
11. offline create/edit/receive/accept/delete ถูก block
12. branch transfer แบบ bank เดิมยังแนบสลิปและสร้าง feed เหมือนเดิม

## Risks And Guardrails

- Hard delete ทำลายหลักฐานและขัดกับ non-negotiable soft-delete ทั่วไป จึงต้องจำกัดเฉพาะ `super_admin`, มี confirm ชัดเจน และมี regression test
- Source expense กับ destination income อาจไม่เท่ากันโดยตั้งใจเมื่อเกิดผลต่าง ห้าม normalize ให้เท่ากัน
- Destination must not receive twice; RPC ต้อง lock row และตรวจ state transition
- Client-side guards ไม่ใช่ security boundary; API/RPC/RLS ต้องตรวจสิทธิ์ซ้ำ
- ห้ามใช้ client clock สำหรับ `sent_at`, `received_at`, `difference_accepted_at`
- ห้ามให้ cash workflow เข้า IndexedDB offline queue
- ห้ามทำให้ผู้ไม่มีสิทธิ์โมดูลโอนเงินต้องเปิด source ที่โมดูลโอนเงิน; cash details ต้องเปิดได้ในรับ-จ่าย

## Implemented Architecture And Source Map

Database migrations, applied in order:

1. `supabase/migrations/20260723010000_cash_branch_transfers.sql`
   - Adds `transfer_method`, `money_transfer_cash_details`, denomination constraints/RLS/grants, and the five transactional RPCs.
2. `supabase/migrations/20260723020000_separate_cash_transfer_feed.sql`
   - Gives cash parents their own `transfer_type = 'cash'` and target-side read scope so they cannot enter the legacy bank feed.
3. `supabase/migrations/20260723030000_cash_transfer_income_expense_feed.sql`
   - Adds the source expense and post-receipt destination income to the authoritative paginated `get_income_expense_feed`.

App Router API:

- `src/app/api/lanflow/cash-branch-transfers/route.ts` — scoped list and create
- `src/app/api/lanflow/cash-branch-transfers/[id]/route.ts` — detail, edit, and permanent delete
- `src/app/api/lanflow/cash-branch-transfers/[id]/receive/route.ts` — destination receipt
- `src/app/api/lanflow/cash-branch-transfers/[id]/accept-difference/route.ts` — super-admin difference acceptance
- `src/lib/server/cash-branch-transfer-response.ts` — consistent `400/403/404/409` mapping

Client/domain:

- `src/lib/cash-branch-transfer.ts` — denominations, parsing, total calculation, and actor/time-free payload builders
- `src/hooks/useCashBranchTransfers.ts` — 15-second refresh plus ledger/queue invalidation
- `src/components/income-expense/CashBranchTransferModal.tsx` — create/edit, receipt, per-denomination comparison, details, acceptance, and hard delete
- `src/components/income-expense/IncomeExpenseModule.tsx` — cash-default method selection, destination queue, and source-detail entry point

Verification:

- `tests/income-expense/cash-branch-transfer-contract.spec.ts` — role/location guards, server identity/time, state conflicts, exact/shortage/overage/zero, concurrent receipt, cross-day feed, and hard delete
- `tests/income-expense/cash-branch-transfer-ui.spec.ts` — blank counts, per-kind differences, offline action locks, mismatch acceptance/delete, and 15-second queue refresh
- `tests/income-expense/branch-transfer-approval.spec.ts` — bank and approval regression plus cash create/receipt UI
- `tests/income-expense/branch-transfer-offline.spec.ts` — legacy bank/offline regression

## Production Migration And Rollback

- Back up `money_transfers` before applying the three migrations in order.
- Migration 2 changes only cash parents to `transfer_type = 'cash'`; existing bank transfers remain `branch/bank`.
- Hard delete is intentionally irreversible. Operational recovery requires restoring the affected parent/detail rows from a database backup.
- If application rollback is required after migration, keep the additive schema/RPCs in place and roll back the application first. Dropping the detail table or reverting cash parents to the bank feed would risk premature destination income and data loss.

Known limitation: the queue/detail query currently refreshes all cash transfers related to the selected branch every 15 seconds. Accounting rows themselves remain bounded and paginated by the Income/Expense feed.
