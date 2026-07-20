# ADR-0003: Product Stock Uses Source-Linked Movements Instead Of Copying Source Rows

- Status: Proposed
- Date: 2026-07-08
- Owners: LanFlow team
- Decision scope: Product stock, income/expense sales bills, rubber bill stock deductions, balance calculation, relation lock

## Context

The first Product Stock plan treated `stock_entries` as a standalone movement table in Phase 1. The new requirement changes that: stock must also show movements caused by other modules, especially:

- `income_expense` rows where `bill_option = 'บิลขาย'` and the sold product is a stock product
- `rubber_bill_items` rows where `item_type = 'acid'` and the deducted product is a stock product

The stock module must reflect those quantities without creating duplicate transaction rows in `stock_entries`.

Current source modules do not yet store a reliable stock product key:

- Income/Expense sales bills currently store the selected sale item name in `income_expense.title`.
- Rubber bill stock deductions currently store the deducted item name in `rubber_bill_items.description`.

Name matching is not a safe relationship. A real relationship must use a foreign key to the stock product.

## Decision

Use one stock product identity and derive stock movements from source rows.

### 1. Product identity

`stock_products.id` is the product identity for stockable products.

`income_sale_items` remains a separate sales catalog for the Income/Expense module. It maps to stock products with a FK:

```text
income_sale_items.stock_product_id -> stock_products.id
```

Source rows must not try to make their own row ID equal to a stock row ID. Instead, they store a nullable FK such as:

```text
income_sale_items.stock_product_id -> stock_products.id
income_expense.stock_product_id -> stock_products.id
rubber_bill_items.stock_product_id -> stock_products.id
stock_entries.product_id -> stock_products.id
```

Only rows with a non-null `stock_product_id` affect stock. For `บิลขาย`, the dropdown must show only active `income_sale_items` that already map to `stock_products`.

### 2. Stock-owned rows

The stock module owns only movements that are created in the stock module itself:

- receive stock
- transfer out
- transfer in
- manual adjustment, if later approved as a feature

These rows live in the stock table, named in this ADR as `stock_entries` to distinguish stored stock-owned rows from the complete read model.

### 3. Derived source movements

The complete stock table shown in the UI is a read model that unions:

- stock-owned rows from `stock_entries`
- sale deductions from `income_expense`
- rubber bill stock deductions from `rubber_bills` + `rubber_bill_items`

This can be implemented as a SQL view, RPC result, or query builder, but the domain shape must include:

```text
movement_id
source_type
source_id
source_line_id
location_id
product_id
tx_date
quantity_delta
amount
display_bill_no
created_by_name
relation_lock_reason
```

Derived rows are locked in the stock module. They can be opened from stock, but edited or deleted only from their source module.

### 4. Balance calculation

Stock balance is the sum of all active movement rows from the complete read model:

```text
balance = sum(quantity_delta)
where location_id = X
and product_id = Y
and source record is active
```

`get_stock_balance` must sum the read model, not only the stock-owned table.

### 5. Write enforcement

Any operation that can reduce stock must validate balance on the server, under a product-location lock:

- stock transfer out
- income sale row create/update/delete when `stock_product_id` is present
- rubber bill create/update/delete when an acid item has `stock_product_id`

The existing `sync_income_expense` and `sync_rubber_bill` RPCs must be updated to validate stock-affecting payloads before commit. UI checks are helpful but not authoritative.

### 6. Offline behavior

Stock-affecting source rows are online-only.

- Non-stock income/expense and rubber bill rows can keep current offline-first behavior.
- Rows with `stock_product_id` must be blocked immediately while offline.

This keeps the stock balance server-confirmed and avoids silent negative stock.

## Consequences

### Positive

- No duplicated business transactions in `stock_entries`.
- Stock rows change automatically when source modules edit/delete their own records.
- The UI can show one stock ledger while preserving clear ownership.
- Product relation is real because it uses FK, not item name matching.
- Balance includes all stock effects, not only manual stock entries.

### Negative

- The source modules must change before stock can be correct.
- Income/Expense and Rubber Bills need new stock-aware payload fields and RPC validation.
- Existing historical rows without product IDs cannot affect stock unless backfilled or manually mapped.
- Offline-first behavior becomes stricter for stock-linked line items because they must be blocked while offline.

## Alternatives Considered

### Copy source rows into `stock_entries`

Rejected. It creates duplicate records and requires sync/cascade logic whenever source rows are edited or deleted.

### Match by product name

Rejected. Names can change, contain typos, or be reused. Stock correctness needs a product FK.

### Make source row ID equal stock product ID

Rejected. A transaction row ID identifies the transaction, while product ID identifies the item. Collapsing them makes updates, multiple lines, and audit history hard to reason about.

### Keep Phase 1 standalone

Rejected for the current requirement. It would show stock module rows but not reflect sales and rubber bill deductions.

## Locked Grill Decisions

1. `บิลขาย` can select only sale catalog rows mapped to `stock_products`.
2. Keep `income_sale_items` and `stock_products` as separate tables. Use `income_sale_items.stock_product_id` as the FK mapping to `stock_products.id`.
3. Rubber bill stock deductions must choose from stock products; free-text deduction items are not allowed.
4. If offline, stock-affecting sale/deduction rows are blocked immediately.

## Decision Gates Still Open

1. Are `น้ำกรดตราเสือไฟท์` and `น้ำกรดตรามังกรไฟท์` the only stock products for Phase 1?
2. Should historical source rows be backfilled into stock, or should stock start counting from the feature launch date only?
3. If deleting a stock transfer, should one approval delete both transfer pair rows together?
