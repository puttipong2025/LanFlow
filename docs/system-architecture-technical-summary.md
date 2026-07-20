# LanFlow System Architecture & Technical Summary

เอกสารนี้สรุปสถาปัตยกรรมปัจจุบันของ LanFlow หลังการ refactor แบบ modularization โดยอ้างอิงจากโครงสร้างโค้ดจริงใน `src/`, `tests/`, และ config หลักของโปรเจกต์

## 1. โครงสร้างหลักที่สำคัญ (Core Architecture)

### โครงสร้างโฟลเดอร์หลัก

```text
src/
  app/
    api/                         # Next.js API Routes
    layout.tsx                   # Root layout + AuthProvider + QueryProvider
    page.tsx                     # Entry page
  components/
    LanFlowApp.tsx               # App Shell / Orchestrator
    lanflow/                     # Shell UI: header, tabs, tab config
    dashboard/                   # Dashboard summary UI
    rubber-bills/                # โมดูลบิลยาง
    income-expense/              # โมดูลรายรับ-รายจ่าย
    money-transfer/              # โมดูลโอนเงิน
    shared/                      # Shared UI primitives
  hooks/                         # Data hooks / feature hooks
  lib/
    lanflow/                     # LanFlow-specific helpers
    server/                      # Server-only helpers
    supabase/                    # Supabase client/server config
  types/
    index.ts                     # Shared domain types
tests/
  rubber-bills-offline.spec.ts   # Offline-first E2E tests
  rubber-bills-pwa.spec.ts       # PWA offline reload tests
  income-expense-offline.spec.ts # Income/Expense offline-first E2E tests
  income-expense-pwa.spec.ts     # Income/Expense PWA offline reload tests
  auth-cache-offline.spec.ts     # Offline auth cache tests
```

### Domain-oriented components

- **`src/components/lanflow/`**
  - `AppHeader.tsx`: โลโก้, ข้อมูลผู้ใช้, dropdown เลือกสาขา, ปุ่มออกจากระบบ
  - `NavigationTabs.tsx`: tab navigation, role guard ของเมนู admin, badge ของ OCR / โอนเงิน / เวลาและเงินเดือน
  - `tabs.ts`: config รายการ tab และ icon

- **`src/components/dashboard/`**
  - `Dashboard.tsx`: แสดง summary ภาพรวม, ตารางบิลล่าสุด, รายการเงินล่าสุด
  - `Metric.tsx`: metric card ขนาดเล็ก

- **`src/components/rubber-bills/`**
  - `RubberBillsModule.tsx`: state ของหน้าบิลยาง, search, pagination, modal open/close
  - `RubberBillsTable.tsx`: ตารางบิลยาง
  - `RubberBillModal.tsx`: form เพิ่ม/แก้ไขบิลยาง
  - `bill-display.ts`: helper แสดงเลขบิลและเวลา

- **`src/components/income-expense/`**
  - `IncomeExpenseModule.tsx`: state ของหน้ารายรับ-รายจ่าย
  - `IncomeExpenseModal.tsx`: form รายรับ-รายจ่าย
  - `income-expense-display.ts`: helper แสดงเลขบิล

- **`src/components/shared/`**
  - UI primitives ที่ใช้ร่วมกัน เช่น `ModalShell`, `IconButton`, `Field`, `NumberField`, `InlineNumber`, `InlineRadio`, `SyncStatusBadge`

### หน้าที่ของ `LanFlowApp.tsx`

`LanFlowApp.tsx` ทำหน้าที่เป็น **App Shell / Orchestrator** ไม่ถือ implementation รายละเอียดของ module ใหญ่แล้ว หน้าที่หลักคือ:

- โหลดข้อมูล bootstrap จาก `/api/lanflow`
- อ่าน/เขียน bootstrap cache สำหรับ offline start ผ่าน `src/lib/lanflow/bootstrap-cache.ts`
- เก็บ state ระดับแอป เช่น:
  - `activeTab`
  - `locations`
  - `profile`
  - `selectedLocationId`
  - `ocrUploadItems`
  - `online`
  - `isLoaded`
- เรียก hooks หลัก:
  - `useRubberBills(selectedLocationId)`
  - `useIncomeExpense(selectedLocationId)`
  - `useMoneyTransfers(selectedLocationId)`
  - `useTimeTrackingPending(profile)`
- คำนวณ summary และ badge counts แล้วส่งเป็น props ให้ component ลูก
- render module ตาม `activeTab`

### การส่ง Props ระหว่าง Component

แนวทางปัจจุบันคือ **state อยู่ใกล้เจ้าของที่สุด**:

- State ระดับ app อยู่ใน `LanFlowApp.tsx`
- State เฉพาะ module อยู่ใน module component เช่น `RubberBillsModule`, `IncomeExpenseModule`
- Shared UI รับ props แบบ presentational
- Module สำคัญรับ domain props ชัดเจน เช่น:
  - `RubberBillsModule`: `selectedLocation`, `profile`
  - `IncomeExpenseModule`: `selectedLocation`, `profile`
  - `MoneyTransferModule`: `locationId`, `online`, `profile`
  - `OcrTicketUpload`: `locationId`, `online`, `uploadItems`, `setUploadItems`

## 2. เทคโนโลยีที่ใช้ (Tech Stack)

### Frontend / App Runtime

- **Next.js 15**: App Router, API Routes, build/start/dev scripts
- **React 19**: component-based UI
- **TypeScript**: type safety ทั้งฝั่ง client/server
- **Tailwind CSS**: utility-first styling
- **lucide-react**: icon components
- **sonner**: toast notifications
- **SweetAlert2**: dialog/confirm UX บางส่วน

