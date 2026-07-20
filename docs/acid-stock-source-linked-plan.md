# Product Stock Source-Linked Implementation Plan

This document replaces the earlier standalone Phase 1 decision for Product Stock. The stock module must show both stock-owned rows and rows derived from source modules without duplicating source transactions.

## Goal

Build `สต็อกสินค้า` so stock balance reflects:

- receive / transfer rows created inside Stock
- sales rows from `รับ-จ่าย`
- stock deduction rows from `บิลยาง`

The stock UI may render all of these as table rows, but only stock-owned rows are stored in the stock table. Source rows remain owned by their source modules.

## Recommended Decisions

1. Do not make transaction row IDs equal product IDs.
   Use `product_id` / `stock_product_id` FK to `stock_products.id`.

2. Rename the stored stock table conceptually to `stock_entries`.
   `stock_entries` as a name is ambiguous once the UI also shows derived rows.

3. Create a complete stock read model.
   Use a SQL view or RPC named like `stock_movements` to union all movement sources.

4. Only stock-owned rows can be edited/deleted in the stock module.
   Derived rows show a lock reason and open the source module.

5. Balance must sum the read model.
   `SUM(quantity_delta)` over `stock_movements`, not just `stock_entries`.

6. Stock-affecting writes are online-only by default.
   Current source modules are offline-first, but stock-linked rows need server balance validation and must be blocked while offline.

7. Keep sales catalog and stock product catalog separate.
   `income_sale_items.stock_product_id` maps sale dropdown rows to `stock_products.id`.

8. Rubber bill stock deductions must choose from stock products.
   No free-text deduction item is allowed for stock-affecting `item_type = 'acid'` rows.

## Proposed Schema Changes

### `stock_products`

Keep as stock product master.

```sql
create table public.stock_products (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  unit text not null default 'ถัง',
  is_active boolean not null default true,
  created_by_user_id uuid references public.profiles(id),
  created_by_name text,
  created_by_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### `stock_entries`

Stores stock-owned movements only.

```sql
create table public.stock_entries (
  id uuid primary key default gen_random_uuid(),
  server_bill_no text,
  tx_date date not null,
  product_id uuid not null references public.stock_products(id),
  product_name text not null,
  quantity_delta numeric(12,2) not null,
  amount numeric(12,2) default 0,
  location_id uuid not null references public.locations(id),
  tx_type text not null,
  transfer_bill_no text,
  record_status record_status not null default 'active',
  created_by_user_id uuid not null references public.profiles(id),
  created_by_name text not null,
  created_by_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by_name text,
  deleted_by_phone text
);
```

`tx_type` should start with:

```text
receive
transfer_out
transfer_in
```

### `income_expense`

Add stock fields for sale rows. Keep the `income_sale_items` table as the Income/Expense sales catalog, but add an FK mapping to stock products.

```sql
alter table public.income_sale_items
  add column stock_product_id uuid references public.stock_products(id);
```

The `บิลขาย` dropdown must query only active rows where `stock_product_id is not null`.

Then add snapshot fields to `income_expense` so historical sale rows keep the product relationship that was valid when the bill was created.

```sql
alter table public.income_expense
  add column income_sale_item_id uuid references public.income_sale_items(id),
  add column stock_product_id uuid references public.stock_products(id),
  add column stock_quantity numeric(12,2);
```

Rules:

- `stock_product_id` is required for every saved `บิลขาย` row.
- `income_sale_item_id` records the sale catalog row chosen in the dropdown.
- `stock_quantity` is the product quantity deducted from stock.
- `title` remains a display snapshot.
- Existing `unit` can remain for compatibility, but stock balance should use `stock_quantity`.

### `rubber_bill_items`

Add product FK for stock deduction items.

```sql
alter table public.rubber_bill_items
  add column stock_product_id uuid references public.stock_products(id);
