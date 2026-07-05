# LanFlowApp Modularization Plan

## Intent

แยก `LanFlowApp.tsx` ออกเป็นโมดูลย่อยเพื่อให้ดูแลง่ายขึ้น โดยต้องไม่เปลี่ยนพฤติกรรมผู้ใช้, offline-first flow, role/permission, หรือ validation เดิม

## Current Trace

ไฟล์หลักตอนนี้คือ `src/components/LanFlowApp.tsx` มีประมาณ 2,053 บรรทัด และรวมหลายหน้าที่ไว้ในไฟล์เดียว:

- Bootstrap cache: `writeBootstrapCache`, `readBootstrapCache`
- App shell: auth/profile/location loading, selected location, online state, tab navigation
- Dashboard: `Dashboard`, `Metric`
- Rubber bills: `RubberBillsModule`, `RubberBillModal`, sync badge, bill display helpers
- Income/expense: `IncomeExpenseModule`, `IncomeExpenseModal`
- Shared UI primitives: `ModalShell`, `IconButton`, `Field`, `NumberField`, `InlineRadio`, `InlineNumber`

วิธีที่เล็กและเสี่ยงน้อยที่สุดคือย้ายโค้ดเป็นไฟล์ย่อยแบบ mechanical extraction ก่อน ห้าม rewrite business logic ในรอบเดียวกัน

## Non-Negotiable Rules

- ห้ามแก้ logic ของ `useRubberBills`, IndexedDB queue, RPC payload, หรือ offline sync ระหว่าง phase แยก component
- ห้ามเปลี่ยนข้อความ/label ภาษาไทยด้วยมือถ้าไม่จำเป็น ให้ย้าย JSX เดิมออกไปทั้งก้อนเพื่อลดความเสี่ยง encoding/ข้อความเพี้ยน
- ห้ามรวม refactor กับ feature ใหม่
- หลังจบแต่ละ phase ต้องผ่าน `npx.cmd tsc --noEmit`
- หลัง phase ที่แตะบิลยางต้องรัน Playwright offline test ที่เกี่ยวข้อง
- ถ้า behavior เปลี่ยน ให้ revert เฉพาะ phase นั้น ไม่ลากแก้ต่อจนปนกัน

## Proposed Target Structure

```text
src/components/lanflow/
  AppHeader.tsx
  NavigationTabs.tsx
  tabs.ts

src/components/dashboard/
  Dashboard.tsx
  Metric.tsx

src/components/rubber-bills/
  RubberBillsModule.tsx
  RubberBillsTable.tsx
  RubberBillModal.tsx
  SyncStatusBadge.tsx
  bill-display.ts

src/components/income-expense/
  IncomeExpenseModule.tsx
  IncomeExpenseModal.tsx
  income-expense-display.ts

src/components/shared/
  ModalShell.tsx
  IconButton.tsx
  Field.tsx
  NumberField.tsx
  InlineRadio.tsx
  InlineNumber.tsx

src/lib/lanflow/
  bootstrap-cache.ts
```

## Phase 0: Baseline And Safety Net

### Tasks

1. Run baseline checks before edits:
   - `npx.cmd tsc --noEmit`
   - `npm run build`
   - `npx.cmd playwright test --project=chromium`
   - `$env:PW_PROJECT="pwa"; npx.cmd playwright test --project=chromium-pwa`
2. Record current line/function map from `LanFlowApp.tsx`.
3. Confirm git working tree before refactor so unrelated changes are not mixed in.

### Acceptance Criteria

- Baseline passes or existing failures are documented before refactor starts.
- No source files changed in this phase except optional notes.

## Phase 1: Extract Pure Utilities And Shared UI

This phase is safest because it should only move code, not change state flow.

### Tasks

1. Move `writeBootstrapCache` and `readBootstrapCache` to `src/lib/lanflow/bootstrap-cache.ts`.
2. Move `Tab` and `tabs` to `src/components/lanflow/tabs.ts`.
3. Move shared UI primitives:
   - `ModalShell` -> `src/components/shared/ModalShell.tsx`
   - `IconButton` -> `src/components/shared/IconButton.tsx`
   - `Field` -> `src/components/shared/Field.tsx`
   - `NumberField` -> `src/components/shared/NumberField.tsx`
   - `InlineRadio` -> `src/components/shared/InlineRadio.tsx`
   - `InlineNumber` -> `src/components/shared/InlineNumber.tsx`
4. Keep component names and props identical.
5. Update imports in `LanFlowApp.tsx`.

### Verification

```powershell
npx.cmd tsc --noEmit
npm run build
```

### Risks To Check

- `React.ComponentType` type for tab icons must still compile.
- `NumberField` and `InlineNumber` must preserve focus/zero handling exactly.
- No circular import from shared components back into `LanFlowApp`.

## Phase 2: Extract Dashboard

### Tasks

1. Move `Metric` to `src/components/dashboard/Metric.tsx`.
2. Move `Dashboard` to `src/components/dashboard/Dashboard.tsx`.
3. Export a narrow prop type for dashboard:
   - `selectedLocation`
   - `summary`
   - `bills`
   - `transactions`
   - `supabaseReady`