### State / Data Layer

- **React state/hooks**: local UI state
- **TanStack React Query**: server state และ cache ของ hooks หลัก เช่น `useRubberBills`
- **Supabase JS / SSR**: auth session, database access, server/client Supabase helpers
- **IndexedDB**: local offline sync queue สำหรับงานบิลยางและรายรับ-รายจ่าย

### Build / PWA

- **`@ducanh2912/next-pwa`**: generate service worker, precache static assets, runtime cache strategies
- **Workbox runtime caching** ผ่าน `next.config.ts`

## 3. ระบบ Authentication

### Auth Provider และ Profile

ระบบ auth เริ่มจาก `src/app/layout.tsx`:

- server-side เรียก `requireAuth()`
- สร้าง `initialProfile`
- ส่งเข้า `AuthProvider`
- `AuthProvider` เรียก `useAuth(initialProfile)`

`useAuth` เป็นตัวกลางจัดการ:

- login ด้วย Supabase phone/password
- logout
- refresh profile ผ่าน `/api/auth/me`
- offline auth cache
- mode ของผู้ใช้: `online`, `offline`, `signed_out`

### Offline Auth Cache

มี cache key หลัก:

- `lanflow:last-auth-user`
- `lanflow:auth-profile:<userId>`

กฎสำคัญ:

- online source of truth คือ `/api/auth/me`
- offline source of truth คือ cached profile ที่ยังไม่หมดอายุ
- offline cache อายุสูงสุด 7 วัน (`OFFLINE_AUTH_MAX_AGE_MS`)
- logout / 401 / 403 จะ clear auth cache และ bootstrap cache

### Role / Permission

Role หลักในระบบ:

- `user`
- `admin`
- `super_admin`

การควบคุมสิทธิ์มีหลายชั้น:

- **UI guard**
  - `NavigationTabs.tsx` แสดง tab `Admin` เฉพาะ `admin` และ `super_admin`
  - `NavigationTabs.tsx` แสดง tab `Admin` และ tab `โอนเงิน` ให้ผู้มี `Profile.canAccessSystemManager`; `โอนเงิน` ยังรองรับ `Profile.canAccessMoneyTransfer` เพื่อ compatibility
  - module หรือปุ่มเฉพาะทางตรวจ `profile.role` เพิ่มตาม feature

- **API guard**
  - API routes ใช้ helper เช่น `requireAuth`, `requireRole`, `requireSystemManager`, `requireRoleOrSystemManager`
  - admin endpoints อยู่ใต้ `/api/lanflow/admin/...`
  - `/api/lanflow/admin/users/[id]/system-manager-access` ให้เฉพาะ `super_admin` จริงเปิด/ปิดสิทธิ์ผู้จัดการระบบของ user/admin

- **Database / Supabase**
  - schema ใช้ RLS และ role-based access
  - งานที่ต้อง atomic เช่น sync บิลยางใช้ API/RPC bridge แทนให้ browser เขียน table โดยตรง
  - `profiles.can_access_super_admin_features` เป็น flag สิทธิ์ผู้จัดการระบบ: เห็นทุกสาขา, เข้าตั้งค่าอนุมัติ, จัดการรายการบิลขาย, ใช้โมดูลโอนเงิน และงานผู้ดูแลส่วนใหญ่
  - ผู้มีสิทธิ์ผู้จัดการระบบ **ไม่สามารถ** ให้/ถอนสิทธิ์นี้เอง, เปลี่ยน role, หรือจัดการ `super_admin`; งานเหล่านี้ยังเป็นของ `super_admin` จริง
  - `profiles.can_access_money_transfer` ถูกคงไว้เพื่อ compatibility แต่การเปิดสิทธิ์ใหม่ใช้ `can_access_super_admin_features` เป็น master
  - RLS write ของ `money_transfers`, `money_transfer_slips`, และ `money_transfer_items` ต้องผ่าน `private.can_access_money_transfer_module()` ซึ่งอิงสิทธิ์ผู้จัดการระบบ; `SELECT` ยังอ่านตามสิทธิ์สาขาเพื่อให้ Income/Expense render derived locked rows ได้

## 4. ระบบ PWA และ Offline-First

### PWA Mechanism

PWA config อยู่ที่ `next.config.ts`:

- development ปิด PWA (`disable: process.env.NODE_ENV === "development"`)
- production สร้าง service worker ไปที่ `public/sw.js`
- เปิด `skipWaiting`, `clientsClaim`, `reloadOnOnline`
- API routes ใช้ `NetworkOnly` เพื่อไม่ cache authenticated API response ใน service worker
- static assets ใช้ `CacheFirst`
- images/fonts ใช้ cache strategy แยกตามประเภท

`manifest.json` กำหนด:

- app name: `LanFlow`
- display: `standalone`
- theme/background color
- icon

### Offline Bootstrap

`src/lib/lanflow/bootstrap-cache.ts` เก็บข้อมูลเริ่มต้นของ workspace ต่อ user:

- `locations`
- `profile`
- `selectedLocationId`

เมื่อ offline:

- `LanFlowApp.tsx` อ่าน cache ด้วย `readBootstrapCache(authProfileId)`
- validate ว่า cache เป็นของ user เดียวกัน
- filter locations ให้เหลือเฉพาะที่ `profile.locationIds` อนุญาต
- fallback selected branch ถ้า branch เดิมใช้ไม่ได้

### IndexedDB Offline Queue

offline queue อยู่ที่ `src/lib/idb-queue.ts`:

- database: `lanflow_sync_db`
- object store: `sync_queue`
- event fields สำคัญ:
  - `entity`
  - `operation`: `create`, `update`, `delete`
  - `payload`
  - `status`: `pending`, `failed`, `conflict`
  - `errorMessage`

