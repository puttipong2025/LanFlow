begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(7);

select extensions.has_function(
  'public',
  'validate_stock_non_negative_after_entry_delete',
  array['uuid', 'uuid', 'uuid[]'],
  'Stock entry deletion exposes a non-negative balance validator'
);

insert into public.locations (id, name, code, is_active)
values ('b1000000-0000-4000-8000-000000000001', 'pgTAP Stock Delete', 'STD', true);

insert into public.profiles (id, phone, name, role, is_active)
values (
  'b2000000-0000-4000-8000-000000000001',
  '0892000001',
  'pgTAP Stock Delete Manager',
  'admin',
  true
);

insert into public.stock_products (id, name, unit, is_active)
values
  ('b3000000-0000-4000-8000-000000000001', 'pgTAP Same-day Stock', 'ถัง', true),
  ('b3000000-0000-4000-8000-000000000002', 'pgTAP Future-negative Stock', 'ถัง', true),
  ('b3000000-0000-4000-8000-000000000003', 'pgTAP Historical-deficit Stock', 'ถัง', true);

insert into public.income_sale_items (id, name, is_active, stock_product_id)
values (
  'b4000000-0000-4000-8000-000000000001',
  'pgTAP Same-day Sale Item',
  true,
  'b3000000-0000-4000-8000-000000000001'
);

insert into public.income_expense (
  id, local_bill_no, server_bill_no, sync_status, record_status,
  location_id, type, number, tx_date, title, cost, bill_option,
  created_by_user_id, created_by_name, created_by_phone, created_at
) values (
  'b5000000-0000-4000-8000-000000000001',
  'LOCAL-2608290002',
  '2608290002',
  'synced',
  'active',
  'b1000000-0000-4000-8000-000000000001',
  'income',
  '1',
  '2026-08-29',
  'บิลขาย — 1 รายการ',
  100,
  'บิลขาย',
  'b2000000-0000-4000-8000-000000000001',
  'pgTAP Stock Delete Manager',
  '0892000001',
  '2026-08-29 08:00:00+07'
);

insert into public.income_expense_sale_lines (
  id, income_expense_id, income_sale_item_id, stock_product_id,
  title, quantity, unit_price, line_total, sequence_no, created_at
) values (
  'b6000000-0000-4000-8000-000000000001',
  'b5000000-0000-4000-8000-000000000001',
  'b4000000-0000-4000-8000-000000000001',
  'b3000000-0000-4000-8000-000000000001',
  'pgTAP Same-day Sale Item',
  1,
  100,
  100,
  1,
  '2026-08-29 08:00:00+07'
);

