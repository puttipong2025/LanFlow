# Income/Expense Sales Bill Adjustment Plan

เอกสารนี้เป็นแผนปรับโมดูล `รายรับ-รายจ่าย` ตาม requirement ล่าสุด โดยยังไม่ลงมือแก้โค้ดจริงในรอบนี้

## เป้าหมาย

ปรับ form รายรับ-รายจ่ายให้เรียบง่ายขึ้น และแยกกรณี `บิลขาย` ออกจาก `รายรับทั่วไป` ให้ชัดเจน

- ลบฟีเจอร์ `ช่องทางการรับจ่ายเงิน`
- ลบ option ที่ไม่ต้องใช้แล้ว
- เปลี่ยนชื่อ `บิลน้ำกรด` เป็น `บิลขาย` ทั้ง UI, backend/hook, Supabase data และเอกสารที่เกี่ยวข้อง
- เพิ่มระบบจัดการ dropdown รายการบิลขาย โดยให้เฉพาะ `super_admin` จัดการได้
- คงรูปแบบตารางรับ-จ่ายเดิมไว้ ไม่แก้ layout ตารางโดยไม่แจ้งก่อน

## Decisions จาก Grill

1. รายการบิลขายไม่มี `ราคาตั้งต้น` ผู้ใช้ต้องกรอกราคาทุกครั้ง
2. รายการบิลขายเป็น global catalog ใช้ร่วมกันทุกสาขา
3. ถ้ารายการบิลขายถูกใช้แล้ว ปุ่มลบต้องทำเป็น `ปิดใช้งาน` ไม่ลบประวัติจริง
4. `transaction_option` ให้ drop column ใน migration รอบนี้ หลังแก้ code ไม่ใช้งานแล้ว
5. ข้อมูลเก่าของ option ที่ถูกยกเลิกให้ลบ/mark deleted ไม่ migrate เป็นหมวดใหม่
6. ข้อมูลเก่า `บิลน้ำกรด` ยังถือเป็นข้อมูลขาย ให้เปลี่ยนชื่อเป็น `บิลขาย`

## ขอบเขตที่ต้องแก้

### 1. UI หลัก

ไฟล์หลักที่เกี่ยวข้อง:

- `src/components/LanFlowApp.tsx`
- `src/hooks/useIncomeExpense.ts`
- `src/types/index.ts`
- `supabase/migrations/*`
- `supabase-schema.sql`

จุดที่ต้องแก้ใน `IncomeExpenseModule`:

- action bar class `flex flex-col gap-2 sm:flex-row`
- ปุ่มเดิม:
  - `เพิ่มรายรับ`
  - `เพิ่มรายจ่าย`
- เพิ่มปุ่มใหม่:
  - `เพิ่มรายการบิลขาย`
  - แสดงเฉพาะ `profile.role === "super_admin"`
  - กดแล้วเปิด modal ทับซ้อนสำหรับจัดการรายการ dropdown ของบิลขาย

หมายเหตุ: ตารางรับ-จ่ายปัจจุบันยังคงรูปแบบเดิมไว้ หากแก้จะเปลี่ยนเฉพาะข้อความใน field `billOption` ที่ถูก migrate เช่น `บิลน้ำกรด` -> `บิลขาย`

## รายรับ

### ตัวเลือกเดิมที่ต้องลบ

ลบ section:

- `ช่องทางการรับจ่ายเงิน`

ลบ field/backend mapping ที่เกี่ยวข้อง:

- `transactionOption`
- `transaction_option`
- radio option `ภายในสาขานี้`
- radio option `สำนักงานใหญ่`

ลบ option ใน `รูปแบบ`:

- `บิลทั่วไป`

เปลี่ยนชื่อ option:

- `บิลน้ำกรด` -> `บิลขาย`

หลังปรับแล้ว รายรับจะมี option เหลือ:

```text
รายรับ
บิลขาย
```

### Form เมื่อเลือก `บิลขาย`

แต่ละ line item ต้องมี field:

```text
รายการ: dropdown/read-only list
จำนวน: number
ราคา: number
รายรับ: readOnly, คำนวณจาก จำนวน * ราคา
ลบ: ปุ่มลบแถว
```

รายการเริ่มต้นใน dropdown:

```text
น้ำกรดตราเสือไฟท์
น้ำกรดตรามังกรไฟท์
```

กติกา:

- `รายการ` ต้องเลือกจาก dropdown รายการบิลขายเท่านั้น
- `รายรับ` ห้ามพิมพ์เองในโหมด `บิลขาย`
- `รายรับ = จำนวน * ราคา`
- สามารถเพิ่มหลาย line ได้เหมือน form ปัจจุบัน
- ผู้ใช้ต้องกรอก `ราคา` ทุกครั้ง ไม่มีราคาตั้งต้นจาก dropdown

### Form เมื่อเลือก `รายรับ`

เมื่อเลือก option `รายรับ` input ต้องเหลือแค่:

```text
รายการ
รายรับ
ลบ
```

กติกา:

- ลบช่อง `จำนวน`
- ลบช่อง `ราคา`
- ลบสูตร `จำนวน * ราคา`
- field `รายรับ` ไม่เป็น readOnly และให้ผู้ใช้กรอกเอง

## รายจ่าย

### ตัวเลือกเดิมที่ต้องลบ

ลบ section:

- `ช่องทางการรับจ่ายเงิน`

ลบ option ใน `รูปแบบ`:

- `สูญหาย`
- `บิลค่าแรง`

หลังปรับแล้ว รายจ่ายจะมี option เหลือ:

```text
ค่าใช้จ่าย
```

### Form รายจ่าย

input ต้องเหลือแค่:

```text
รายการ
ค่าใช้จ่าย
ลบ
```

กติกา:

- ลบช่อง `จำนวน`
- ลบช่อง `ราคา`
- ไม่มีสูตร
- field `ค่าใช้จ่าย` ให้ผู้ใช้กรอกเอง

## Modal จัดการรายการบิลขาย

ปุ่ม:

```text
เพิ่มรายการบิลขาย
```

สิทธิ์:

- เห็นและกดได้เฉพาะ `super_admin`
- `admin` และ `user` ไม่เห็นปุ่มนี้

พฤติกรรม:

- เปิด modal ซ้อนทับหน้าเดิม
- ภายใน modal มีตารางรายการบิลขายที่เคยสร้าง
- มีปุ่ม `สร้างรายการขายเพิ่ม`
- มีปุ่ม `ลบ`

ตารางใน modal:

```text
ชื่อรายการ
สถานะ
สร้างโดย
สร้างเมื่อ
Action
```

กติกาการลบ:

- รายการบิลขายให้ใช้แนวทาง `ปิดใช้งาน` เป็นหลัก
- ถ้ารายการเคยถูกใช้ในรายรับแล้ว ห้ามลบจริง ให้ตั้ง `is_active = false`
- เพื่อความเรียบง่าย รอบแรกใช้ `ปิดใช้งาน` แม้รายการยังไม่เคยถูกใช้
- historical income rows ต้องยังแสดงชื่อรายการเดิมได้ เพราะ `income_expense.title` เป็น snapshot ณ วันที่บันทึก

## Supabase / Data Model

### ตารางเดิม `income_expense`

field ที่ต้องปรับ:

- `bill_option`
  - migrate ค่า `บิลน้ำกรด` -> `บิลขาย`
  - mark deleted ข้อมูลเก่าที่เป็น `บิลทั่วไป`
  - mark deleted ข้อมูลเก่าที่เป็น `บิลค่าแรง`
  - mark deleted ข้อมูลเก่าที่เป็น `สูญหาย`
- `transaction_option`
  - ลบออกจาก code
  - drop column ใน migration รอบนี้
- `unit`
  - ใช้เฉพาะ `บิลขาย`
  - สำหรับ `รายรับ` และ `ค่าใช้จ่าย` ให้เป็น `null`
- `price`
  - ใช้เฉพาะ `บิลขาย`
  - สำหรับ `รายรับ` และ `ค่าใช้จ่าย` ให้เป็น `null`
- `cost`
  - `บิลขาย`: คำนวณจาก `unit * price`
  - `รายรับ`: ผู้ใช้กรอกเอง
  - `ค่าใช้จ่าย`: ผู้ใช้กรอกเอง

### ตารางใหม่ `income_sale_items`

สร้างตารางสำหรับ dropdown รายการบิลขาย:

```sql
create table public.income_sale_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true,
  created_by_user_id uuid references public.profiles(id),
  created_by_name text,
  created_by_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by_user_id uuid references public.profiles(id)
);
```

seed เริ่มต้น:

```text
น้ำกรดตราเสือไฟท์
น้ำกรดตรามังกรไฟท์
```

ข้อเสนอ:

- รายการบิลขายเป็น global catalog ใช้ร่วมทุกสาขา
- ไม่ต้องเพิ่ม `location_id` ในรอบนี้

## RLS / Permission

`income_sale_items`:

- `user`: read active items เท่านั้น
- `admin`: read active items เท่านั้น
- `super_admin`: insert/update และปิดใช้งานรายการได้

`income_expense`:

- ใช้ policy เดิมตาม `location_id`
- เพิ่ม validation ฝั่ง UI/backend ว่า `billOption` ต้องอยู่ในชุดที่อนุญาต:
  - income: `รายรับ`, `บิลขาย`
  - expense: `ค่าใช้จ่าย`
- ไม่รับ `transactionOption` จาก form ใหม่

## Backend / Hook

ไฟล์ `src/hooks/useIncomeExpense.ts` ต้องปรับ:

- เลิก map `transaction_option` เข้า UI model หรือทำเป็น optional deprecated
- ตอน save:
  - ไม่ส่ง `transaction_option`
  - ถ้า `billOption === "บิลขาย"` ให้ส่ง `unit`, `price`, `cost`
  - ถ้า `billOption === "รายรับ"` ให้ส่ง `unit: null`, `price: null`, `cost` จาก input รายรับ
  - ถ้า `billOption === "ค่าใช้จ่าย"` ให้ส่ง `unit: null`, `price: null`, `cost` จาก input ค่าใช้จ่าย
- เพิ่ม hook ใหม่:
  - `useIncomeSaleItems()`
  - โหลด active sale items
  - create item เฉพาะ super_admin
  - delete/disable item เฉพาะ super_admin

## TypeScript Types

เพิ่ม/ปรับ type:

```ts
type IncomeBillOption = "รายรับ" | "บิลขาย";
type ExpenseBillOption = "ค่าใช้จ่าย";

type IncomeExpense = {
  billOption: IncomeBillOption | ExpenseBillOption;
  transactionOption?: string; // deprecated, remove after migration
  unit?: string | null;
  price?: number | null;
};

type IncomeSaleItem = {
  id: string;
  name: string;
  isActive: boolean;
  createdByName?: string | null;
  createdByPhone?: string | null;
  createdAt: string;
};
```

## Migration Plan

1. เพิ่มตาราง `income_sale_items`
2. seed ค่าเริ่มต้น 2 รายการ
3. update ข้อมูลเก่า `บิลน้ำกรด` ให้เป็น `บิลขาย`:

```sql
update public.income_expense
set bill_option = 'บิลขาย'
where bill_option = 'บิลน้ำกรด';
```

4. ลบ/ซ่อนข้อมูลเก่าของ option ที่ถูกยกเลิก:

```sql
update public.income_expense
set record_status = 'deleted',
    deleted_at = now(),
    updated_at = now()
where type = 'income' and bill_option = 'บิลทั่วไป';

update public.income_expense
set record_status = 'deleted',
    deleted_at = now(),
    updated_at = now()
where type = 'expense' and bill_option in ('บิลค่าแรง', 'สูญหาย');
```

5. หยุดเขียน `transaction_option` จาก client
6. drop column `transaction_option`
7. อัปเดต `supabase-schema.sql` ให้ตรงกับ migration ล่าสุด

## UI Implementation Steps

1. แยก config ของ form:

```ts
const INCOME_OPTIONS = ["รายรับ", "บิลขาย"] as const;
const EXPENSE_OPTIONS = ["ค่าใช้จ่าย"] as const;
```

2. ลบ section `ช่องทางการรับจ่ายเงิน` ออกจาก `IncomeExpenseModal`
3. เปลี่ยน radio `รูปแบบ` ให้ใช้ option ใหม่
4. เพิ่ม branching UI:
   - income + `บิลขาย`: dropdown + จำนวน + ราคา + รายรับ readOnly
   - income + `รายรับ`: รายการ + รายรับ
   - expense + `ค่าใช้จ่าย`: รายการ + ค่าใช้จ่าย
5. เพิ่ม `IncomeSaleItemsModal`
6. เพิ่มปุ่ม `เพิ่มรายการบิลขาย` ใน action bar เฉพาะ `super_admin`
7. ผูก dropdown กับ `useIncomeSaleItems`
8. ไม่เปลี่ยน layout ตารางรับ-จ่ายเดิม

## Validation

`บิลขาย`:

- ต้องเลือก `รายการ`
- `จำนวน > 0`
- `ราคา >= 0`
- `รายรับ = จำนวน * ราคา`