การ coalesce queue อยู่ที่ `src/lib/coalesceQueueGroup.ts`:

- `create + delete` = no-op
- `create + update(s)` = create เดียว ใช้ payload ล่าสุด
- `update(s) + delete` = delete เดียว คง revision เดิม
- `update(s)` = update เดียว ใช้ payload ล่าสุด

### Rubber Bills Offline-First Flow

โมดูลที่ใช้ offline-first เป็นหลักคือ **Rubber Bills / บิลยาง**:

1. ผู้ใช้สร้าง/แก้ไข/ลบบิลผ่าน `RubberBillModal`
2. `useRubberBills` สร้าง payload ผ่าน `buildRpcPayload`
3. ถ้าเป็น create/update/delete จะ enqueue ลง IndexedDB
4. UI merge server state กับ pending queue เพื่อแสดง optimistic result
5. `SyncStatusBadge` แสดงสถานะ:
   - `pending`
   - `syncing`
   - `synced`
   - `failed`
   - `conflict`
6. เมื่อ online:
   - `syncPendingBills()` normalize queue
   - ส่ง payload ไป `/api/lanflow/rubber-bills`
   - API route เรียก Supabase RPC `sync_rubber_bill`
   - success จะ remove event จาก queue
   - conflict/failed จะคง event ไว้พร้อม error message

### Income/Expense Offline-First Flow

**Income/Expense / รายรับ-รายจ่าย** ถูกยกระดับเป็น full offline-first แล้วหลัง Phase 1-4 ผ่านครบ โดยใช้ pattern เดียวกับ Rubber Bills แต่ entity เป็น single-row transaction:

1. ผู้ใช้สร้าง/แก้ไข/ลบรายการผ่าน `IncomeExpenseModal` และ `IncomeExpenseModule`
2. `useIncomeExpense` สร้าง payload ผ่าน `buildIncomeExpensePayload`
3. create/update/delete ถูก enqueue ลง IndexedDB `lanflow_sync_db` / `sync_queue`
4. UI merge server rows กับ pending queue เพื่อแสดง optimistic rows และ `SyncStatusBadge`
5. เมื่อ online:
   - `syncPendingIncomeExpense()` normalize queue ด้วย `coalesceQueueGroup`
   - ส่ง payload ไป `/api/lanflow/income-expense`
   - API route เรียก Supabase RPC `sync_income_expense`
   - success จะ remove event จาก queue
   - conflict/failed จะคง event ไว้พร้อม `syncErrorMessage`

ข้อกำหนดสำคัญ:

- browser ไม่สร้าง `server_bill_no`
- browser ไม่เขียน `income_expense` ตรงหลัง lock down แล้ว
- `server_bill_no` ออกโดย RPC พร้อม advisory lock ต่อ `location_id + tx_date`
- sequence เลขบิลใช้ร่วมกันระหว่าง income และ expense ต่อสาขา/วัน
- delete เป็น soft delete เท่านั้น

### Income/Expense Derived Rows

นอกจาก row จริงใน `income_expense` แล้ว โมดูลรายรับ-รายจ่ายยังแสดงรายการที่ derive มาจาก source module อื่น เพื่อให้เงินที่เกิดจากโมดูลต้นทางสะท้อนในตารางรับ-จ่ายโดยไม่สร้างข้อมูลซ้ำ:

1. **รายรับจากโอนเงินสาขาขาเข้า**
   - source: `money_transfers.transfer_type = 'branch'`
   - เงื่อนไข: `target_location_id` ตรงกับสาขาที่กำลังดู, `record_status != 'deleted'`, `transfer_status != 'cancelled'`
   - ยอดเงิน: `net_amount_to_pay`
   - แสดงเป็น `IncomeExpense` ชนิด `income`
   - badge ใน UI: `โอนเงินสาขา`; ถ้า `location_id = target_location_id` ให้ถือเป็นรายการสำนักงานใหญ่/CEO โอนให้สาขา และ badge เป็น `โอนให้สาขา`
   - relation lock: แก้ไข/ลบจากรับ-จ่ายไม่ได้ ต้องแก้ไขหรือลบที่รายการโอนเงินสาขาต้นทาง
   - ถ้าผู้ใช้มีสิทธิ์สาขาต้นทางหรือเป็น `super_admin` จะมีปุ่มเปิดรายการโอนเงินต้นทาง
   - RLS เพิ่มเติม: มี policy ให้ผู้ใช้ที่เข้าถึงสาขาปลายทางอ่านรายการโอนเงินสาขาที่ชี้มายังสาขาตัวเองได้

2. **รายจ่ายจากโอนเงินสาขาขาออก**
   - source: `money_transfers.transfer_type = 'branch'`
   - เงื่อนไข: `location_id` ตรงกับสาขาที่กำลังดู, `target_location_id != location_id`, `record_status != 'deleted'`, `transfer_status != 'cancelled'`
   - ยอดเงิน: `net_amount_to_pay`
   - แสดงเป็น `IncomeExpense` ชนิด `expense`
   - badge ใน UI: `โอนเงินสาขา`
   - relation lock: แก้ไข/ลบจากรับ-จ่ายไม่ได้ ต้องแก้ไขหรือลบที่รายการโอนเงินสาขาต้นทาง
   - entry point ใน UI: ปุ่ม `โยกเงินไปสาขาอื่น` ในโมดูลรับ-จ่าย เปิด `BranchTransferForm` และบันทึกเข้า `money_transfers`
   - สิทธิ์ที่ต้องใช้: ผู้สร้างต้องมีสิทธิ์สาขาต้นทางเท่านั้น; dropdown สาขาปลายทางอ่านสาขา active ได้ทั้งหมด
   - รายการที่สร้างจากโมดูลโอนเงินแบบ `โอนให้สาขา` จะบันทึก `location_id` เป็นสาขาที่รับเงินและไม่สร้างรายจ่ายขาออก