insert into public.stock_entries (
  id, server_bill_no, tx_date, product_id, product_name, quantity_delta,
  amount, location_id, tx_type, created_by_user_id, created_by_name,
  created_by_phone, created_at
) values
  (
    'b7000000-0000-4000-8000-000000000001', 'AS-260829-0001', '2026-08-29',
    'b3000000-0000-4000-8000-000000000001', 'pgTAP Same-day Stock', 20,
    2000, 'b1000000-0000-4000-8000-000000000001', 'receive',
    'b2000000-0000-4000-8000-000000000001', 'pgTAP Stock Delete Manager',
    '0892000001', '2026-08-29 09:00:00+07'
  ),
  (
    'b7000000-0000-4000-8000-000000000002', 'AS-261012-0001', '2026-10-12',
    'b3000000-0000-4000-8000-000000000001', 'pgTAP Same-day Stock', 150,
    18000, 'b1000000-0000-4000-8000-000000000001', 'receive',
    'b2000000-0000-4000-8000-000000000001', 'pgTAP Stock Delete Manager',
    '0892000001', '2026-10-12 15:24:49+07'
  ),
  (
    'b7000000-0000-4000-8000-000000000003', 'AS-261012-0002', '2026-10-12',
    'b3000000-0000-4000-8000-000000000001', 'pgTAP Same-day Stock', 150,
    18000, 'b1000000-0000-4000-8000-000000000001', 'receive',
    'b2000000-0000-4000-8000-000000000001', 'pgTAP Stock Delete Manager',
    '0892000001', '2026-10-12 15:24:51+07'
  ),
  (
    'b7000000-0000-4000-8000-000000000010', 'STOCK-OPEN', '2026-08-01',
    'b3000000-0000-4000-8000-000000000002', 'pgTAP Future-negative Stock', 5,
    500, 'b1000000-0000-4000-8000-000000000001', 'receive',
    'b2000000-0000-4000-8000-000000000001', 'pgTAP Stock Delete Manager',
    '0892000001', '2026-08-01 08:00:00+07'
  ),
  (
    'b7000000-0000-4000-8000-000000000011', 'STOCK-TARGET', '2026-09-01',
    'b3000000-0000-4000-8000-000000000002', 'pgTAP Future-negative Stock', 5,
    500, 'b1000000-0000-4000-8000-000000000001', 'receive',
    'b2000000-0000-4000-8000-000000000001', 'pgTAP Stock Delete Manager',
    '0892000001', '2026-09-01 08:00:00+07'
  ),
  (
    'b7000000-0000-4000-8000-000000000012', 'STOCK-NEG-SALE', '2026-09-02',
    'b3000000-0000-4000-8000-000000000002', 'pgTAP Future-negative Stock', -8,
    800, 'b1000000-0000-4000-8000-000000000001', 'transfer_out',
    'b2000000-0000-4000-8000-000000000001', 'pgTAP Stock Delete Manager',
    '0892000001', '2026-09-02 08:00:00+07'
  ),
  (
    'b7000000-0000-4000-8000-000000000020', 'OLD-DEFICIT', '2026-08-01',
    'b3000000-0000-4000-8000-000000000003', 'pgTAP Historical-deficit Stock', -2,
    200, 'b1000000-0000-4000-8000-000000000001', 'transfer_out',
    'b2000000-0000-4000-8000-000000000001', 'pgTAP Stock Delete Manager',
    '0892000001', '2026-08-01 08:00:00+07'
  ),
  (
    'b7000000-0000-4000-8000-000000000021', 'OLD-RECOVERY', '2026-08-02',
    'b3000000-0000-4000-8000-000000000003', 'pgTAP Historical-deficit Stock', 2,
    200, 'b1000000-0000-4000-8000-000000000001', 'receive',
    'b2000000-0000-4000-8000-000000000001', 'pgTAP Stock Delete Manager',
    '0892000001', '2026-08-02 08:00:00+07'
  ),
  (
    'b7000000-0000-4000-8000-000000000022', 'LATER-TARGET', '2026-10-12',
    'b3000000-0000-4000-8000-000000000003', 'pgTAP Historical-deficit Stock', 5,
    500, 'b1000000-0000-4000-8000-000000000001', 'receive',
    'b2000000-0000-4000-8000-000000000001', 'pgTAP Stock Delete Manager',
    '0892000001', '2026-10-12 08:00:00+07'
  );

select extensions.is(
  (
    select sum(quantity_delta)
    from public.stock_movements
    where location_id = 'b1000000-0000-4000-8000-000000000001'
      and product_id = 'b3000000-0000-4000-8000-000000000001'
      and not (
        source_type = 'stock_entry'
        and source_id = 'b7000000-0000-4000-8000-000000000002'
      )
  ),
  169::numeric,
  'Deleting one duplicated receipt leaves a positive current balance'
);

select extensions.is(
  public.validate_stock_non_negative_after_entry_delete(
    'b1000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000001',
    array['b7000000-0000-4000-8000-000000000002'::uuid]
  ) ->> 'status',
  'ok',
  'A same-day sale before its receipt does not block deleting a later duplicate receipt'
);

select extensions.is(
  public.validate_stock_non_negative_after_entry_delete(
    'b1000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000001',
    array['b7000000-0000-4000-8000-000000000003'::uuid]
  ) ->> 'status',
  'ok',
  'Either duplicated receipt can be removed while daily balances remain non-negative'
);

select extensions.is(
  public.validate_stock_non_negative_after_entry_delete(
    'b1000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000002',
    array['b7000000-0000-4000-8000-000000000011'::uuid]
  ) ->> 'status',
  'failed',
  'Deleting a receipt is still blocked when a later day would end negative'
);

select extensions.is(
  public.validate_stock_non_negative_after_entry_delete(
    'b1000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000002',
    array['b7000000-0000-4000-8000-000000000011'::uuid]
  ) ->> 'errorMessage',
  'ลบรายการนี้ไม่ได้ เพราะรายการ STOCK-NEG-SALE วันที่ 2026-09-02 จะทำให้สต็อกติดลบ',
  'A genuine future deficit still identifies its first offending day'
);

select extensions.is(
  public.validate_stock_non_negative_after_entry_delete(
    'b1000000-0000-4000-8000-000000000001',
    'b3000000-0000-4000-8000-000000000003',
    array['b7000000-0000-4000-8000-000000000022'::uuid]
  ) ->> 'status',
  'ok',
  'An unchanged historical deficit before the deleted entry does not block deletion'
);

select * from extensions.finish();

rollback;
