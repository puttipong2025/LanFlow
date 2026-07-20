# Product Stock Domain Glossary

## Product Terms

`stock_products`

Stock product master. This is the product identity used by stock, sales, and rubber bill stock deductions.

`product_id`

The FK used inside stock-owned rows. Points to `stock_products.id`.

`stock_product_id`

The FK used inside source modules when a source row affects stock. Points to `stock_products.id`.

`income_sale_items.stock_product_id`

Mapping from Income/Expense sales catalog rows to stock products. The `บิลขาย` dropdown only shows active sale items where this FK is present.

`income_sale_item_id`

The FK stored on an `income_expense` sale row to record which sale catalog item was selected.

`product_name`

Display snapshot at the time of the transaction. Useful for history, but not a relationship.

## Movement Terms

`stock_entries`

Stored rows owned by the stock module, such as receive and transfer rows.

`stock_movements`

Read model that combines stock-owned rows and derived source rows into one ledger for the stock UI.

`stock-owned row`

A row created by the stock module itself. It can be managed by stock workflows.

`derived row`

A row displayed in the stock module but computed from another source module. It is not copied into the stock table.

`source module`

The module that owns the original business record. For this feature: `รับ-จ่าย` and `บิลยาง`.

`source row`

The original parent transaction row, such as an `income_expense` row or a `rubber_bills` row.

`source line`

A child or line-level row that carries the product movement, such as `rubber_bill_items.id`.

`source_type`

A label describing where the movement came from, for example `stock_entry`, `income_sale`, or `rubber_bill_acid`.

`source_id`

The parent source row ID.

`source_line_id`

The line row ID when the stock movement comes from a child item. For `income_expense`, this may be null because each saved sale line is already its own row.

`quantity_delta`

Signed quantity used by balance calculation.

Examples:

```text
receive: +10
transfer_out: -3
transfer_in: +3
income_sale: -2
rubber_bill_acid: -1
```

## Balance Terms

`stock balance`

The sum of all active `quantity_delta` rows for one product and one location.

`server-confirmed balance`

Balance calculated by the database from synced rows. Offline pending rows are not trusted as final stock unless a later decision explicitly supports stock conflicts.

`product-location lock`

A server-side advisory lock used when writing any row that affects one product at one location.

## Relation Terms

`relation lock`

The UI/server rule that prevents editing a derived row from the stock module. The user must edit the source row instead.

`open source action`

Button/action from Stock that opens the source module record or filtered source list, if the user has permission.

`snapshot`

Human-readable copied text such as product name, creator name, or display bill number. A snapshot is for history and display, not for relational integrity.

## Source-Specific Terms

`income_sale`

Stock movement derived from an `income_expense` row where `bill_option = 'บิลขาย'` and `stock_product_id` is present.

`rubber_bill_acid`

Stock movement derived from a `rubber_bill_items` row where `item_type = 'acid'` and `stock_product_id` is present.

`stock_entry`

Movement created directly in the stock module.
