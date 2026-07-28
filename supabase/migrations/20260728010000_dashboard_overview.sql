-- Read-only Dashboard projection. Keep the existing Income/Expense feed contract unchanged.

create or replace function public.get_dashboard_overview(
  p_location_id uuid,
  p_cursor_at timestamptz default null,
  p_cursor_key text default null,
  p_page_size integer default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  v_today date := (current_timestamp at time zone 'Asia/Bangkok')::date;
  v_from date := v_today - 6;
  v_page_size integer := least(greatest(coalesce(p_page_size, 10), 1), 50);
begin
  if not private.is_active_user() or not public.can_access_location(p_location_id) then
    raise exception 'Location access denied';
  end if;

  if (p_cursor_at is null) <> (p_cursor_key is null) then
    raise exception 'Invalid dashboard cursor';
  end if;

  return (
    with active_bills as (
      select b.*
      from public.rubber_bills b
      where b.location_id = p_location_id
        and b.record_status = 'active'
    ),
    payable_bills as (
      select b.*
      from active_bills b
      where private.rubber_bill_is_payable(b.id)
    ),
    purchase_stats as (
      select
        (select count(*) from active_bills b where b.bill_date = v_today) as today_bill_count,
        (select coalesce(sum(b.net_weight), 0) from active_bills b where b.bill_date = v_today) as today_net_weight,
        (select coalesce(sum(b.net_total), 0) from payable_bills b where b.bill_date = v_today) as today_paid_total,
        (select coalesce(sum(b.net_weight), 0) from payable_bills b where b.bill_date between v_from and v_today) as seven_day_net_weight,
        (select coalesce(sum(b.net_total), 0) from payable_bills b where b.bill_date between v_from and v_today) as seven_day_paid_total,
        (select coalesce(sum(b.net_weight), 0) from active_bills b) as accumulated_net_weight
    ),
    export_stats as (
      select
        coalesce(sum(e.original_weight_total) filter (where e.status = 'verified'), 0) as accumulated_original_weight,
        count(*) filter (
          where e.status = 'verified'
            and (e.verified_at at time zone 'Asia/Bangkok')::date between v_from and v_today
        ) as seven_day_export_count,
        coalesce(sum(e.original_weight_total - e.current_weight) filter (
          where e.status = 'verified'
            and (e.verified_at at time zone 'Asia/Bangkok')::date between v_from and v_today
        ), 0) as seven_day_loss_weight,
        coalesce(sum(e.original_weight_total) filter (
          where e.status = 'verified'
            and (e.verified_at at time zone 'Asia/Bangkok')::date between v_from and v_today
        ), 0) as seven_day_original_weight
      from public.rubber_exports e
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
    financial_events as (
      select
        coalesce(ie.client_recorded_at, ie.created_at) as occurred_at,
        ie.tx_date as business_date,
        'actual:' || ie.id::text as sort_key,
        ie.id::text as id,
        ie.type::text as kind,
        coalesce(ie.number, ie.server_bill_no, ie.local_bill_no, left(ie.id::text, 8)) as number,
        ie.title,
        ie.type::text as direction,
        ie.cost as amount,
        ie.created_by_name,
        true as affects_balance,
        ie.type = 'expense' as operating_expense
      from public.income_expense ie
      where ie.location_id = p_location_id
        and ie.record_status = 'active'
        and ie.cost > 0

      union all

      select
        mt.created_at,
        (mt.created_at at time zone 'Asia/Bangkok')::date,
        'branch-transfer-in:' || mt.id::text,
        'branch-transfer-in:' || mt.id::text,
        'transfer_in',
        'TR-' || left(mt.id::text, 8),
        'รับโอนเงินเข้าสาขา',
        'income',
        mt.net_amount_to_pay,
        coalesce(mt.created_by_name, 'ระบบโอนเงิน'),
        true,
        false
      from public.money_transfers mt
      where mt.transfer_type = 'branch'
        and coalesce(mt.transfer_method, 'bank') <> 'cash'
        and mt.target_location_id = p_location_id
        and mt.record_status <> 'deleted'
        and mt.transfer_status in ('paid', 'overpaid', 'branch_and_transfer')
        and mt.net_amount_to_pay > 0

      union all

      select
        mt.created_at,
        (mt.created_at at time zone 'Asia/Bangkok')::date,
        'branch-transfer-out:' || mt.id::text,
        'branch-transfer-out:' || mt.id::text,
        'transfer_out',
        'TR-' || left(mt.id::text, 8),
        'โยกเงินไป ' || coalesce(mt.target_location_name, 'สาขาปลายทาง'),
        'expense',
        mt.net_amount_to_pay,
        coalesce(mt.created_by_name, 'ระบบโอนเงิน'),
        true,
        false
      from public.money_transfers mt
      where mt.transfer_type = 'branch'
        and coalesce(mt.transfer_method, 'bank') <> 'cash'
        and mt.location_id = p_location_id
        and mt.target_location_id <> mt.location_id
        and mt.record_status <> 'deleted'
        and mt.transfer_status in ('paid', 'overpaid', 'branch_and_transfer')
        and mt.net_amount_to_pay > 0

      union all

      select
        mt.created_at,
        (mt.created_at at time zone 'Asia/Bangkok')::date,
        'customer-branch-paid:' || mt.id::text,
        'customer-branch-paid:' || mt.id::text,
        'transfer_out',
        'CT-' || left(mt.id::text, 8),
        'สาขาจ่ายส่วนต่างให้ ' || coalesce(mt.customer_name, 'ลูกค้า'),
        'expense',
        mt.branch_paid_amount,
        coalesce(mt.created_by_name, 'ระบบโอนเงิน'),
        true,
        false
      from public.money_transfers mt
      where mt.transfer_type = 'customer'
        and mt.transfer_status = 'branch_and_transfer'
        and mt.location_id = p_location_id
        and mt.record_status <> 'deleted'
        and mt.branch_paid_amount > 0

      union all

      select
        d.sent_at,
        (d.sent_at at time zone 'Asia/Bangkok')::date,
        'cash-transfer-out:' || mt.id::text,
        'cash-transfer-out:' || mt.id::text,
        'transfer_out',
        'CASH-' || left(mt.id::text, 8),
        'โยกเงินสดไป ' || coalesce(mt.target_location_name, 'สาขาปลายทาง'),
        'expense',
        d.sent_total,
        coalesce(mt.created_by_name, 'ระบบโอนเงิน'),
        true,
        false
      from public.money_transfers mt
      join public.money_transfer_cash_details d on d.transfer_id = mt.id
      where mt.transfer_type = 'cash'
        and mt.transfer_method = 'cash'
        and mt.location_id = p_location_id
        and mt.record_status <> 'deleted'
        and d.sent_total > 0

      union all

      select
        d.received_at,
        (d.received_at at time zone 'Asia/Bangkok')::date,
        'cash-transfer-in:' || mt.id::text,
        'cash-transfer-in:' || mt.id::text,
        'transfer_in',
        'CASH-' || left(mt.id::text, 8),
        'รับโอนเงินสดเข้าสาขา',
        'income',
        d.received_total,
        coalesce(d.received_by_name, mt.created_by_name, 'ระบบโอนเงิน'),
        true,
        false
      from public.money_transfers mt
      join public.money_transfer_cash_details d on d.transfer_id = mt.id
      where mt.transfer_type = 'cash'
        and mt.transfer_method = 'cash'
        and mt.target_location_id = p_location_id
        and mt.record_status <> 'deleted'
        and d.cash_status in ('received', 'mismatched', 'difference_accepted')
        and d.received_total > 0

      union all

      select
        ft.approved_at,
        (ft.approved_at at time zone 'Asia/Bangkok')::date,
        'withdrawal:' || ft.id::text,
        'withdrawal:' || ft.id::text,
        'expense',
        'TW-' || left(ft.id::text, 8),
        'เบิกเงิน — ' || coalesce(p.name, 'พนักงาน') ||
          coalesce(': ' || nullif(ft.description, ''), ''),
        'expense',
        ft.amount,
        coalesce(p.name, 'พนักงาน'),
        true,
        true
      from public.financial_transactions ft
      join public.profiles p on p.id = ft.profile_id
      where ft.type = 'WITHDRAWAL'
        and ft.status = 'APPROVED'
        and ft.cancelled_at is null
        and ft.expense_location_id = p_location_id
        and ft.amount > 0

      union all

      select
        ps.approved_at,
        (ps.approved_at at time zone 'Asia/Bangkok')::date,
        'payroll:' || ps.id::text,
        'payroll:' || ps.id::text,
        'expense',
        'PS-' || left(ps.id::text, 8),
        'เงินเดือน — ' || coalesce(p.name, 'พนักงาน') || ' — ' || ps.month,
        'expense',
        ps.net_pay,
        coalesce(p.name, 'พนักงาน'),
        true,
        true
      from public.payroll_slips ps
      join public.profiles p on p.id = ps.profile_id
      where ps.status = 'APPROVED'
        and ps.cancelled_at is null
        and ps.expense_location_id = p_location_id
        and ps.net_pay > 0

      union all

      select
        coalesce(b.client_recorded_at, b.created_at),
        b.bill_date,
        'rubber-bill:' || b.id::text,
        'rubber-bill:' || b.id::text,
        'rubber_bill',
        coalesce(b.server_bill_no, nullif(b.local_bill_no, ''), nullif(b.bill_no, ''), left(b.id::text, 8)),
        'รับซื้อยาง — ' || coalesce(nullif(b.customer_name, ''), 'ไม่ระบุลูกค้า'),
        'expense',
        b.net_total,
        b.created_by_name,
        not exists (
          select 1
          from public.money_transfer_items i
          where i.source_type = 'rubber_bill'
            and i.source_id = b.id
        ),
        false
      from payable_bills b

      union all

      select
        coalesce(ot.client_recorded_at, ot.created_at),
        ot.date_in,
        'ocr-ticket:' || ot.id::text,
        'ocr-ticket:' || ot.id::text,
        'rubber_bill',
        coalesce(nullif(ot.ticket_id, ''), left(ot.id::text, 8)),
        'รับซื้อยางจากใบชั่ง — ' || coalesce(nullif(ot.customer_name, ''), 'ไม่ระบุลูกค้า'),
        'expense',
        ot.total_amount,
        ot.created_by_name,
        not exists (
          select 1
          from public.money_transfer_items i
          where i.source_type = 'ocr_ticket'
            and i.source_id = ot.id
        ),
        false
      from public.ocr_tickets ot
      where ot.location_id = p_location_id
        and ot.record_status = 'active'
        and ot.total_amount > 0

      union all

      select
        e.verified_at,
        (e.verified_at at time zone 'Asia/Bangkok')::date,
        'rubber-export:' || e.id::text,
        'rubber-export:' || e.id::text,
        'rubber_export',
        e.export_no,
        'ค่าทำงานส่งออกยาง — ' || e.export_no,
        'expense',
        e.work_total,
        e.created_by_name,
        true,
        true
      from public.rubber_exports e
      where e.location_id = p_location_id
        and e.status = 'verified'
        and e.expense_destination = 'branch'
        and e.work_total > 0
    ),
    financial_totals as (
      select coalesce(sum(
        case
          when not affects_balance then 0
          when direction = 'income' then amount
          else -amount
        end
      ), 0) as net_cash_flow
      from financial_events
    ),
    operating_stats as (
      select coalesce(sum(amount), 0) as accumulated_expense
      from financial_events
      where operating_expense
    ),
    filtered_events as (
      select *
      from financial_events
      where p_cursor_at is null
         or (occurred_at, sort_key) < (p_cursor_at, p_cursor_key)
    ),
    numbered_events as (
      select
        *,
        row_number() over (order by occurred_at desc, sort_key desc) as row_no
      from filtered_events
    ),
    page as (
      select *
      from numbered_events
      where row_no <= v_page_size + 1
    )
    select jsonb_build_object(
      'summary', jsonb_build_object(
        'purchaseToday', jsonb_build_object(
          'billCount', ps.today_bill_count,
          'netWeight', round(ps.today_net_weight, 2),
          'paidTotal', round(ps.today_paid_total, 2)
        ),
        'purchase7Days', jsonb_build_object(
          'paidTotal', round(ps.seven_day_paid_total, 2),
          'dailyAverage', round(ps.seven_day_paid_total / 7, 2),
          'netWeight', round(ps.seven_day_net_weight, 2),
          'averageCostPerKg', case
            when ps.seven_day_net_weight > 0
              then round(ps.seven_day_paid_total / ps.seven_day_net_weight, 2)
            else null
          end
        ),
        'netCashFlow', round(ft.net_cash_flow, 2),
        'operatingExpenseAccumulated', round(os.accumulated_expense, 2),
        'rubberInventoryWeight', round(
          ps.accumulated_net_weight - es.accumulated_original_weight,
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
      ),
      'rows', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', id,
            'kind', kind,
            'number', number,
            'title', title,
            'direction', direction,
            'amount', round(amount, 2),
            'occurredAt', occurred_at,
            'createdByName', created_by_name
          )
          order by occurred_at desc, sort_key desc
        )
        from page
        where row_no <= v_page_size
      ), '[]'::jsonb),
      'nextCursor', case
        when (select count(*) from page) > v_page_size then (
          select jsonb_build_object('at', occurred_at, 'key', sort_key)
          from page
          where row_no = v_page_size
        )
        else null
      end
    )
    from purchase_stats ps
    cross join export_stats es
    cross join stock_summary ss
    cross join financial_totals ft
    cross join operating_stats os
  );
end;
$$;

revoke all on function public.get_dashboard_overview(uuid, timestamptz, text, integer)
  from public, anon;
grant execute on function public.get_dashboard_overview(uuid, timestamptz, text, integer)
  to authenticated;