3. **รายจ่ายส่วนสาขาจ่ายจากโอนเงินลูกค้า**
   - source: `money_transfers.transfer_type = 'customer'`
   - เงื่อนไข: `transfer_status = 'branch_and_transfer'`, `location_id` ตรงกับสาขาที่กำลังดู, `record_status != 'deleted'`
   - ยอดเงิน: `branch_paid_amount`
   - แสดงเป็น `IncomeExpense` ชนิด `expense`
   - badge ใน UI: `โอน+สาขาจ่าย`
   - relation lock: แก้ไข/ลบจากรับ-จ่ายไม่ได้ ต้องแก้ไขหรือลบที่รายการโอนเงินลูกค้าต้นทาง

4. **รายจ่ายรวมรายวันจากบิลยางที่ยังไม่ถูกเลือกไปโอนเงิน**
   - source: `rubber_bills`
   - เงื่อนไข: `location_id` ตรงกับสาขาที่กำลังดู, `record_status = 'active'`, `net_total > 0`, และ `id` ยังไม่อยู่ใน `money_transfer_items.source_id` ที่ `source_type = 'rubber_bill'`
   - ยอดเงิน: รวม `net_total` ต่อ `bill_date`
   - แสดงเป็น `IncomeExpense` ชนิด `expense`
   - badge ใน UI: `บิลยางรวมรายวัน`
   - relation lock: แก้ไข/ลบจากรับ-จ่ายไม่ได้ ต้องแก้ไขหรือลบที่โมดูลบิลยางต้นทาง
   - ถ้าผู้ใช้มีสิทธิ์สาขาต้นทางหรือเป็น `super_admin` จะมีปุ่มเปิดโมดูลบิลยางต้นทางพร้อม filter วันที่ของ row นั้น
   - เมื่อบิลยางถูกเลือกเข้า `money_transfer_items` แล้ว row รวมรายวันจะตัดบิลนั้นออกจากยอด derived

5. **รายจ่ายรวมรายวันจาก OCR บิลยางที่ยังไม่ถูกเลือกไปโอนเงิน**
   - source: `ocr_tickets`
   - เงื่อนไข: `location_id` ตรงกับสาขาที่กำลังดู, `record_status = 'active'`, `total_amount > 0`, และ `id` ยังไม่อยู่ใน `money_transfer_items.source_id` ที่ `source_type = 'ocr_ticket'`
   - ยอดเงิน: รวม `total_amount` ต่อ `date_in`
   - แสดงเป็น `IncomeExpense` ชนิด `expense`
   - badge ใน UI: `OCR บิลยางรวมรายวัน`
   - relation lock: แก้ไข/ลบจากรับ-จ่ายไม่ได้ ต้องแก้ไขหรือลบที่โมดูล OCR บิลยางต้นทาง
   - ถ้าผู้ใช้มีสิทธิ์สาขาต้นทางหรือเป็น `super_admin` จะมีปุ่มเปิดโมดูล OCR บิลยางต้นทางพร้อม filter วันที่ของ row นั้น
   - เมื่อ OCR ticket ถูกเลือกเข้า `money_transfer_items` แล้ว row รวมรายวันจะตัด ticket นั้นออกจากยอด derived

รายการ derived เหล่านี้ไม่ได้ enqueue ลง IndexedDB และไม่ได้เขียนกลับเข้า `income_expense`; `useIncomeExpense` merge เข้ากับ server rows + pending queue ตอน render เท่านั้น เพื่อให้ข้อมูลเปลี่ยนหรือหายตามต้นทางเสมอ.

### Stock Source Of Truth

โมดูล `สต็อกสินค้า` ใช้ table ชื่อกลางตามธุรกิจว่า `stock_*`:

- `stock_products.id` คือ product identity กลางของสินค้าที่กระทบสต็อก ทุก source module ที่ตัดหรือเพิ่ม stock ต้อง map มาที่ id นี้ผ่าน FK เช่น `income_sale_items.stock_product_id`, `income_expense.stock_product_id`, `rubber_bill_items.stock_product_id`, และ `stock_entries.product_id`
- `stock_entries` เก็บเฉพาะ row ที่เป็นของโมดูลสต็อกเอง เช่น `รับเข้า`, `ย้ายออก`, `ย้ายเข้า`; ไม่ใช่ ledger รวมทั้งหมดของสินค้า
- `stock_movements` คือ read model/source-linked ledger ที่รวม `stock_entries` กับ movement ที่ derive จาก source module อื่น เช่น `บิลขาย` ใน `income_expense` และ `หักสินค้า` ใน `rubber_bills`
- บิลขายและบิลยางยังเป็น source of truth ของตัวเอง ไม่ copy เป็น row ใหม่ใน `stock_entries`; stock module แสดงเป็น derived movement เพื่อให้ยอดคงเหลือสะท้อนจริงโดยไม่สร้างข้อมูลซ้ำ
- ยอดคงเหลือต้องคำนวณจาก `sum(quantity_delta)` บน `stock_movements` ไม่ใช่จาก `stock_entries` อย่างเดียว

### Time Tracking Payroll Cutoff

โมดูล `เวลาและเงินเดือน` ใช้ `time_segments` เป็น source row ของเวลาทำงาน และใช้ cutoff `15:00` ตาม timezone `Asia/Bangkok` เป็นเส้นนับวันค่าแรง:

- ถ้า segment ผ่านเวลา `15:00` ให้คิดค่าแรงตามจำนวนเส้น `15:00` ที่ผ่าน เช่น `14:59 -> 15:00` = `1` วัน และ `15:01 -> 15:00` ของวันถัดไป = `1` วัน
- ถ้า segment ยังไม่ผ่าน `15:00` ให้ fallback เป็นชั่วโมงรวม / 8 เพื่อรองรับงานครึ่งวัน เช่น `08:00 -> 12:00` = `0.5` วัน
- ฝั่ง API ใช้ helper กลาง `src/lib/time-tracking/pay.ts`
  - `GET /api/lanflow/time-tracking/user` ใช้คำนวณ `wageInfo.totalDays`, `grossPay`, `remainingBalance`
  - `POST /api/lanflow/time-tracking/admin` action `CREATE_PAYROLL_SLIP` ใช้คำนวณ snapshot `total_days` และ `gross_pay`
- ฝั่ง database มี helper `public.calculate_time_segment_paid_days(start_time, end_time)` และ `public.calculate_paid_work_days(profile_id, period_start, period_end)` เพื่อให้ job/RPC อย่าง `deduct_debts_daily()` ใช้สูตรเดียวกับ API
- client countdown ที่ split ที่ `15:00` เป็น UX helper เท่านั้น ไม่ใช่ source of truth; server/API/DB ต้องคำนวณค่าแรงซ้ำจาก `time_segments`

### Income/Expense Approval Workflow

โมดูลรายรับ-รายจ่ายมี approval gate เพิ่มสำหรับรายการที่ `super_admin` ต้องตรวจสอบก่อนเข้าตารางจริง:

1. `super_admin` ตั้งค่าใน `IncomeExpenseApprovalModal`
   - `income_expense_approval_keywords`: ข้อความที่ต้องตรวจ เช่น `เบิก`, `ค่าแรง`, `กับข้าว`
   - `income_expense_approval_settings`: threshold กลางตามยอดเงิน
2. ตอนผู้ใช้บันทึกรายรับ/รายจ่าย `IncomeExpenseModule` เรียก `useIncomeExpenseApprovals.submitForApprovalIfNeeded`
3. API `POST /api/lanflow/income-expense/approval-requests` เรียก RPC `create_income_expense_approval_request(payload jsonb)`
4. RPC ตรวจ keyword/threshold ฝั่ง server อีกครั้ง ไม่เชื่อผลจาก UI อย่างเดียว
5. ถ้าไม่เข้าเงื่อนไข approval จะกลับไปใช้ offline-first sync flow เดิมของ `income_expense`
6. ถ้าเข้าเงื่อนไข approval จะสร้าง row ใน `income_expense_approval_requests` และยังไม่สร้าง/แก้ `income_expense`
7. `super_admin` อนุมัติหรือปฏิเสธผ่าน `POST /api/lanflow/income-expense/approval-requests/[id]/decide`
8. เมื่ออนุมัติ RPC `decide_income_expense_approval_request` จึงสร้างหรือแก้ `income_expense`; เมื่อปฏิเสธจะเก็บคำขอไว้เป็นประวัติและไม่สร้าง row จริง

กติกาสำคัญ:

- approval keywords ไม่ใช่ `bill_option`; เป็น string matching จาก `title`
- keyword ใช้ `contains` เป็นค่าเริ่มต้น และรองรับ `exact`
- threshold ใช้ `amount >= approval_min_amount`
- approval/decision เป็น online-only
- rejected approval เป็น audit history; ถ้าส่งรายการเดิมอีกครั้งต้องสร้างคำขอใหม่
- การลบรายการที่เคย approved ไม่ต้องขออนุมัติใหม่
- approval queue ของ `super_admin` แสดงทุกสาขาเป็นค่าเริ่มต้น และมี filter สาขา
- table config/decision เขียนได้เฉพาะ `super_admin` ผ่าน RLS/RPC

กติกา edit/delete ของ Income/Expense ปัจจุบัน:

- local draft ที่ยังไม่เคย sync แก้/ลบ offline ได้
- synced record ต้อง online ก่อนถึงแก้/ลบได้
- failed/conflict queue ต้อง resolve ก่อน
- derived rows จาก `money_transfers`, `rubber_bills`, และ `ocr_tickets` ถูกล็อกเสมอและแก้/ลบจากรับ-จ่ายไม่ได้

### Module Coverage

สถานะ offline-first ณ ตอนนี้:

- **Rubber Bills**: Full Offline สำหรับ create/update/delete, PWA reload, RPC atomic sync; เป็น source ของ derived expense รายวันใน Income/Expense สำหรับบิลที่ยังไม่ถูกเลือกไปโอนเงิน
- **Auth / Bootstrap**: รองรับ offline auth cache และ branch bootstrap cache
- **Income/Expense**: Full Offline สำหรับ create/update/delete, PWA reload, RPC atomic sync
- **OCR Tickets**: online-first; เป็น source ของ derived expense รายวันใน Income/Expense สำหรับ OCR บิลยางที่ยังไม่ถูกเลือกไปโอนเงิน และถูก relation lock เมื่ออยู่ใน `money_transfer_items.source_type = 'ocr_ticket'`
- **Money Transfer**: online-first; เป็น source ของ derived rows ใน Income/Expense สำหรับโอนเงินสาขาขาเข้า/ขาออก, รายการสำนักงานใหญ่/CEO โอนให้สาขา, และโอนลูกค้าสถานะ `โอน+สาขาจ่าย`; `money_transfer_items` เป็นตัวตัดบิลยางและ OCR ticket ออกจาก derived expense รายวัน; เข้าเมนูและเขียนข้อมูลได้เฉพาะ `super_admin` หรือ user/admin ที่ `super_admin` เปิด `can_access_super_admin_features`
- **Time Tracking**: มี online state และ badge/status แต่ไม่ได้เป็น offline-first core flow เท่า Rubber Bills และ Income/Expense; ค่าแรงคำนวณจาก `time_segments` ผ่าน cutoff `15:00` (`Asia/Bangkok`) โดยใช้ helper กลางทั้งฝั่ง API และ DB