`รายรับ`:

- ต้องกรอก `รายการ`
- `รายรับ > 0`

`ค่าใช้จ่าย`:

- ต้องกรอก `รายการ`
- `ค่าใช้จ่าย > 0`

รายการบิลขาย:

- ชื่อห้ามว่าง
- ชื่อห้ามซ้ำกับ active item
- ไม่มีราคาตั้งต้น ผู้ใช้กรอกราคาในบิลขายทุกครั้ง
- เฉพาะ `super_admin` เพิ่ม/ปิดใช้งานได้

## Offline/PWA Consideration

- รายรับ/รายจ่ายยังบันทึก offline/optimistic ได้ตามแนวเดิม
- รายการบิลขายควรถูก cache ไว้ใน client เพื่อใช้ dropdown ตอน offline
- การเพิ่ม/ลบรายการบิลขายควรทำแบบ online only ในรอบแรก เพราะเป็น master data และจำกัดเฉพาะ `super_admin`
- ถ้า offline แล้ว catalog sync ไม่ทัน ให้ใช้รายการที่ cache ล่าสุด

## ADR Draft

### ADR-IE-001: เปลี่ยน `บิลน้ำกรด` เป็น `บิลขาย`

เหตุผล: รายรับจากการขายไม่ได้จำกัดแค่น้ำกรดเสมอไป คำว่า `บิลขาย` กว้างกว่าและรองรับสินค้าขายอื่นในอนาคต

ผลกระทบ:

- ต้อง migrate ค่าเก่าใน `income_expense.bill_option`
- UI/table/search จะเห็นคำใหม่
- code ไม่ควร hardcode คำว่า `บิลน้ำกรด` อีก

### ADR-IE-002: ลบ `ช่องทางการรับจ่ายเงิน` จากรายรับ-รายจ่าย

เหตุผล: ผู้ใช้ต้องการลดความซับซ้อนใน form และไม่ต้องแยก `ภายในสาขานี้`/`สำนักงานใหญ่` ในโมดูลนี้แล้ว

ผลกระทบ:

- หยุดเขียน `transaction_option`
- drop column หลังแก้ code ไม่ใช้งานแล้วใน migration รอบนี้

### ADR-IE-003: จัดการรายการขายผ่าน master data เฉพาะ super_admin

เหตุผล: dropdown รายการบิลขายควรควบคุมกลาง ไม่ให้ user/admin สร้างชื่อรายการสะกดต่างกันจนข้อมูลรายงานแตก

ผลกระทบ:

- เพิ่มตาราง `income_sale_items`
- super_admin เท่านั้นที่เพิ่ม/ปิดใช้งานรายการได้
- historical transaction เก็บชื่อรายการเป็น snapshot ใน `income_expense.title`

## คำตอบ Grill ที่ล็อกแล้ว

1. ราคาของบิลขายให้กรอกทุกครั้ง ไม่มีราคาตั้งต้น
2. รายการบิลขายเป็น global ใช้ทุกสาขาเหมือนกัน
3. รายการบิลขายที่ถูกลบให้เปลี่ยนเป็น `ปิดใช้งาน`
4. `transaction_option` ให้ drop column
5. ข้อมูลเก่า option ที่ถูกยกเลิกให้ mark deleted ไม่ migrate เป็นหมวดใหม่ ยกเว้น `บิลน้ำกรด` ที่เปลี่ยนเป็น `บิลขาย`

## ลำดับงานที่แนะนำ

1. เพิ่ม migration `income_sale_items` + seed + migrate `บิลน้ำกรด` เป็น `บิลขาย` + mark deleted option เก่า
2. เพิ่ม type `IncomeSaleItem` และ option constants
3. เพิ่ม hook `useIncomeSaleItems`
4. ปรับ `useIncomeExpense` ให้เลิกเขียน `transaction_option`
5. ปรับ `IncomeExpenseModal` ตาม form branching ใหม่
6. เพิ่ม `IncomeSaleItemsModal` สำหรับ super_admin
7. ทดสอบ create/edit/delete รายรับ `รายรับ`
8. ทดสอบ create/edit/delete รายรับ `บิลขาย`
9. ทดสอบ create/edit/delete รายจ่าย `ค่าใช้จ่าย`
10. ทดสอบสิทธิ์ super_admin/admin/user กับปุ่มจัดการรายการบิลขาย
11. รัน `tsc --noEmit` และ `next build`
