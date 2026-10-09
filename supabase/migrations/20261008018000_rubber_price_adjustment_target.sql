-- Store the latest user-entered target that was converted into Rubber Bill item prices.
-- The target is receipt metadata only; the existing v2 price calculation remains authoritative.

alter table public.rubber_bills
  add column price_adjustment_target numeric(14,2) not null default 0,
  add constraint rubber_bills_price_adjustment_target_nonnegative_check
    check (price_adjustment_target >= 0),
  add constraint rubber_bills_branch_price_adjustment_target_check
    check (source_export_no is null or price_adjustment_target = 0);

comment on column public.rubber_bills.price_adjustment_target is
  'Latest user-entered target converted into item prices; receipt metadata only and never added to bill totals.';

alter function private.normalize_rubber_bill_calculation_payload(jsonb)
  rename to normalize_rubber_bill_calculation_payload_before_price_adjustme;

create function private.normalize_rubber_bill_calculation_payload(payload jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_normalized jsonb;
  v_target numeric;
begin
  v_normalized := private.normalize_rubber_bill_calculation_payload_before_price_adjustme(payload);
  if payload->>'operation' not in ('create', 'update') then
    return v_normalized;
  end if;

  begin
    v_target := coalesce(nullif(payload->>'priceAdjustmentTarget', '')::numeric, 0);
  exception when others then
    raise exception 'priceAdjustmentTarget must be non-negative with at most 2 decimal places';
  end;
  if v_target < 0
     or v_target > 999999999999.99
     or v_target <> round(v_target, 2) then
    raise exception 'priceAdjustmentTarget must be non-negative with at most 2 decimal places';
  end if;

  return v_normalized || jsonb_build_object('priceAdjustmentTarget', v_target);
end;
$$;

revoke all on function private.normalize_rubber_bill_calculation_payload(jsonb)
from public, anon, authenticated;

create or replace function private.rubber_bill_submission_fingerprint(p_payload jsonb)
returns text
language sql
set search_path = 'pg_catalog', 'public', 'private', 'extensions'
as $$
  with normalized as (
    select private.normalize_rubber_bill_calculation_payload(p_payload)
      - 'configuredPriceSnapshot' - 'forceNonCurrentDateApproval' - 'submissionMode' as payload
  )
  select encode(
    extensions.digest(
      convert_to((
        case
          when coalesce((payload->>'priceAdjustmentTarget')::numeric, 0) = 0
            then payload - 'priceAdjustmentTarget'
          else payload
        end
      )::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  )
  from normalized
$$;

revoke all on function private.rubber_bill_submission_fingerprint(jsonb)
from public, anon, authenticated;

alter function public.sync_rubber_bill_core_20260725010000(jsonb)
  rename to sync_rubber_bill_core_before_price_adjustment_20261008018000;

create function public.sync_rubber_bill_core_20260725010000(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_normalized jsonb;
  v_result jsonb;
begin
  v_normalized := private.normalize_rubber_bill_calculation_payload(payload);
  v_result := public.sync_rubber_bill_core_before_price_adjustment_20261008018000(v_normalized);
  if v_result->>'status' = 'synced'
     and v_normalized->>'operation' in ('create', 'update') then
    update public.rubber_bills
    set price_adjustment_target = (v_normalized->>'priceAdjustmentTarget')::numeric
    where id = (v_result->>'id')::uuid
      and price_adjustment_target is distinct from (v_normalized->>'priceAdjustmentTarget')::numeric;
  end if;
  return v_result;
end;
$$;

revoke all on function public.sync_rubber_bill_core_20260725010000(jsonb)
from public, anon, authenticated;

create or replace function private.current_rubber_bill_payload(p_bill_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = 'public', 'private'
as $$
  select jsonb_build_object(
    'operation', 'update',
    'expectedRevisionNo', b.revision_no,
    'clientTempId', b.client_temp_id,
    'idempotencyKey', b.idempotency_key,
    'locationId', b.location_id,
    'recordStatus', b.record_status,
    'localBillNo', b.local_bill_no,
    'billDate', b.bill_date,
    'customerId', b.customer_id,
    'customerName', b.customer_name,
    'configuredPriceSnapshot', b.configured_price_snapshot,
    'priceAdjustmentTarget', b.price_adjustment_target,
    'billType', b.bill_type,
    'deductWeight', b.deduct_weight,
    'weight', b.weight,
    'rubberValue', b.rubber_value,
    'averagePrice', b.average_price,
    'deductionTotal', b.deduction_total,
    'netTotal', b.net_total,
    'acidPackCount', b.acid_pack_count,
    'clientRecordedAt', b.client_recorded_at,
    'clientCreatedAt', b.client_created_at,
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'itemType', i.item_type,
          'title', i.description,
          'description', i.description,
          'inWeight', i.weight_in,
          'outWeight', i.weight_out,
          'netWeight', i.net_weight,
          'stockProductId', i.stock_product_id,
          'quantity', i.quantity,
          'unit', i.unit,
          'unitPrice', i.price,
          'totalAmount', i.total,
          'sequenceNo', i.sequence_no
        )
        order by i.sequence_no
      )
      from public.rubber_bill_items i
      where i.bill_id = b.id
    ), '[]'::jsonb)
  )
  from public.rubber_bills b
  where b.id = p_bill_id;
$$;

notify pgrst, 'reload schema';