### เปรียบเทียบ Offline-First: Rubber Bills vs Income/Expense

| หัวข้อ | Rubber Bills | Income/Expense |
|---|---|---|
| สถานะ offline-first | **Full Offline** | **Full Offline หลัง Phase 1-4 ผ่านครบ** |
| Hook หลัก | `useRubberBills` | `useIncomeExpense` |
| วิธีบันทึกข้อมูล | เขียนคำสั่งลง IndexedDB queue ก่อน แล้ว sync ภายหลัง | เขียนคำสั่งลง IndexedDB queue ก่อน แล้ว sync ภายหลัง |
| Local queue | ใช้ `lanflow_sync_db` / `sync_queue` ผ่าน `idb-queue.ts` | ใช้ `lanflow_sync_db` / `sync_queue` ผ่าน `idb-queue.ts` |
| Operations ที่รองรับ offline | `create`, `update`, `delete` | `create`, `update`, `delete` |
| Optimistic UI | merge server state + pending queue | merge server state + pending queue |
| Sync trigger | ตอน mount ถ้า online และตอน browser กลับมา online | ตอน mount ถ้า online และตอน browser กลับมา online |
| Conflict handling | มี `failed` / `conflict` event ค้างใน queue พร้อม `syncErrorMessage` | มี `failed` / `conflict` event ค้างใน queue พร้อม `syncErrorMessage` |
| Coalescing | มี `coalesceQueueGroup`: รวม create/update/delete หลาย event ให้เป็นคำสั่งเดียวที่ปลอดภัย | มี `coalesceQueueGroup`: รวม create/update/delete หลาย event ให้เป็นคำสั่งเดียวที่ปลอดภัย |
| Idempotency | payload มี `idempotencyKey`, `clientTempId`, `expectedRevisionNo` และ replay ได้ | payload มี `idempotencyKey`, `clientTempId`, `expectedRevisionNo` และ replay ได้ |
| Backend path | `POST /api/lanflow/rubber-bills` -> Supabase RPC `sync_rubber_bill` | `POST /api/lanflow/income-expense` -> Supabase RPC `sync_income_expense` |
| Atomic transaction | ใช้ RPC ฝั่ง Supabase สำหรับ sync บิลแม่/รายการลูกแบบ atomic | ใช้ RPC ฝั่ง Supabase สำหรับ sync single-row transaction แบบ atomic |
| Server bill number | server/RPC เป็นผู้จัดการเพื่อกันเลขชน | server/RPC เป็นผู้จัดการเพื่อกันเลขชน |
| Delete behavior | enqueue delete และ sync เป็น soft delete ผ่าน backend path | enqueue delete และ sync เป็น soft delete ผ่าน backend path |
| Direct DB writes จาก browser | ปิดแล้ว เหลือ `SELECT` + RPC execute | ปิดแล้ว เหลือ `SELECT` + RPC execute |
| Derived rows | ไม่มี row ปลายทางจริง; บิลยางและ OCR ticket เป็น source ให้ Income/Expense รวมรายจ่ายรายวันเมื่อยังไม่ถูกเลือกไปโอนเงิน | แสดงรายรับ/รายจ่ายจาก `money_transfers` และรายจ่ายรวมรายวันจาก `rubber_bills`/`ocr_tickets` โดยล็อกแก้/ลบ |
| PWA test coverage | `rubber-bills-offline.spec.ts`, `rubber-bills-pwa.spec.ts` | `income-expense-offline.spec.ts`, `income-expense-pwa.spec.ts` |
| Hardening coverage | idempotency, conflict, failed, coalescing, replay | idempotency, conflict, failed, concurrent bill number, shared sequence, soft delete |
| ความพร้อมสำหรับ tablet/offline | พร้อมใช้งาน offline-first | พร้อมใช้งาน offline-first |

**สรุป:** Rubber Bills และ Income/Expense เป็น offline-first core modules แล้วทั้งคู่ โดยมี API/RPC เป็น write boundary และ IndexedDB เป็น queue กลางสำหรับงาน data entry บน tablet.

## 5. การทดสอบระบบ (Testing Strategy)

### Test Tooling

ใช้ **Playwright** เป็น E2E test runner:

- config หลัก: `playwright.config.ts`
- dev project: `chromium`
- PWA project: `chromium-pwa`
- global teardown: kill port `3000` หรือ `3001` หลัง test บน Windows

### คำสั่งสำคัญ

```powershell
# Type check
npx.cmd tsc --noEmit

# Production build
npm run build

# Dev-mode E2E
npx.cmd playwright test --project=chromium

# PWA / production-mode E2E
$env:PW_PROJECT="pwa"; npx.cmd playwright test --project=chromium-pwa
```

### Dev-mode Offline Tests

`tests/rubber-bills-offline.spec.ts` ทดสอบ flow หลักของ Rubber Bills:

- create/edit/delete แบบ offline
- reload และ sync เมื่อกลับมา online
- idempotency replay
- coalesce update หลายครั้ง
- coalesce update แล้ว delete
- legacy duplicate queue events
- create + delete เป็น no-op
- create + update เป็น create เดียวด้วย payload ล่าสุด

