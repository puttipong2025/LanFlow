-- Extend the cached Dashboard summary with daily cash movement and remaining
-- customer rubber-bill aggregates. OCR tickets are intentionally excluded
-- from every Dashboard/Header summary aggregate.

create or replace function private.calculate_dashboard_summary(p_location_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select
      (current_timestamp at time zone 'Asia/Bangkok')::date as today,
      (current_timestamp at time zone 'Asia/Bangkok')::date - 6 as from_date
  ),
  active_bills as (
    select b.*
    from public.rubber_bills b
    where b.location_id = p_location_id
      and b.record_status = 'active'
  ),
  customer_bill_facts as (
    select
      b.*,
      (
        exists (
          select 1
          from public.rubber_bill_items i
          where i.bill_id = b.id
            and i.item_type = 'weigh'
        )
        and not exists (
          select 1
          from public.rubber_bill_items i
          where i.bill_id = b.id
            and i.item_type = 'weigh'
            and coalesce(i.price, 0) <= 0
        )
      ) as has_price,
      private.rubber_bill_has_pending_approval(b.id) as has_pending_approval,
      exists (
        select 1
        from public.rubber_export_items i
        join public.rubber_exports e on e.id = i.export_id
        where i.source_bill_id = b.id
          and e.status = 'verified'
      ) as has_verified_export
    from active_bills b
    where b.source_rubber_export_id is null
  ),
  payable_bills as (
    select b.*
    from customer_bill_facts b
    where private.rubber_bill_is_payable(b.id)
      and not b.has_pending_approval
  ),
  today_rubber as (
    select
      count(*) as bill_count,
      coalesce(sum(b.net_weight), 0) as net_weight,
      coalesce(sum(b.net_weight) filter (
        where b.has_price and b.net_weight > 0
      ), 0) as priced_net_weight,
      coalesce(sum(b.rubber_value) filter (where b.has_price), 0) as rubber_value,
      coalesce(sum(b.deduction_total), 0) as deduction_total,
      count(*) filter (where not b.has_price) as unpriced_bill_count,
      count(*) filter (where b.has_pending_approval) as pending_approval_count,
      coalesce(sum(b.net_total) filter (
        where private.rubber_bill_is_payable(b.id)
          and not b.has_pending_approval
      ), 0) as paid_total
    from customer_bill_facts b
    cross join bounds d
    where b.bill_date = d.today
  ),
  remaining_rubber as (
    select
      count(*) as bill_count,
      coalesce(sum(b.net_weight), 0) as net_weight,
      coalesce(sum(b.net_weight) filter (
        where b.has_price and b.net_weight > 0
      ), 0) as priced_net_weight,
      coalesce(sum(b.rubber_value) filter (where b.has_price), 0) as rubber_value,
      coalesce(sum(b.deduction_total), 0) as deduction_total,
      count(*) filter (where not b.has_price) as unpriced_bill_count,
      count(*) filter (where b.has_pending_approval) as pending_approval_count
    from customer_bill_facts b
    where not b.has_verified_export
  ),
  seven_day_purchase as (
    select
      coalesce(sum(b.net_weight), 0) as net_weight,
      coalesce(sum(b.net_total), 0) as paid_total
    from payable_bills b
    cross join bounds d
    where b.bill_date between d.from_date and d.today
  ),
  inventory_stats as (
    select coalesce(sum(b.net_weight), 0) as accumulated_net_weight
    from active_bills b
  ),
  payable_total as (
    select coalesce(sum(b.net_total), 0) as accumulated_purchase
    from payable_bills b
  ),
  export_stats as (
    select
      coalesce(sum(e.original_weight_total) filter (where e.status = 'verified'), 0)
        as accumulated_original_weight,
      count(*) filter (
        where e.status = 'verified'
          and (e.verified_at at time zone 'Asia/Bangkok')::date
            between d.from_date and d.today
      ) as seven_day_export_count,
      coalesce(sum(e.original_weight_total - e.current_weight) filter (
        where e.status = 'verified'
          and (e.verified_at at time zone 'Asia/Bangkok')::date
            between d.from_date and d.today
      ), 0) as seven_day_loss_weight,
      coalesce(sum(e.original_weight_total) filter (
        where e.status = 'verified'
          and (e.verified_at at time zone 'Asia/Bangkok')::date
            between d.from_date and d.today
      ), 0) as seven_day_original_weight
    from public.rubber_exports e
    cross join bounds d
    where e.location_id = p_location_id
  ),
  stock_balances as (
    select
      p.id,
      p.name,
      p.unit,
      round(coalesce(sum(m.quantity_delta), 0), 2) as balance
    from public.stock_products p
    left join public.stock_movements m
      on m.product_id = p.id
     and m.location_id = p_location_id
    where p.is_active = true
    group by p.id, p.name, p.unit
  ),
  stock_summary as (
    select
      count(*) filter (where balance > 0) as in_stock_count,
      count(*) filter (where balance <= 0) as out_of_stock_count,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'productId', id,
            'name', name,
            'unit', unit,
            'balance', balance
          )
          order by (balance <= 0) desc, name, id
        ),
        '[]'::jsonb
      ) as items
    from stock_balances
  ),
  financial_amounts as (
    select
      ie.type::text as direction,
      ie.cost as amount,
      true as affects_balance,
      ie.type = 'expense' as operating_expense,
      ie.tx_date as business_date
    from public.income_expense ie
    where ie.location_id = p_location_id
      and ie.record_status = 'active'
      and ie.cost > 0

    union all

    select 'income', mt.net_amount_to_pay, true, false,
      (mt.created_at at time zone 'Asia/Bangkok')::date
    from public.money_transfers mt
    where mt.transfer_type = 'branch'
      and coalesce(mt.transfer_method, 'bank') <> 'cash'
      and mt.target_location_id = p_location_id
      and mt.record_status <> 'deleted'
      and mt.transfer_status in ('paid', 'overpaid', 'branch_and_transfer')
      and mt.net_amount_to_pay > 0

    union all

    select 'expense', mt.net_amount_to_pay, true, false,
      (mt.created_at at time zone 'Asia/Bangkok')::date
    from public.money_transfers mt
    where mt.transfer_type = 'branch'
      and coalesce(mt.transfer_method, 'bank') <> 'cash'
      and mt.location_id = p_location_id
      and mt.target_location_id <> mt.location_id
      and mt.record_status <> 'deleted'
      and mt.transfer_status in ('paid', 'overpaid', 'branch_and_transfer')
      and mt.net_amount_to_pay > 0

    union all

    select 'expense', mt.branch_paid_amount, true, false,
      (mt.created_at at time zone 'Asia/Bangkok')::date
    from public.money_transfers mt
    where mt.transfer_type = 'customer'
      and mt.transfer_status = 'branch_and_transfer'
      and mt.location_id = p_location_id
      and mt.record_status <> 'deleted'
      and mt.branch_paid_amount > 0

    union all

    select 'expense', d.sent_total, true, false,
      (d.sent_at at time zone 'Asia/Bangkok')::date
    from public.money_transfers mt
    join public.money_transfer_cash_details d on d.transfer_id = mt.id
    where mt.transfer_type = 'cash'
      and mt.transfer_method = 'cash'
      and mt.location_id = p_location_id
      and mt.record_status <> 'deleted'
      and d.sent_total > 0

    union all

    select 'income', d.received_total, true, false,
      (d.received_at at time zone 'Asia/Bangkok')::date
    from public.money_transfers mt
    join public.money_transfer_cash_details d on d.transfer_id = mt.id
    where mt.transfer_type = 'cash'
      and mt.transfer_method = 'cash'
      and mt.target_location_id = p_location_id
      and mt.record_status <> 'deleted'
      and d.cash_status in ('received', 'mismatched', 'difference_accepted')
      and d.received_total > 0

    union all

    select 'expense', ft.amount, true, true,
      (ft.approved_at at time zone 'Asia/Bangkok')::date
    from public.financial_transactions ft
    where ft.type = 'WITHDRAWAL'
      and ft.status = 'APPROVED'
      and ft.cancelled_at is null
      and ft.expense_location_id = p_location_id
      and ft.amount > 0

    union all

    select 'expense', ps.net_pay, true, true,
      (ps.approved_at at time zone 'Asia/Bangkok')::date
    from public.payroll_slips ps
    where ps.status = 'APPROVED'
      and ps.cancelled_at is null
      and ps.expense_location_id = p_location_id
      and ps.net_pay > 0

    union all

    select
      'expense',
      b.net_total,
      not exists (
        select 1
        from public.money_transfer_items i
        where i.source_type = 'rubber_bill'
          and i.source_id = b.id
      ),
      false,
      b.bill_date
    from payable_bills b

    union all

    select 'expense', e.work_total, true, true,
      (e.verified_at at time zone 'Asia/Bangkok')::date
    from public.rubber_exports e
    where e.location_id = p_location_id
      and e.status = 'verified'
      and e.expense_destination = 'branch'
      and e.work_total > 0
  ),
  financial_totals as (
    select
      coalesce(sum(
        case
          when not f.affects_balance then 0
          when f.direction = 'income' then f.amount
          else -f.amount
        end
      ), 0) as net_cash_flow,
      coalesce(sum(f.amount) filter (
        where f.affects_balance
          and f.direction = 'income'
          and f.business_date = d.today
      ), 0) as today_income,
      coalesce(sum(f.amount) filter (
        where f.affects_balance
          and f.direction = 'expense'
          and f.business_date = d.today
      ), 0) as today_expense,
      coalesce(sum(f.amount) filter (where f.operating_expense), 0)
        as operating_expense
    from financial_amounts f
    cross join bounds d
  )
  select jsonb_build_object(
    'purchaseToday', jsonb_build_object(
      'billCount', td.bill_count,
      'netWeight', round(td.net_weight, 2),
      'paidTotal', round(td.paid_total, 2),
      'averagePrice', case
        when td.priced_net_weight > 0
          then round(td.rubber_value / td.priced_net_weight, 2)
        else null
      end,
      'rubberValue', round(td.rubber_value, 2),
      'deductionTotal', round(td.deduction_total, 2),
      'unpricedBillCount', td.unpriced_bill_count,
      'pendingApprovalCount', td.pending_approval_count
    ),
    'rubberRemaining', jsonb_build_object(
      'billCount', rr.bill_count,
      'netWeight', round(rr.net_weight, 2),
      'averagePrice', case
        when rr.priced_net_weight > 0
          then round(rr.rubber_value / rr.priced_net_weight, 2)
        else null
      end,
      'rubberValue', round(rr.rubber_value, 2),
      'deductionTotal', round(rr.deduction_total, 2),
      'unpricedBillCount', rr.unpriced_bill_count,
      'pendingApprovalCount', rr.pending_approval_count
    ),
    'purchase7Days', jsonb_build_object(
      'paidTotal', round(sd.paid_total, 2),
      'dailyAverage', round(sd.paid_total / 7, 2),
      'netWeight', round(sd.net_weight, 2),
      'averageCostPerKg', case
        when sd.net_weight > 0
          then round(sd.paid_total / sd.net_weight, 2)
        else null
      end
    ),
    'cashToday', jsonb_build_object(
      'income', round(ft.today_income, 2),
      'expense', round(ft.today_expense, 2),
      'net', round(ft.today_income - ft.today_expense, 2)
    ),
    'netCashFlow', round(ft.net_cash_flow, 2),
    'operatingExpenseAccumulated', round(ft.operating_expense, 2),
    'payablePurchaseAccumulated', round(pt.accumulated_purchase, 2),
    'operatingBurdenPercent', case
      when pt.accumulated_purchase > 0
        then round(ft.operating_expense / pt.accumulated_purchase * 100, 2)
      else null
    end,
    'rubberInventoryWeight', round(
      inventory.accumulated_net_weight - es.accumulated_original_weight,
      2
    ),
    'waterLoss7Days', jsonb_build_object(
      'exportCount', es.seven_day_export_count,
      'weight', round(es.seven_day_loss_weight, 2),
      'percent', case
        when es.seven_day_original_weight > 0
          then round(es.seven_day_loss_weight / es.seven_day_original_weight * 100, 2)
        else null
      end
    ),
    'stock', jsonb_build_object(
      'inStockCount', ss.in_stock_count,
      'outOfStockCount', ss.out_of_stock_count,
      'items', ss.items
    )
  )
  from today_rubber td
  cross join remaining_rubber rr
  cross join seven_day_purchase sd
  cross join inventory_stats inventory
  cross join payable_total pt
  cross join export_stats es
  cross join stock_summary ss
  cross join financial_totals ft
$$;

revoke all on function private.calculate_dashboard_summary(uuid)
  from public, anon, authenticated;

-- Existing snapshots do not contain the new keys. Queue every active branch for
-- a forward rebuild while preserving work that is already queued or running.
update public.dashboard_branch_snapshots snapshot
set status = case
      when snapshot.status in ('queued', 'running') then snapshot.status
      else 'dirty'
    end,
    source_version = greatest(
      snapshot.source_version + 1,
      pg_catalog.txid_current()
    ),
    updated_at = now()
from public.locations location
where location.id = snapshot.location_id
  and location.is_active = true;
