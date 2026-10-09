begin;

create extension if not exists pgtap with schema extensions;
select extensions.plan(18);

select extensions.ok(
  to_regprocedure('private.normalize_rubber_bill_calculation_payload_before_price_adjustme(jsonb)') is null,
  'superseded two-decimal Rubber Bill normalizer is removed'
);

select extensions.has_column(
  'public', 'rubber_bills', 'price_adjustment_target',
  'rubber bills store the latest price-adjustment target'
);
select extensions.col_not_null(
  'public', 'rubber_bills', 'price_adjustment_target',
  'price-adjustment target cannot be null'
);
select extensions.col_default_is(
  'public', 'rubber_bills', 'price_adjustment_target', '0',
  'legacy rubber bills default the price-adjustment target to zero'
);
select extensions.ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.rubber_bills'::regclass
      and conname = 'rubber_bills_branch_price_adjustment_target_check'
  ),
  'branch receipts constrain the target to zero'
);
select extensions.col_type_is(
  'public', 'rubber_bill_items', 'price', 'numeric(15,5)',
  'rubber weigh-row prices persist five decimal places'
);

create temporary table normalized_adjustment_payload as
select private.normalize_rubber_bill_calculation_payload(jsonb_build_object(
  'operation', 'create',
  'deductWeight', 0,
  'items', jsonb_build_array(
    jsonb_build_object('itemType', 'weigh', 'netWeight', 100, 'unitPrice', 20)
  )
)) payload;

select extensions.is(
  (select (payload->>'priceAdjustmentTarget')::numeric from normalized_adjustment_payload),
  0::numeric,
  'missing target normalizes to zero'
);
select extensions.throws_ok(
  $$select private.normalize_rubber_bill_calculation_payload(
    '{"operation":"create","priceAdjustmentTarget":1.001,"deductWeight":0,"items":[{"itemType":"weigh","netWeight":100,"unitPrice":20}]}'::jsonb
  )$$,
  'P0001',
  'priceAdjustmentTarget must be non-negative with at most 2 decimal places',
  'target precision beyond hundredths is rejected'
);
select extensions.is(
  (private.normalize_rubber_bill_calculation_payload(
    '{"operation":"create","deductWeight":0,"items":[{"itemType":"weigh","netWeight":100000,"unitPrice":20.12345}]}'::jsonb
  )->>'rubberValue')::numeric,
  2012345::numeric,
  'server formula uses all five weigh-price decimals'
);
select extensions.throws_ok(
  $$select private.normalize_rubber_bill_calculation_payload(
    '{"operation":"create","deductWeight":0,"items":[{"itemType":"weigh","netWeight":100,"unitPrice":20.123456}]}'::jsonb
  )$$,
  'P0001',
  'weigh-row price must be non-negative with at most 5 decimal places',
  'a sixth weigh-price decimal is rejected'
);
select extensions.is(
  private.rubber_bill_submission_fingerprint(
    '{"operation":"delete","clientTempId":"legacy"}'::jsonb
  ),
  private.rubber_bill_submission_fingerprint(
    '{"operation":"delete","clientTempId":"legacy","priceAdjustmentTarget":0}'::jsonb
  ),
  'legacy missing target and zero have the same fingerprint'
);
select extensions.isnt(
  private.rubber_bill_submission_fingerprint(
    '{"operation":"delete","clientTempId":"adjusted","priceAdjustmentTarget":1000}'::jsonb
  ),
  private.rubber_bill_submission_fingerprint(
    '{"operation":"delete","clientTempId":"adjusted","priceAdjustmentTarget":500}'::jsonb
  ),
  'positive target changes participate in the fingerprint'
);

insert into public.locations(id, name, code, is_active)
values ('7d000000-0000-4000-8000-000000000001', 'Price Adjustment Branch', 'PAB1', true);
insert into public.profiles(id, phone, name, role, is_active, can_access_super_admin_features)
values ('7e000000-0000-4000-8000-000000000001', '0897001801', 'Price Adjustment User', 'admin', true, true);
insert into public.user_locations(user_id, location_id, is_primary)
values ('7e000000-0000-4000-8000-000000000001', '7d000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.sub', '7e000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"7e000000-0000-4000-8000-000000000001","role":"authenticated"}', true);

create temporary table adjustment_payload as
select jsonb_build_object(
  'operation', 'create',
  'formulaVersion', 2,
  'expectedRevisionNo', 0,
  'clientTempId', 'price-adjustment-target-bill',
  'idempotencyKey', 'create:price-adjustment-target-bill:0',
  'locationId', '7d000000-0000-4000-8000-000000000001',
  'recordStatus', 'active',
  'localBillNo', 'PAB1-R-001',
  'billDate', '2026-10-08',
  'customerName', 'Price Adjustment Customer',
  'billType', 'บิลเครื่องชั่งเล็ก',
  'deductWeight', 0,
  'priceAdjustmentTarget', 1000,
  'acidPackCount', 0,
  'clientRecordedAt', '2026-10-08T03:00:00Z',
  'clientCreatedAt', '2026-10-08T03:00:00Z',
  'items', jsonb_build_array(jsonb_build_object(
    'itemType', 'weigh', 'title', 'ชั่ง1', 'description', 'ชั่ง1',
    'inWeight', 100, 'outWeight', 0, 'netWeight', 100,
    'unitPrice', 30.00001, 'totalAmount', 3000, 'sequenceNo', 1
  ))
) payload;

create temporary table adjustment_sync_result as
select public.sync_rubber_bill_core_20260725010000(payload) result
from adjustment_payload;

select extensions.is(
  (select result->>'status' from adjustment_sync_result),
  'synced',
  'core write succeeds with target metadata'
);
select extensions.is(
  (select price_adjustment_target from public.rubber_bills where client_temp_id = 'price-adjustment-target-bill'),
  1000.00::numeric,
  'core write persists target metadata without a second bill formula'
);
select extensions.is(
  (select price from public.rubber_bill_items i
   join public.rubber_bills b on b.id = i.bill_id
   where b.client_temp_id = 'price-adjustment-target-bill' and i.item_type = 'weigh'),
  30.00001::numeric,
  'core write preserves all five weigh-price decimals'
);
select extensions.is(
  (select (private.current_rubber_bill_payload(id)->>'priceAdjustmentTarget')::numeric
   from public.rubber_bills where client_temp_id = 'price-adjustment-target-bill'),
  1000.00::numeric,
  'current payload returns the stored target for approval and replay'
);

create temporary table adjustment_update_counter (count integer not null default 0);
insert into adjustment_update_counter default values;
create function pg_temp.count_adjustment_bill_updates()
returns trigger
language plpgsql
as $$
begin
  update adjustment_update_counter set count = count + 1;
  return new;
end;
$$;
create trigger count_adjustment_bill_updates
after update on public.rubber_bills
for each row execute function pg_temp.count_adjustment_bill_updates();

create temporary table adjustment_replay_result as
select public.sync_rubber_bill_core_20260725010000(payload) result
from adjustment_payload;
select extensions.is(
  (select result->>'status' from adjustment_replay_result),
  'synced',
  'an exact target replay remains idempotently synced'
);
select extensions.is(
  (select count from adjustment_update_counter),
  0,
  'an exact target replay does not update the persisted bill again'
);
drop trigger count_adjustment_bill_updates on public.rubber_bills;

select * from extensions.finish();
rollback;