`tests/income-expense-offline.spec.ts` ทดสอบ flow หลักของ Income/Expense:

- offline create รายรับและรายจ่าย
- edit synced row ซ้ำตอน offline แล้ว coalesce เป็น update ล่าสุด
- edit แล้ว delete ตอน offline แล้ว sync เป็น soft delete
- create แล้ว delete ก่อน sync เป็น no-op
- replay payload เดิมไม่ duplicate
- stale revision เป็น `conflict` และ UI แสดง error
- invalid payload เป็น `failed` และ queue ไม่ถูกลบ
- concurrent create แล้ว `server_bill_no` ไม่ซ้ำ
- income/expense ใช้ sequence ร่วมกันต่อสาขา/วัน
- delete คง record history และ soft delete เท่านั้น

### PWA Tests

`tests/rubber-bills-pwa.spec.ts` ทดสอบ production-mode PWA:

- service worker ทำงานหลัง build
- offline page reload ยังกลับมาใช้ UI ได้
- IndexedDB queue อยู่รอดหลัง reload
- reconnect แล้ว sync สำเร็จ

`tests/income-expense-pwa.spec.ts` ทดสอบ production-mode PWA สำหรับรายรับ-รายจ่าย:

- bootstrap cache พร้อมก่อน offline
- create transaction ตอน offline
- reload while offline แล้วยังเข้า tab รายรับ-รายจ่ายได้
- pending row ยังอยู่หลัง reload
- reconnect แล้ว sync สำเร็จ

`tests/auth-cache-offline.spec.ts` ทดสอบ auth cache:

- logout แล้ว offline reload ต้องไม่ restore profile
- expired offline cache ต้อง sign out และ clear cache

### ข้อสังเกตจากการรันล่าสุด

- `npx.cmd tsc --noEmit` ผ่าน
- `npm run build` ผ่าน
- `rubber-bills-offline.spec.ts` ผ่าน
- `rubber-bills-pwa.spec.ts` ผ่าน
- `income-expense-offline.spec.ts` ผ่าน 11/11
- `income-expense-pwa.spec.ts` ผ่าน
- `chromium-pwa` ผ่านสำหรับ PWA tests ที่เกี่ยวข้อง

## 6. สิ่งที่ควรรู้ก่อนพัฒนาต่อ

### Development Workflow ที่แนะนำ

ก่อนเริ่มแก้ feature ใหญ่ ควรทำตามลำดับนี้:

1. อ่าน domain folder ที่เกี่ยวข้องก่อน เช่น `rubber-bills/`, `income-expense/`, `lanflow/`
2. ตรวจ hook/API/schema ที่ module นั้นใช้
3. แก้แบบเล็กที่สุดเท่าที่พอ
4. รัน `npx.cmd tsc --noEmit`
5. ถ้าแตะ PWA/offline ให้รัน Playwright ที่เกี่ยวข้องเสมอ

คำสั่งที่ใช้บ่อย:

```powershell
npm run dev
npx.cmd tsc --noEmit
npm run build
npx.cmd playwright test --project=chromium
$env:PW_PROJECT="pwa"; npx.cmd playwright test --project=chromium-pwa
```

### Module Boundary Rules

- **อย่าเอา logic ขนาดใหญ่กลับเข้า `LanFlowApp.tsx`**
  - ไฟล์นี้ควรเป็น shell/orchestrator เท่านั้น
  - ถ้าเพิ่ม feature ใหม่ ให้สร้าง module หรือ hook แยกตาม domain

- **แยก domain ให้ชัด**
  - งานบิลยางอยู่ใน `src/components/rubber-bills/`
  - งานรายรับ-รายจ่ายอยู่ใน `src/components/income-expense/`
  - shell/tab/header อยู่ใน `src/components/lanflow/`
  - UI กลางเท่านั้นอยู่ใน `src/components/shared/`

- **shared component ต้องไม่ผูก domain ถ้าไม่จำเป็น**
  - ตัวอย่างที่ดีคือ `SyncStatusBadge` ใช้ type กลาง `SyncStatus`
  - หลีกเลี่ยง shared component ที่ import `RubberBill` หรือ `IncomeExpense` โดยตรง

### Offline-First Rules

Rubber Bills และ Income/Expense เป็น module data-entry ที่รองรับ full offline flow:

- ห้ามใช้ `new Date()` ฝั่ง client เป็น source of truth ของเวลาสำคัญ
- ห้ามเปลี่ยน `localBillNo` หลังสร้างแล้ว
- ห้ามให้ browser เขียน `rubber_bills` / `rubber_bill_items` / `income_expense` โดยตรงถ้าเป็น sync flow สำคัญ
- create/update/delete ต้อง replay ได้โดยไม่เกิดข้อมูลซ้ำ
- conflict/failed event ต้องอยู่ใน IndexedDB จนกว่าผู้ใช้หรือระบบจะแก้ได้
- ถ้าแก้ `useRubberBills`, `useIncomeExpense`, `idb-queue`, `coalesceQueueGroup`, `/api/lanflow/rubber-bills`, หรือ `/api/lanflow/income-expense` ต้องรัน offline/PWA tests ที่เกี่ยวข้อง

### Money Relation Lock Rules

ข้อมูลการเงินที่เกิดจากโมดูลอื่นต้องมีเจ้าของต้นทางชัดเจน:

- Rubber Bill และ OCR Ticket ที่ถูกใช้ใน `money_transfer_items` ถูกล็อกไม่ให้แก้/ลบจนกว่าจะยกเลิกความสัมพันธ์ในรายการโอนเงิน
- รายรับขาเข้าจากโอนเงินสาขาเป็น derived row จาก `money_transfers` ไม่ใช่ row จริงที่ผู้ใช้แก้ใน `income_expense`
- รายการโอนเงินแบบ `โอนให้สาขา` ในโมดูลโอนเงินเป็นรายการสำนักงานใหญ่/CEO โอนเข้า branch โดย `location_id = target_location_id`; รับ-จ่ายจะแสดงเฉพาะรายรับ ไม่สร้างรายจ่ายขาออก
- โมดูลโอนเงินถูก gate ด้วยสิทธิ์ผู้จัดการระบบ (`profiles.can_access_super_admin_features`) เป็นหลัก; ผู้ไม่มีสิทธิ์จะไม่เห็น tab `โอนเงิน`, ไม่ fetch/render โมดูลโอนเงิน, และไม่เห็นปุ่ม `โยกเงินไปสาขาอื่น` ใน Income/Expense
- รายจ่ายรวมรายวันจากบิลยางที่ยังไม่อยู่ใน `money_transfer_items` เป็น derived row จาก `rubber_bills` ไม่ใช่ row จริงที่ผู้ใช้แก้ใน `income_expense`
- รายจ่ายรวมรายวันจาก OCR บิลยางที่ยังไม่อยู่ใน `money_transfer_items` เป็น derived row จาก `ocr_tickets` ไม่ใช่ row จริงที่ผู้ใช้แก้ใน `income_expense`
- รายจ่ายส่วน `โอน+สาขาจ่าย` ของโอนเงินลูกค้าเป็น derived row จาก `money_transfers.branch_paid_amount`
- derived row ในรับ-จ่ายต้อง disable edit/delete พร้อมข้อความไทยชัดเจน และต้องแก้จากโมดูลต้นทางเท่านั้น
- ปุ่มเปิดต้นทางของ locked row แสดงเฉพาะผู้ใช้ที่มีสิทธิ์สาขาต้นทาง, `super_admin`, หรือผู้มีสิทธิ์ผู้จัดการระบบ; ห้ามบังคับสลับไปสาขาที่ผู้ใช้ไม่มีสิทธิ์
- ถ้าต้องการให้ Income/Expense เป็น source item ใน `money_transfer_items` ในอนาคต ต้องเพิ่ม `source_type = 'income_expense'` แบบ explicit พร้อม migration, RLS, และ tests แยก

### Auth และ Security Rules

- อย่าใส่ `service_role` หรือ secret ใด ๆ ใน browser/client component
- client-side role guard เป็นแค่ UX ไม่ใช่ security boundary
- security จริงต้องอยู่ที่:
  - API route guard เช่น `requireAuth`, `requireRole`
  - Supabase RLS / RPC / grant policy
- ถ้าเพิ่ม admin action ใหม่ ต้องตรวจทั้ง 3 ชั้น:
  - UI แสดงเฉพาะ role ที่ถูกต้อง
  - API ตรวจ role
  - DB/RLS/RPC ไม่เปิด bypass

### Database / Migration Rules

- ถ้าแก้ schema ให้เพิ่ม migration ใน `supabase/migrations/`
- อัปเดต `supabase-schema.sql` ให้ตรงกับ migration snapshot
- ถ้าเพิ่ม table ใหม่ ต้องตรวจ:
  - primary key / unique constraints
  - `created_at` / `updated_at`
  - `location_id` ถ้าเป็นข้อมูลแยกสาขา
  - RLS policies
  - grants สำหรับ role ที่จำเป็น
- ถ้าเป็นข้อมูล offline/replay ควรมี idempotency key หรือ RPC transaction

### Testing Notes

- `chromium` project ใช้ dev server และเหมาะกับ logic/flow ปกติ
- `chromium-pwa` project ใช้ production build และเหมาะกับ service worker/PWA behavior
- ก่อนรัน PWA tests ต้อง `npm run build`
- ถ้า dev-mode full suite timeout ที่หน้า login แต่ rerun เฉพาะเคสผ่าน ให้ถือเป็น flaky cold-load ก่อน แต่ควรจับตาถ้าเกิดซ้ำบ่อย
- tests ที่ควรระวังเป็นพิเศษ:
  - `tests/rubber-bills-offline.spec.ts`
  - `tests/rubber-bills-pwa.spec.ts`
  - `tests/income-expense-offline.spec.ts`
  - `tests/income-expense-pwa.spec.ts`
  - `tests/auth-cache-offline.spec.ts`

### Known Caveats

- ข้อความไทยใน PowerShell output อาจแสดงเพี้ยน แต่ไฟล์ source เป็น UTF-8 และ browser แสดงถูกต้อง
- `public/sw.js` เป็น generated artifact จาก PWA build ไม่ควรแก้ด้วยมือ
- PWA test อาจ fail ถ้า `.next/BUILD_ID` หายหรือยังไม่ได้ build ใหม่
- Playwright config ตั้ง `reuseExistingServer: false` ดังนั้นถ้ามี server ค้างบน port `3000` หรือ `3001` test จะเริ่มไม่ได้

## สรุปภาพรวม

LanFlow หลัง modularization มีโครงสร้างแยกตาม domain ชัดเจนขึ้น:

- `LanFlowApp.tsx` ทำหน้าที่ orchestration
- module ใหญ่ถูกย้ายไป folder เฉพาะ domain
- shared UI ถูกแยกไว้ที่ `components/shared`
- Rubber Bills และ Income/Expense เป็น offline-first core modules
- Auth/PWA/IndexedDB queue ถูกออกแบบให้รองรับ tablet/offline workflow
- Playwright ครอบคลุมทั้ง dev-mode offline sync และ production-mode PWA reload
