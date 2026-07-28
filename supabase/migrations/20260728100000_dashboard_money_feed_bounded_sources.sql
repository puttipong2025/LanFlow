-- Bound every source before the final merge so one large history table cannot
-- force the ten-row Dashboard feed to sort its full branch history.

create or replace function public.get_dashboard_money_feed(
  p_location_id uuid,
  p_cursor_at timestamptz default null,
  p_cursor_key text default null,
  p_page_size integer default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  page_size integer := least(greatest(coalesce(p_page_size, 10), 1), 50);
begin
  if not private.is_active_user()
    or not public.can_access_location(p_location_id)
  then
    raise exception 'Location access denied';
  end if;

  if (p_cursor_at is null) <> (p_cursor_key is null) then
    raise exception 'Invalid dashboard cursor';
  end if;

  return (
    with income_expense_candidates as (
      select
        coalesce(ie.client_recorded_at, ie.created_at) as occurred_at,
        'actual:' || ie.id::text as sort_key,
        ie.id::text as id,
        ie.type::text as kind,
        coalesce(
          ie.number,
          ie.server_bill_no,
          ie.local_bill_no,
          left(ie.id::text, 8)
        ) as number,
        ie.title,
        ie.type::text as direction,
        ie.cost as amount,
        ie.created_by_name
      from public.income_expense ie
      where ie.location_id = p_location_id
        and ie.record_status = 'active'
        and ie.cost > 0
        and (
          p_cursor_at is null
          or (
            coalesce(ie.client_recorded_at, ie.created_at),
            'actual:' || ie.id::text
          ) < (p_cursor_at, p_cursor_key)
        )
      order by
        coalesce(ie.client_recorded_at, ie.created_at) desc,
        'actual:' || ie.id::text desc
      limit page_size + 1
    ),
    branch_transfer_in_candidates as (
      select
        mt.created_at as occurred_at,
        'branch-transfer-in:' || mt.id::text as sort_key,
        'branch-transfer-in:' || mt.id::text as id,
        'transfer_in'::text as kind,
        'TR-' || left(mt.id::text, 8) as number,
        'รับโอนเงินเข้าสาขา'::text as title,
        'income'::text as direction,
        mt.net_amount_to_pay as amount,
        coalesce(mt.created_by_name, 'ระบบโอนเงิน') as created_by_name
      from public.money_transfers mt
      where mt.transfer_type = 'branch'
        and coalesce(mt.transfer_method, 'bank') <> 'cash'
        and mt.target_location_id = p_location_id
        and mt.record_status <> 'deleted'
        and mt.transfer_status in ('paid', 'overpaid', 'branch_and_transfer')
        and mt.net_amount_to_pay > 0
        and (
          p_cursor_at is null
          or (mt.created_at, 'branch-transfer-in:' || mt.id::text)
            < (p_cursor_at, p_cursor_key)
        )
      order by mt.created_at desc, 'branch-transfer-in:' || mt.id::text desc
      limit page_size + 1
    ),
    branch_transfer_out_candidates as (
      select
        mt.created_at as occurred_at,
        'branch-transfer-out:' || mt.id::text as sort_key,
        'branch-transfer-out:' || mt.id::text as id,
        'transfer_out'::text as kind,
        'TR-' || left(mt.id::text, 8) as number,
        'โยกเงินไป ' || coalesce(mt.target_location_name, 'สาขาปลายทาง')
          as title,
        'expense'::text as direction,
        mt.net_amount_to_pay as amount,
        coalesce(mt.created_by_name, 'ระบบโอนเงิน') as created_by_name
      from public.money_transfers mt
      where mt.transfer_type = 'branch'
        and coalesce(mt.transfer_method, 'bank') <> 'cash'
        and mt.location_id = p_location_id
        and mt.target_location_id <> mt.location_id
        and mt.record_status <> 'deleted'
        and mt.transfer_status in ('paid', 'overpaid', 'branch_and_transfer')
        and mt.net_amount_to_pay > 0
        and (
          p_cursor_at is null
          or (mt.created_at, 'branch-transfer-out:' || mt.id::text)
            < (p_cursor_at, p_cursor_key)
        )
      order by mt.created_at desc, 'branch-transfer-out:' || mt.id::text desc
      limit page_size + 1
    ),
    customer_paid_candidates as (
      select
        mt.created_at as occurred_at,
        'customer-branch-paid:' || mt.id::text as sort_key,
        'customer-branch-paid:' || mt.id::text as id,
        'transfer_out'::text as kind,
        'CT-' || left(mt.id::text, 8) as number,
        'สาขาจ่ายส่วนต่างให้ ' || coalesce(mt.customer_name, 'ลูกค้า') as title,
        'expense'::text as direction,
        mt.branch_paid_amount as amount,
        coalesce(mt.created_by_name, 'ระบบโอนเงิน') as created_by_name
      from public.money_transfers mt
      where mt.transfer_type = 'customer'
        and mt.transfer_status = 'branch_and_transfer'
        and mt.location_id = p_location_id
        and mt.record_status <> 'deleted'
        and mt.branch_paid_amount > 0
        and (
          p_cursor_at is null
          or (mt.created_at, 'customer-branch-paid:' || mt.id::text)
            < (p_cursor_at, p_cursor_key)
        )
      order by mt.created_at desc, 'customer-branch-paid:' || mt.id::text desc
      limit page_size + 1
    ),
    cash_out_candidates as (
      select
        d.sent_at as occurred_at,
        'cash-transfer-out:' || mt.id::text as sort_key,
        'cash-transfer-out:' || mt.id::text as id,
        'transfer_out'::text as kind,
        'CASH-' || left(mt.id::text, 8) as number,
        'โยกเงินสดไป ' || coalesce(mt.target_location_name, 'สาขาปลายทาง')
          as title,
        'expense'::text as direction,
        d.sent_total as amount,
        coalesce(mt.created_by_name, 'ระบบโอนเงิน') as created_by_name
      from public.money_transfers mt
      join public.money_transfer_cash_details d on d.transfer_id = mt.id
      where mt.transfer_type = 'cash'
        and mt.transfer_method = 'cash'
        and mt.location_id = p_location_id
        and mt.record_status <> 'deleted'
        and d.sent_total > 0
        and (
          p_cursor_at is null
          or (d.sent_at, 'cash-transfer-out:' || mt.id::text)
            < (p_cursor_at, p_cursor_key)
        )
      order by d.sent_at desc, 'cash-transfer-out:' || mt.id::text desc
      limit page_size + 1
    ),
    cash_in_candidates as (
      select
        d.received_at as occurred_at,
        'cash-transfer-in:' || mt.id::text as sort_key,
        'cash-transfer-in:' || mt.id::text as id,
        'transfer_in'::text as kind,
        'CASH-' || left(mt.id::text, 8) as number,
        'รับโอนเงินสดเข้าสาขา'::text as title,
        'income'::text as direction,
        d.received_total as amount,
        coalesce(
          d.received_by_name,
          mt.created_by_name,
          'ระบบโอนเงิน'
        ) as created_by_name
      from public.money_transfers mt
      join public.money_transfer_cash_details d on d.transfer_id = mt.id
      where mt.transfer_type = 'cash'
        and mt.transfer_method = 'cash'
        and mt.target_location_id = p_location_id
        and mt.record_status <> 'deleted'
        and d.cash_status in ('received', 'mismatched', 'difference_accepted')
        and d.received_total > 0
        and (
          p_cursor_at is null
          or (d.received_at, 'cash-transfer-in:' || mt.id::text)
            < (p_cursor_at, p_cursor_key)
        )
      order by d.received_at desc, 'cash-transfer-in:' || mt.id::text desc
      limit page_size + 1
    ),
    withdrawal_candidates as (
      select
        ft.approved_at as occurred_at,
        'withdrawal:' || ft.id::text as sort_key,
        'withdrawal:' || ft.id::text as id,
        'expense'::text as kind,
        'TW-' || left(ft.id::text, 8) as number,
        'เบิกเงิน — ' || coalesce(p.name, 'พนักงาน')
          || coalesce(': ' || nullif(ft.description, ''), '') as title,
        'expense'::text as direction,
        ft.amount,
        coalesce(p.name, 'พนักงาน') as created_by_name
      from public.financial_transactions ft
      join public.profiles p on p.id = ft.profile_id
      where ft.type = 'WITHDRAWAL'
        and ft.status = 'APPROVED'
        and ft.cancelled_at is null
        and ft.expense_location_id = p_location_id
        and ft.amount > 0
        and (
          p_cursor_at is null
          or (ft.approved_at, 'withdrawal:' || ft.id::text)
            < (p_cursor_at, p_cursor_key)
        )
      order by ft.approved_at desc, 'withdrawal:' || ft.id::text desc
      limit page_size + 1
    ),
    payroll_candidates as (
      select
        ps.approved_at as occurred_at,
        'payroll:' || ps.id::text as sort_key,
        'payroll:' || ps.id::text as id,
        'expense'::text as kind,
        'PS-' || left(ps.id::text, 8) as number,
        'เงินเดือน — ' || coalesce(p.name, 'พนักงาน') || ' — ' || ps.month
          as title,
        'expense'::text as direction,
        ps.net_pay as amount,
        coalesce(p.name, 'พนักงาน') as created_by_name
      from public.payroll_slips ps
      join public.profiles p on p.id = ps.profile_id
      where ps.status = 'APPROVED'
        and ps.cancelled_at is null
        and ps.expense_location_id = p_location_id
        and ps.net_pay > 0
        and (
          p_cursor_at is null
          or (ps.approved_at, 'payroll:' || ps.id::text)
            < (p_cursor_at, p_cursor_key)
        )
      order by ps.approved_at desc, 'payroll:' || ps.id::text desc
      limit page_size + 1
    ),
    rubber_bill_candidates as (
      select
        coalesce(b.client_recorded_at, b.created_at) as occurred_at,
        'rubber-bill:' || b.id::text as sort_key,
        'rubber-bill:' || b.id::text as id,
        'rubber_bill'::text as kind,
        coalesce(
          b.server_bill_no,
          nullif(b.local_bill_no, ''),
          nullif(b.bill_no, ''),
          left(b.id::text, 8)
        ) as number,
        'รับซื้อยาง — ' || coalesce(nullif(b.customer_name, ''), 'ไม่ระบุลูกค้า')
          as title,
        'expense'::text as direction,
        b.net_total as amount,
        b.created_by_name
      from public.rubber_bills b
      where b.location_id = p_location_id
        and b.record_status = 'active'
        and private.rubber_bill_is_payable(b.id)
        and (
          p_cursor_at is null
          or (
            coalesce(b.client_recorded_at, b.created_at),
            'rubber-bill:' || b.id::text
          ) < (p_cursor_at, p_cursor_key)
        )
      order by
        coalesce(b.client_recorded_at, b.created_at) desc,
        'rubber-bill:' || b.id::text desc
      limit page_size + 1
    ),
    ocr_candidates as (
      select
        coalesce(ot.client_recorded_at, ot.created_at) as occurred_at,
        'ocr-ticket:' || ot.id::text as sort_key,
        'ocr-ticket:' || ot.id::text as id,
        'rubber_bill'::text as kind,
        coalesce(nullif(ot.ticket_id, ''), left(ot.id::text, 8)) as number,
        'รับซื้อยางจากใบชั่ง — '
          || coalesce(nullif(ot.customer_name, ''), 'ไม่ระบุลูกค้า') as title,
        'expense'::text as direction,
        ot.total_amount as amount,
        ot.created_by_name
      from public.ocr_tickets ot
      where ot.location_id = p_location_id
        and ot.record_status = 'active'
        and ot.total_amount > 0
        and (
          p_cursor_at is null
          or (
            coalesce(ot.client_recorded_at, ot.created_at),
            'ocr-ticket:' || ot.id::text
          ) < (p_cursor_at, p_cursor_key)
        )
      order by
        coalesce(ot.client_recorded_at, ot.created_at) desc,
        'ocr-ticket:' || ot.id::text desc
      limit page_size + 1
    ),
    export_candidates as (
      select
        e.verified_at as occurred_at,
        'rubber-export:' || e.id::text as sort_key,
        'rubber-export:' || e.id::text as id,
        'rubber_export'::text as kind,
        e.export_no as number,
        'ค่าทำงานส่งออกยาง — ' || e.export_no as title,
        'expense'::text as direction,
        e.work_total as amount,
        e.created_by_name
      from public.rubber_exports e
      where e.location_id = p_location_id
        and e.status = 'verified'
        and e.expense_destination = 'branch'
        and e.work_total > 0
        and (
          p_cursor_at is null
          or (e.verified_at, 'rubber-export:' || e.id::text)
            < (p_cursor_at, p_cursor_key)
        )
      order by e.verified_at desc, 'rubber-export:' || e.id::text desc
      limit page_size + 1
    ),
    candidates as (
      select * from income_expense_candidates
      union all select * from branch_transfer_in_candidates
      union all select * from branch_transfer_out_candidates
      union all select * from customer_paid_candidates
      union all select * from cash_out_candidates
      union all select * from cash_in_candidates
      union all select * from withdrawal_candidates
      union all select * from payroll_candidates
      union all select * from rubber_bill_candidates
      union all select * from ocr_candidates
      union all select * from export_candidates
    ),
    page as (
      select *
      from candidates
      order by occurred_at desc, sort_key desc
      limit page_size + 1
    )
    select jsonb_build_object(
      'rows',
      coalesce((
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
        from (
          select *
          from page
          order by occurred_at desc, sort_key desc
          limit page_size
        ) visible
      ), '[]'::jsonb),
      'nextCursor',
      case
        when (select count(*) from page) > page_size then (
          select jsonb_build_object('at', occurred_at, 'key', sort_key)
          from page
          order by occurred_at desc, sort_key desc
          offset page_size - 1
          limit 1
        )
        else null
      end
    )
  );
end;
$$;
