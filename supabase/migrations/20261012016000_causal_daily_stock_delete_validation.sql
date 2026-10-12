-- Validate stock-entry deletion against causal end-of-day deficits.
-- Movements carry a business date, not a trustworthy within-day sequence, so
-- same-day receipts and deductions must be evaluated together. Historical
-- deficits that are unchanged by the proposed deletion do not block it.

create or replace function public.validate_stock_non_negative_after_entry_delete(
  p_location_id uuid,
  p_product_id uuid,
  p_deleted_entry_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_offending_day record;
begin
  with daily_movements as (
    select
      movement.tx_date,
      sum(coalesce(movement.quantity_delta, 0)) as actual_delta,
      sum(
        case
          when movement.source_type = 'stock_entry'
            and movement.source_id = any(p_deleted_entry_ids)
          then 0
          else coalesce(movement.quantity_delta, 0)
        end
      ) as remaining_delta,
      (
        array_agg(
          coalesce(movement.display_bill_no, movement.movement_id)
          order by
            case
              when not (
                movement.source_type = 'stock_entry'
                and movement.source_id = any(p_deleted_entry_ids)
              ) and movement.quantity_delta < 0 then 0
              when not (
                movement.source_type = 'stock_entry'
                and movement.source_id = any(p_deleted_entry_ids)
              ) then 1
              else 2
            end,
            movement.movement_id
        )
      )[1] as display_bill_no
    from public.stock_movements movement
    where movement.location_id = p_location_id
      and movement.product_id = p_product_id
    group by movement.tx_date
  ), daily_balances as (
    select
      daily.tx_date,
      daily.display_bill_no,
      sum(daily.actual_delta) over (
        order by daily.tx_date
        rows between unbounded preceding and current row
      ) as actual_balance,
      sum(daily.remaining_delta) over (
        order by daily.tx_date
        rows between unbounded preceding and current row
      ) as remaining_balance
    from daily_movements daily
  )
  select
    balance.tx_date,
    balance.display_bill_no,
    balance.actual_balance,
    balance.remaining_balance
  into v_offending_day
  from daily_balances balance
  where balance.remaining_balance < -0.000001
    and balance.remaining_balance < balance.actual_balance - 0.000001
  order by balance.tx_date
  limit 1;

  if v_offending_day.tx_date is not null then
    return jsonb_build_object(
      'status', 'failed',
      'errorMessage',
        'ลบรายการนี้ไม่ได้ เพราะรายการ '
        || coalesce(v_offending_day.display_bill_no, 'ไม่ทราบเลขที่')
        || ' วันที่ '
        || v_offending_day.tx_date::text
        || ' จะทำให้สต็อกติดลบ'
    );
  end if;

  return jsonb_build_object('status', 'ok');
end;
$$;

revoke all on function public.validate_stock_non_negative_after_entry_delete(uuid, uuid, uuid[])
  from public, anon, authenticated;