4. Keep summary calculation inside `LanFlowApp.tsx` for now; only move rendering.

### Verification

```powershell
npx.cmd tsc --noEmit
npm run build
```

### Risks To Check

- `Dashboard` should remain presentational.
- Do not move `summary` calculation yet; moving it too early can hide dependency changes.

## Phase 3: Extract Rubber Bills

This is the highest-risk phase because it touches the shipment-critical offline module.

### Tasks

1. Move display helpers to `src/components/rubber-bills/bill-display.ts`:
   - `formatBillTimestamp`
   - `getDisplayBillNo`
2. Move `SyncStatusBadge` to `src/components/rubber-bills/SyncStatusBadge.tsx`.
3. Move the table body/header/pagination from `RubberBillsModule` into `RubberBillsTable.tsx`.
4. Move `RubberBillModal` into `src/components/rubber-bills/RubberBillModal.tsx`.
5. Move `RubberBillsModule` into `src/components/rubber-bills/RubberBillsModule.tsx`.
6. Keep `useRubberBills`, `useCustomers`, `validateRubberBillDraft`, `makeClientTempId`, `makeLocalBillNo`, and sync behavior unchanged.
7. Do not change confirm/delete behavior beyond preserving existing props.

### Suggested Component Contracts

```ts
type RubberBillsModuleProps = {
  selectedLocation: Location;
  profile: Profile;
};

type RubberBillsTableProps = {
  bills: RubberBill[];
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (value: string) => void;
  onEdit: (bill: RubberBill) => void;
  onDelete: (bill: RubberBill) => void;
};
```

### Verification

```powershell
npx.cmd tsc --noEmit
npm run build
npx.cmd playwright test tests/rubber-bills-offline.spec.ts --project=chromium
$env:PW_PROJECT="pwa"; npx.cmd playwright test tests/rubber-bills-pwa.spec.ts --project=chromium-pwa
```

### Risks To Check

- Offline created bill must still show pending status.
- Edit/delete offline events must still be queued.
- `SyncStatusBadge` must still show `syncErrorMessage`.
- `localBillNo` must not regenerate after modal extraction.
- Customer autocomplete must still show global legacy customers for admin/user.

## Phase 4: Extract Income/Expense

### Tasks

1. Move `getIncomeExpenseDisplayNo` to `src/components/income-expense/income-expense-display.ts`.
2. Move `IncomeExpenseModal` to `src/components/income-expense/IncomeExpenseModal.tsx`.
3. Move `IncomeExpenseModule` to `src/components/income-expense/IncomeExpenseModule.tsx`.
4. Keep `IncomeSaleItemsModal` where it is or move it later in a separate small phase.
5. Keep `useIncomeExpense` behavior unchanged.

### Verification

```powershell
npx.cmd tsc --noEmit
npm run build
```

Manual checks:

- Add income "รายรับ" and verify form fields match current behavior.
- Add "บิลขาย" and verify sale item dropdown still works.
- Add expense "ค่าใช้จ่าย".
- Verify super_admin-only sale item management button still only appears for super_admin.

### Risks To Check

- Existing income/expense UI has role-specific sale item controls; do not loosen this by moving props badly.
- Customer autocomplete duplicated with rubber bills; do not unify it yet unless tests cover both modules.

## Phase 5: Extract App Shell

### Tasks

1. Move header/location selector/logout button to `src/components/lanflow/AppHeader.tsx`.
2. Move tab navigation and badges to `src/components/lanflow/NavigationTabs.tsx`.
3. Keep `LanFlowApp.tsx` as orchestration only:
   - auth profile
   - bootstrap cache load/write
   - selected location
   - summary data
   - active tab routing
4. Do not move `addLocation` until `AdminModule` contract is stable.

### Verification

```powershell
npx.cmd tsc --noEmit
npm run build
npx.cmd playwright test --project=chromium
```

### Risks To Check

- Admin tab must still hide for normal user.
- OCR/money transfer/time tracking badges must still count correctly.
- Selected branch dropdown must still persist into bootstrap cache.

## Phase 6: Cleanup And Review

### Tasks

1. Check `LanFlowApp.tsx` target size. Goal: about 200-350 lines.
2. Remove unused imports and dead helpers.
3. Run `rg` for moved function names to confirm no stale duplicates.
4. Run full verification.
5. Use `scrutinize` review before commit.

### Full Verification

```powershell
npx.cmd tsc --noEmit
npm run build
npx.cmd playwright test --project=chromium
$env:PW_PROJECT="pwa"; npx.cmd playwright test --project=chromium-pwa
```

## Final Acceptance Criteria

- `LanFlowApp.tsx` contains app orchestration only, not large modal/table implementations.
- Rubber bill offline create/edit/delete/reload/sync tests still pass.
- PWA offline reload still passes.
- No feature behavior changes are bundled into the refactor.
- Folder structure makes ownership obvious by domain: dashboard, rubber-bills, income-expense, shared, lanflow shell.

## Verdict

Fix-then-ship plan. The refactor is worthwhile, but only if implemented in small mechanical phases with tests after each phase; combining this with feature work would be too risky because `LanFlowApp.tsx` contains shipment-critical offline bill behavior.