```

Rules:

- `item_type = 'acid'` rows must have `stock_product_id`.
- The rubber bill UI must select deduction products from `stock_products`; no free-text product names.
- `quantity` is the quantity deducted from stock.
- `description` remains a display snapshot.

## Stock Movement Mapping

| Source | Source row | Condition | Quantity delta | Editable from Stock |
|---|---|---|---:|---|
| Stock receive | `stock_entries` | `tx_type = 'receive'` and active | `+quantity_delta` | Yes, through stock approval flow |
| Stock transfer out | `stock_entries` | `tx_type = 'transfer_out'` and active | negative | Yes, but transfer pair must stay consistent |
| Stock transfer in | `stock_entries` | `tx_type = 'transfer_in'` and active | positive | Yes, but transfer pair must stay consistent |
| Sale bill | `income_expense` | active income, `bill_option = 'บิลขาย'`, required `stock_product_id` | `-stock_quantity` | No |
| Rubber bill stock deduction | `rubber_bills` + `rubber_bill_items` | active bill, `item_type = 'acid'`, required `stock_product_id` | `-quantity` | No |

## Read Model Shape

`stock_movements` should return a uniform row shape:

```text
movement_id
source_type
source_id
source_line_id
tx_date
location_id
product_id
product_name
quantity_delta
amount
display_bill_no
created_by_user_id
created_by_name
created_by_phone
created_at
relation_lock_reason
```

Suggested `source_type` values:

```text
stock_entry
income_sale
rubber_bill_acid
```

Derived row IDs can be stable composite IDs:

```text
stock-entry:<stock_entries.id>
income-sale:<income_expense.id>
rubber-bill-acid:<rubber_bill_items.id>
```

## RPC / API Plan

### Stock module

- `sync_stock_entry(payload jsonb)`
  - receive stock
  - future adjustment, if allowed
  - creates server bill number

- `transfer_stock(payload jsonb)`
  - locks source and target product/location pairs
  - validates source balance against all movements
  - creates transfer out and transfer in rows in one transaction

- `get_stock_balance(p_location_id uuid, p_product_id uuid)`
  - sums `stock_movements`

### Source modules

Update `sync_income_expense(payload jsonb)`:

- accept `incomeSaleItemId`, `stockProductId`, and `stockQuantity`
- validate that `incomeSaleItemId` maps to the same `stockProductId`
- validate stock for `บิลขาย` rows before create/update
- on update, compare old stock delta vs new stock delta
- on delete, release stock by removing the active source movement

Update `sync_rubber_bill(payload jsonb)`:

- accept `stockProductId` for acid items
- validate all stock-linked acid item quantities before create/update
- on update, replace child items only after stock delta validation
- on delete, release stock by marking the bill deleted

Use advisory lock per product-location pair for stock-affecting writes:

```text
hash(location_id || ':' || product_id)
```

## UI Plan

### Stock table

Show both stored and derived rows. Include a source badge:

- `รับเข้า`
- `ย้ายออก`
- `ย้ายเข้า`
- `ขายจากรับ-จ่าย`
- `หักจากบิลยาง`

Actions:

- stock-owned row: request delete / edit according to stock rules
- derived row: disabled edit/delete with reason, plus action to open source if permitted

### Income/Expense modal

For `บิลขาย`:

- product dropdown must show only active `income_sale_items` with `stock_product_id is not null`
- each option should carry `incomeSaleItemId` and `stockProductId`, not only product name
- quantity should write `stockQuantity`
- if browser is offline, block save with Thai message because every `บิลขาย` row affects stock

### Rubber Bill modal

For `หักสินค้า` rows:

- use dropdown from active `stock_products`
- do not allow free-text product names
- if browser is offline, block save with Thai message because every stock deduction affects stock

## Locked Grill Decisions

1. `บิลขาย` dropdown can select only `income_sale_items` rows mapped to `stock_products`.
2. Keep `income_sale_items` and `stock_products` separate, with `income_sale_items.stock_product_id -> stock_products.id`.
3. Rubber bill stock deductions must choose from stock products.
4. Offline stock-affecting sale/deduction is blocked immediately.

## Remaining Grill Questions

1. Are `น้ำกรดตราเสือไฟท์` and `น้ำกรดตรามังกรไฟท์` the only stock products for Phase 1?
2. Should historical `income_expense` and `rubber_bill_items` rows be backfilled into stock, or should stock start counting from launch?
3. If deleting a stock transfer, should one approval delete both transfer pair rows together?

## Verification Plan

Automated:

```powershell
npx.cmd tsc --noEmit
npm run build
npx.cmd supabase db reset
```

Manual:

- Receive stock and confirm balance increases.
- Create `บิลขาย` with stock product and confirm balance decreases.
- Create rubber bill stock deduction and confirm balance decreases.
- Edit a sale quantity upward and confirm server blocks when balance is insufficient.
- Delete/source-soft-delete a sale row and confirm stock balance returns.
- Confirm derived rows cannot be edited/deleted from stock.
- Confirm source-open action respects location permission.
- Confirm offline save is blocked for `บิลขาย` and rubber bill stock deductions.
