-- Bound the default Income/Expense open path per source before merging pages.
-- Search and approval queues remain on-demand paths behind the same wire contract.

alter function public.get_income_expense_operational_feed(uuid, text, text, text)
  rename to get_income_expense_operational_feed_on_demand;

revoke all on function public.get_income_expense_operational_feed_on_demand(uuid, text, text, text)
  from public, anon, authenticated;

create or replace function private.income_expense_operational_row(
  p_location_id uuid,
  p_source_kind text,
  p_source_id uuid,
  p_source_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private
as $$
declare
  v_result jsonb;
begin
  if p_source_kind = 'actual' then
    select jsonb_strip_nulls(jsonb_build_object(
      'id', ie.id, 'clientTempId', coalesce(ie.client_temp_id, ie.id::text),
      'localBillNo', ie.local_bill_no, 'serverBillNo', ie.server_bill_no,
      'idempotencyKey', coalesce(ie.idempotency_key, 'server:' || ie.id::text),
      'locationId', ie.location_id, 'syncStatus', 'synced', 'recordStatus', ie.record_status,
      'type', ie.type, 'number', coalesce(ie.number, ie.server_bill_no, ie.local_bill_no),
      'txDate', ie.tx_date, 'title', ie.title, 'cost', ie.cost,
      'unit', ie.unit, 'price', ie.price,
      'incomeSaleItemId', ie.income_sale_item_id, 'stockProductId', ie.stock_product_id,
      'stockQuantity', ie.stock_quantity, 'billOption', ie.bill_option,
      'clientRecordedAt', coalesce(ie.client_recorded_at, ie.created_at),
      'clientCreatedAt', coalesce(ie.client_created_at, ie.created_at),
      'serverReceivedAt', ie.server_received_at, 'revisionNo', ie.revision_no,
      'createdByUserId', ie.created_by_user_id, 'createdByName', ie.created_by_name,
      'createdByPhone', ie.created_by_phone,
      'saleLineCount', (select count(*) from public.income_expense_sale_lines l where l.income_expense_id = ie.id),
      'reportLockNo', public.report_lock_no(ie),
      'relationLockReason', case when public.report_lock_no(ie) is not null
        then 'ล็อกโดยรายงาน ' || public.report_lock_no(ie) || ' — ต้องลบรายงานล่าสุดตามลำดับก่อน' end
    )) into v_result
    from public.income_expense ie
    where ie.id = p_source_id and ie.location_id = p_location_id and ie.record_status = 'active';

  elsif p_source_kind = 'branch_income' then
    select jsonb_strip_nulls(jsonb_build_object(
      'id', 'money-transfer-income:' || mt.id, 'clientTempId', 'money-transfer-income:' || mt.id,
      'localBillNo', 'TR-' || left(mt.id::text, 8), 'serverBillNo', 'TR-' || left(mt.id::text, 8),
      'idempotencyKey', 'money-transfer:' || mt.id, 'locationId', mt.target_location_id,
      'syncStatus', 'synced', 'recordStatus', 'active', 'type', 'income',
      'number', 'TR-' || left(mt.id::text, 8),
      'txDate', (mt.created_at at time zone 'Asia/Bangkok')::date,
      'title', 'รับโอนจาก ' || coalesce(source_location.name, 'สาขาต้นทาง'),
      'cost', mt.net_amount_to_pay, 'billOption', 'รายรับ',
      'clientRecordedAt', mt.created_at, 'clientCreatedAt', mt.created_at,
      'serverReceivedAt', mt.updated_at, 'revisionNo', mt.revision_no,
      'createdByUserId', mt.created_by_user_id, 'createdByName', coalesce(mt.created_by_name, 'ระบบโอนเงิน'),
      'createdByPhone', mt.created_by_phone, 'relationSourceType', 'money_transfer',
      'relationSourceId', mt.id, 'relationSourceLocationId', mt.location_id,
      'relationLabel', 'โอนเงินสาขา',
      'relationLockReason', 'รายการนี้มาจากการโอนเงินสาขา ต้องแก้ไขหรือลบที่โมดูลโอนเงินต้นทาง',
      'reportLockNo', public.report_lock_no(mt)
    )) into v_result
    from public.money_transfers mt
    left join public.locations source_location on source_location.id = mt.location_id
    where mt.id = p_source_id and mt.target_location_id = p_location_id;

  elsif p_source_kind = 'branch_expense' then
    select jsonb_strip_nulls(jsonb_build_object(
      'id', 'money-transfer-branch-expense:' || mt.id,
      'clientTempId', 'money-transfer-branch-expense:' || mt.id,
      'localBillNo', 'TR-' || left(mt.id::text, 8), 'serverBillNo', 'TR-' || left(mt.id::text, 8),
      'idempotencyKey', 'money-transfer-branch-expense:' || mt.id, 'locationId', mt.location_id,
      'syncStatus', 'synced', 'recordStatus', 'active', 'type', 'expense',
      'number', 'TR-' || left(mt.id::text, 8),
      'txDate', (mt.created_at at time zone 'Asia/Bangkok')::date,
      'title', 'โยกเงินไป ' || coalesce(mt.target_location_name, 'สาขาปลายทาง'),
      'cost', mt.net_amount_to_pay, 'billOption', 'ค่าใช้จ่าย',
      'clientRecordedAt', mt.created_at, 'clientCreatedAt', mt.created_at,
      'serverReceivedAt', mt.updated_at, 'revisionNo', mt.revision_no,
      'createdByUserId', mt.created_by_user_id, 'createdByName', coalesce(mt.created_by_name, 'ระบบโอนเงิน'),
      'createdByPhone', mt.created_by_phone, 'relationSourceType', 'money_transfer',
      'relationSourceId', mt.id, 'relationSourceLocationId', mt.location_id,
      'relationLabel', 'โอนเงินสาขา',
      'relationLockReason', 'รายการนี้มาจากการโอนเงินสาขา ต้องแก้ไขหรือลบที่โมดูลโอนเงินต้นทาง',
      'reportLockNo', public.report_lock_no(mt)
    )) into v_result
    from public.money_transfers mt where mt.id = p_source_id and mt.location_id = p_location_id;

  elsif p_source_kind = 'customer_branch_paid' then
    select jsonb_strip_nulls(jsonb_build_object(
      'id', 'money-transfer-branch-paid-expense:' || mt.id,
      'clientTempId', 'money-transfer-branch-paid-expense:' || mt.id,
      'localBillNo', 'CT-' || left(mt.id::text, 8), 'serverBillNo', 'CT-' || left(mt.id::text, 8),
      'idempotencyKey', 'money-transfer-branch-paid:' || mt.id, 'locationId', mt.location_id,
      'syncStatus', 'synced', 'recordStatus', 'active', 'type', 'expense',
      'number', 'CT-' || left(mt.id::text, 8),
      'txDate', (mt.created_at at time zone 'Asia/Bangkok')::date,
      'title', 'สาขาจ่ายส่วนต่างให้ ' || coalesce(mt.customer_name, 'ลูกค้า'),
      'cost', mt.branch_paid_amount, 'billOption', 'ค่าใช้จ่าย',
      'clientRecordedAt', mt.created_at, 'clientCreatedAt', mt.created_at,
      'serverReceivedAt', mt.updated_at, 'revisionNo', mt.revision_no,
      'createdByUserId', mt.created_by_user_id, 'createdByName', coalesce(mt.created_by_name, 'ระบบโอนเงิน'),
      'createdByPhone', mt.created_by_phone, 'relationSourceType', 'money_transfer',
      'relationSourceId', mt.id, 'relationSourceLocationId', mt.location_id,
      'relationLabel', 'โอน+สาขาจ่าย',
      'relationLockReason', 'รายการนี้มาจากโอนเงินลูกค้าแบบโอน+สาขาจ่าย ต้องแก้ไขหรือลบที่โมดูลโอนเงินลูกค้าต้นทาง',
      'reportLockNo', public.report_lock_no(mt)
    )) into v_result
    from public.money_transfers mt where mt.id = p_source_id and mt.location_id = p_location_id;

  elsif p_source_kind in ('cash_expense', 'cash_income') then
    select jsonb_strip_nulls(jsonb_build_object(
      'id', case when p_source_kind = 'cash_income' then 'cash-transfer-income:' else 'cash-transfer-expense:' end || mt.id,
      'clientTempId', case when p_source_kind = 'cash_income' then 'cash-transfer-income:' else 'cash-transfer-expense:' end || mt.id,
      'localBillNo', 'CASH-' || left(mt.id::text, 8), 'serverBillNo', 'CASH-' || left(mt.id::text, 8),
      'idempotencyKey', case when p_source_kind = 'cash_income' then 'cash-transfer-income:' else 'cash-transfer-expense:' end || mt.id,
      'locationId', case when p_source_kind = 'cash_income' then mt.target_location_id else mt.location_id end,
      'syncStatus', 'synced', 'recordStatus', 'active',
      'type', case when p_source_kind = 'cash_income' then 'income' else 'expense' end,
      'number', 'CASH-' || left(mt.id::text, 8),
      'txDate', case when p_source_kind = 'cash_income'
        then (d.received_at at time zone 'Asia/Bangkok')::date
        else (d.sent_at at time zone 'Asia/Bangkok')::date end,
      'title', case when p_source_kind = 'cash_income'
        then 'รับโอนเงินสดจาก ' || coalesce(source_location.name, 'สาขาต้นทาง')
        else 'โยกเงินสดไป ' || coalesce(mt.target_location_name, 'สาขาปลายทาง') end,
      'cost', case when p_source_kind = 'cash_income' then d.received_total else d.sent_total end,
      'billOption', case when p_source_kind = 'cash_income' then 'รายรับ' else 'ค่าใช้จ่าย' end,
      'clientRecordedAt', case when p_source_kind = 'cash_income' then d.received_at else d.sent_at end,
      'clientCreatedAt', case when p_source_kind = 'cash_income' then d.received_at else d.sent_at end,
      'serverReceivedAt', d.updated_at, 'revisionNo', mt.revision_no,
      'createdByUserId', mt.created_by_user_id, 'createdByName', mt.created_by_name,
      'createdByPhone', mt.created_by_phone, 'relationSourceType', 'money_transfer',
      'relationSourceId', 'cash:' || mt.id, 'relationSourceLocationId', mt.location_id,
      'relationLabel', case when d.cash_status = 'pending_receipt' then 'รอรับเงิน'
        when coalesce(d.difference_total, 0) <> 0 then 'รับเงินแล้ว · ผลต่าง ' || d.difference_total::text
        else 'รับเงินแล้ว' end,
      'relationLockReason', 'รายการนี้มาจากการโยกเงินสด ต้องเปิดรายละเอียดเพื่อดูข้อมูล',
      'reportLockNo', public.report_lock_no(mt), 'cashStatus', d.cash_status,
      'cashSourceLocationLabel', source_location.name
    )) into v_result
    from public.money_transfers mt
    join public.money_transfer_cash_details d on d.transfer_id = mt.id
    left join public.locations source_location on source_location.id = mt.location_id
    where mt.id = p_source_id
      and (case when p_source_kind = 'cash_income' then mt.target_location_id else mt.location_id end) = p_location_id;

  elsif p_source_kind = 'withdrawal' then
    select jsonb_strip_nulls(jsonb_build_object(
      'id', 'time-tracking-withdrawal:' || ft.id, 'clientTempId', 'time-tracking-withdrawal:' || ft.id,
      'localBillNo', 'TW-' || left(ft.id::text, 8), 'serverBillNo', 'TW-' || left(ft.id::text, 8),
      'idempotencyKey', 'time-tracking-withdrawal:' || ft.id, 'locationId', ft.expense_location_id,
      'syncStatus', 'synced', 'recordStatus', 'active', 'type', 'expense',
      'number', 'TW-' || left(ft.id::text, 8),
      'txDate', (ft.approved_at at time zone 'Asia/Bangkok')::date,
      'title', 'เบิกเงิน — ' || coalesce(profile.name, 'พนักงาน') || coalesce(': ' || nullif(ft.description, ''), ''),
      'cost', ft.amount, 'billOption', 'ค่าใช้จ่าย',
      'clientRecordedAt', ft.approved_at, 'clientCreatedAt', ft.created_at,
      'serverReceivedAt', ft.updated_at, 'revisionNo', 1,
      'createdByUserId', ft.profile_id, 'createdByName', coalesce(profile.name, 'พนักงาน'),
      'createdByPhone', profile.phone, 'relationSourceType', 'time_tracking_withdrawal',
      'relationSourceId', ft.id, 'relationSourceLocationId', ft.expense_location_id,
      'relationLabel', 'เบิกเงิน',
      'relationLockReason', 'รายการนี้มาจากการเบิกเงินที่อนุมัติแล้ว ต้องแก้ไขสาขาหรือยกเลิกที่โมดูลลงเวลาต้นทาง',
      'reportLockNo', public.report_lock_no(ft)
    )) into v_result
    from public.financial_transactions ft
    join public.profiles profile on profile.id = ft.profile_id
    where ft.id = p_source_id and ft.expense_location_id = p_location_id;

  elsif p_source_kind = 'payroll' then
    select jsonb_strip_nulls(jsonb_build_object(
      'id', 'payroll-slip:' || ps.id, 'clientTempId', 'payroll-slip:' || ps.id,
      'localBillNo', 'PS-' || left(ps.id::text, 8), 'serverBillNo', 'PS-' || left(ps.id::text, 8),
      'idempotencyKey', 'payroll-slip:' || ps.id, 'locationId', ps.expense_location_id,
      'syncStatus', 'synced', 'recordStatus', 'active', 'type', 'expense',
      'number', 'PS-' || left(ps.id::text, 8),
      'txDate', (ps.approved_at at time zone 'Asia/Bangkok')::date,
      'title', 'เงินเดือน — ' || coalesce(profile.name, 'พนักงาน') || ' — ' || ps.month,
      'cost', ps.net_pay, 'billOption', 'ค่าใช้จ่าย',
      'clientRecordedAt', ps.approved_at, 'clientCreatedAt', ps.created_at,
      'serverReceivedAt', ps.updated_at, 'revisionNo', 1,
      'createdByUserId', ps.profile_id, 'createdByName', coalesce(profile.name, 'พนักงาน'),
      'createdByPhone', profile.phone, 'relationSourceType', 'payroll_slip',
      'relationSourceId', ps.id, 'relationSourceLocationId', ps.expense_location_id,
      'relationLabel', 'เงินเดือน',
      'relationLockReason', 'รายการนี้มาจากเงินเดือนที่อนุมัติแล้ว ต้องแก้ไขสาขาหรือยกเลิกที่โมดูลลงเวลาต้นทาง',
      'reportLockNo', public.report_lock_no(ps)
    )) into v_result
    from public.payroll_slips ps
    join public.profiles profile on profile.id = ps.profile_id
    where ps.id = p_source_id and ps.expense_location_id = p_location_id;

  elsif p_source_kind = 'rubber_export' then
    select jsonb_strip_nulls(jsonb_build_object(
      'id', 'rubber-export-expense:' || e.id, 'clientTempId', 'rubber-export-expense:' || e.id,
      'localBillNo', e.export_no, 'serverBillNo', e.export_no,
      'idempotencyKey', 'rubber-export-expense:' || e.id, 'locationId', e.location_id,
      'syncStatus', 'synced', 'recordStatus', 'active', 'type', 'expense',
      'number', e.export_no, 'txDate', (e.verified_at at time zone 'Asia/Bangkok')::date,
      'title', 'ค่าทำงานส่งออกยาง — ' || e.export_no,
      'cost', e.work_total, 'billOption', 'ค่าใช้จ่าย',
      'clientRecordedAt', e.verified_at, 'clientCreatedAt', e.created_at,
      'serverReceivedAt', e.verified_at, 'revisionNo', 1,
      'createdByUserId', e.created_by_user_id, 'createdByName', e.created_by_name,
      'createdByPhone', e.created_by_phone, 'relationSourceType', 'rubber_export',
      'relationSourceId', e.id, 'relationSourceLocationId', e.location_id,
      'relationLabel', 'ส่งออกยาง',
      'relationLockReason', 'รายการนี้มาจากรายการส่งออกยาง ต้องเปิดหรือจัดการที่โมดูลส่งออกยางต้นทาง',
      'reportLockNo', public.report_lock_no(e)
    )) into v_result
    from public.rubber_exports e where e.id = p_source_id and e.location_id = p_location_id;

  elsif p_source_kind = 'rubber_daily' then
    select jsonb_strip_nulls(jsonb_build_object(
      'id', 'rubber-bill-daily-expense:' || p_location_id || ':' || p_source_date,
      'clientTempId', 'rubber-bill-daily-expense:' || p_location_id || ':' || p_source_date,
      'localBillNo', 'RB-' || to_char(p_source_date, 'YYMMDD'),
      'serverBillNo', 'RB-' || to_char(p_source_date, 'YYMMDD'),
      'idempotencyKey', 'rubber-bill-daily-expense:' || p_location_id || ':' || p_source_date,
      'locationId', p_location_id, 'syncStatus', 'synced', 'recordStatus', 'active',
      'type', 'expense', 'number', 'RB-' || to_char(p_source_date, 'YYMMDD'),
      'txDate', p_source_date, 'title', 'จ่ายค่ายางจากบิลยาง ' || count(*) || ' ใบ',
      'cost', sum(b.net_total), 'billOption', 'ค่าใช้จ่าย',
      'clientRecordedAt', max(coalesce(b.client_recorded_at, b.updated_at, b.created_at)),
      'clientCreatedAt', max(coalesce(b.client_recorded_at, b.updated_at, b.created_at)),
      'serverReceivedAt', max(b.updated_at), 'revisionNo', max(b.revision_no),
      'createdByUserId', '', 'createdByName', 'ระบบบิลยาง', 'createdByPhone', '',
      'relationSourceType', 'rubber_bill_daily', 'relationSourceId', p_source_date,
      'relationSourceLocationId', p_location_id, 'relationSourceDate', p_source_date,
      'relationLabel', 'บิลยางรวมรายวัน',
      'relationLockReason', 'รายการนี้มาจากบิลยาง ต้องแก้ไขหรือลบที่โมดูลบิลยางต้นทาง',
      'reportLockNo', max(public.report_lock_no(b))
    )) into v_result
    from public.rubber_bills b
    where b.location_id = p_location_id and b.bill_date = p_source_date
      and b.record_status = 'active' and b.net_total > 0
      and not exists (select 1 from public.money_transfer_items i
        where i.source_type = 'rubber_bill' and i.source_id = b.id);
  end if;

  return v_result;
end;
$$;

revoke all on function private.income_expense_operational_row(uuid, text, uuid, date)
  from public, anon, authenticated;

create or replace function public.get_income_expense_operational_feed(
  p_location_id uuid,
  p_mode text default 'latest',
  p_search text default '',
  p_cursor text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_search text := lower(regexp_replace(btrim(coalesce(p_search, '')), '\s+', ' ', 'g'));
  v_cursor jsonb;
  v_cursor_date date;
  v_cursor_key text;
  v_pending_count integer := 0;
begin
  if p_mode <> 'latest' or v_search <> '' then
    return public.get_income_expense_operational_feed_on_demand(
      p_location_id, p_mode, v_search, p_cursor
    );
  end if;

  if not private.is_active_user() or not private.can_access_location(p_location_id) then
    raise exception 'Location access denied';
  end if;

  if p_cursor is not null then
    begin
      if length(p_cursor) > 4096 or length(p_cursor) % 2 <> 0 or p_cursor !~ '^[0-9a-f]+$' then
        raise exception 'Invalid cursor';
      end if;
      v_cursor := convert_from(decode(p_cursor, 'hex'), 'utf8')::jsonb;
    exception when others then raise exception 'Invalid cursor'; end;
    if coalesce((v_cursor->>'v')::integer, 0) <> 1
      or v_cursor->>'locationId' is distinct from p_location_id::text
      or v_cursor->>'mode' is distinct from 'latest'
      or v_cursor->>'search' is distinct from ''
      or v_cursor->>'sort' is distinct from 'tx_date_desc'
    then raise exception 'Cursor scope mismatch'; end if;
    begin
      v_cursor_date := (v_cursor->>'date')::date;
      v_cursor_key := nullif(v_cursor->>'key', '');
      if v_cursor_key is null then raise exception 'Invalid cursor'; end if;
    exception when others then raise exception 'Invalid cursor'; end;
  end if;

  if private.can_access_super_admin_features() then
    select
      (select count(*) from public.income_expense_approval_requests r
       where r.location_id = p_location_id and r.request_status = 'pending')
      +
      (select count(*) from public.cash_transfer_delete_requests r
       where r.source_location_id = p_location_id and r.request_status = 'pending')
    into v_pending_count;
  end if;

  return (
    with candidates as (
      select * from (
        select 'actual'::text source_kind, ie.id source_id, null::date source_date,
          ie.tx_date sort_date, 'actual:' || ie.id::text sort_key
        from public.income_expense ie
        where ie.location_id = p_location_id and ie.record_status = 'active'
          and (v_cursor_date is null or (ie.tx_date, 'actual:' || ie.id::text) < (v_cursor_date, v_cursor_key))
        order by ie.tx_date desc, ('actual:' || ie.id::text) desc limit 101
      ) actual
      union all
      select * from (
        select 'branch_income', mt.id, null::date,
          (mt.created_at at time zone 'Asia/Bangkok')::date d, 'transfer-income:' || mt.id::text k
        from public.money_transfers mt
        where mt.transfer_type = 'branch' and mt.target_location_id = p_location_id
          and mt.record_status <> 'deleted' and mt.transfer_status <> 'cancelled' and mt.net_amount_to_pay > 0
          and (v_cursor_date is null or ((mt.created_at at time zone 'Asia/Bangkok')::date,
            'transfer-income:' || mt.id::text) < (v_cursor_date, v_cursor_key))
        order by d desc, k desc limit 101
      ) branch_income
      union all
      select * from (
        select 'branch_expense', mt.id, null::date,
          (mt.created_at at time zone 'Asia/Bangkok')::date d, 'transfer-expense:' || mt.id::text k
        from public.money_transfers mt
        where mt.transfer_type = 'branch' and mt.location_id = p_location_id
          and mt.target_location_id <> mt.location_id and mt.record_status <> 'deleted'
          and mt.transfer_status <> 'cancelled' and mt.net_amount_to_pay > 0
          and (v_cursor_date is null or ((mt.created_at at time zone 'Asia/Bangkok')::date,
            'transfer-expense:' || mt.id::text) < (v_cursor_date, v_cursor_key))
        order by d desc, k desc limit 101
      ) branch_expense
      union all
      select * from (
        select 'customer_branch_paid', mt.id, null::date,
          (mt.created_at at time zone 'Asia/Bangkok')::date d, 'customer-transfer-expense:' || mt.id::text k
        from public.money_transfers mt
        where mt.transfer_type = 'customer' and mt.transfer_status = 'branch_and_transfer'
          and mt.location_id = p_location_id and mt.record_status <> 'deleted' and mt.branch_paid_amount > 0
          and (v_cursor_date is null or ((mt.created_at at time zone 'Asia/Bangkok')::date,
            'customer-transfer-expense:' || mt.id::text) < (v_cursor_date, v_cursor_key))
        order by d desc, k desc limit 101
      ) customer_branch_paid
      union all
      select * from (
        select 'cash_expense', mt.id, null::date,
          (d.sent_at at time zone 'Asia/Bangkok')::date sd, 'cash-transfer-expense:' || mt.id::text k
        from public.money_transfers mt join public.money_transfer_cash_details d on d.transfer_id = mt.id
        where mt.transfer_type = 'cash' and mt.transfer_method = 'cash'
          and mt.location_id = p_location_id and mt.record_status <> 'deleted'
          and (v_cursor_date is null or ((d.sent_at at time zone 'Asia/Bangkok')::date,
            'cash-transfer-expense:' || mt.id::text) < (v_cursor_date, v_cursor_key))
        order by sd desc, k desc limit 101
      ) cash_expense
      union all
      select * from (
        select 'cash_income', mt.id, null::date,
          (d.received_at at time zone 'Asia/Bangkok')::date rd, 'cash-transfer-income:' || mt.id::text k
        from public.money_transfers mt join public.money_transfer_cash_details d on d.transfer_id = mt.id
        where mt.transfer_type = 'cash' and mt.transfer_method = 'cash'
          and mt.target_location_id = p_location_id and mt.record_status <> 'deleted'
          and d.cash_status = 'received' and d.received_at is not null
          and (v_cursor_date is null or ((d.received_at at time zone 'Asia/Bangkok')::date,
            'cash-transfer-income:' || mt.id::text) < (v_cursor_date, v_cursor_key))
        order by rd desc, k desc limit 101
      ) cash_income
      union all
      select * from (
        select 'withdrawal', ft.id, null::date,
          (ft.approved_at at time zone 'Asia/Bangkok')::date d, 'time-tracking-withdrawal:' || ft.id::text k
        from public.financial_transactions ft
        where ft.type = 'WITHDRAWAL' and ft.status = 'APPROVED' and ft.cancelled_at is null
          and ft.expense_location_id = p_location_id and ft.amount > 0
          and (v_cursor_date is null or ((ft.approved_at at time zone 'Asia/Bangkok')::date,
            'time-tracking-withdrawal:' || ft.id::text) < (v_cursor_date, v_cursor_key))
        order by d desc, k desc limit 101
      ) withdrawal
      union all
      select * from (
        select 'payroll', ps.id, null::date,
          (ps.approved_at at time zone 'Asia/Bangkok')::date d, 'payroll-slip:' || ps.id::text k
        from public.payroll_slips ps
        where ps.status = 'APPROVED' and ps.net_pay > 0 and ps.cancelled_at is null
          and ps.expense_location_id = p_location_id
          and (v_cursor_date is null or ((ps.approved_at at time zone 'Asia/Bangkok')::date,
            'payroll-slip:' || ps.id::text) < (v_cursor_date, v_cursor_key))
        order by d desc, k desc limit 101
      ) payroll
      union all
      select * from (
        select 'rubber_export', e.id, null::date,
          (e.verified_at at time zone 'Asia/Bangkok')::date d, 'rubber-export-expense:' || e.id::text k
        from public.rubber_exports e
        where e.location_id = p_location_id and e.status = 'verified'
          and e.expense_destination = 'branch' and e.work_total > 0
          and (v_cursor_date is null or ((e.verified_at at time zone 'Asia/Bangkok')::date,
            'rubber-export-expense:' || e.id::text) < (v_cursor_date, v_cursor_key))
        order by d desc, k desc limit 101
      ) rubber_export
      union all
      select * from (
        select 'rubber_daily', null::uuid, b.bill_date, b.bill_date d, 'rubber:' || b.bill_date::text k
        from public.rubber_bills b
        where b.location_id = p_location_id and b.record_status = 'active' and b.net_total > 0
          and not exists (select 1 from public.money_transfer_items i
            where i.source_type = 'rubber_bill' and i.source_id = b.id)
          and (v_cursor_date is null or (b.bill_date, 'rubber:' || b.bill_date::text) < (v_cursor_date, v_cursor_key))
        group by b.bill_date order by d desc, k desc limit 101
      ) rubber_daily
    ), page as (
      select * from candidates order by sort_date desc, sort_key desc limit 101
    ), numbered as (
      select *, row_number() over (order by sort_date desc, sort_key desc) row_no from page
    ), rows as (
      select n.*, private.income_expense_operational_row(
        p_location_id, n.source_kind, n.source_id, n.source_date
      ) row_data
      from numbered n where n.row_no <= 100
    )
    select jsonb_build_object(
      'rows', coalesce((select jsonb_agg(row_data order by sort_date desc, sort_key desc) from rows), '[]'::jsonb),
      'nextCursor', case when (select count(*) from numbered) > 100 then
        (select encode(convert_to(jsonb_build_object(
          'v', 1, 'locationId', p_location_id, 'mode', 'latest', 'search', '',
          'sort', 'tx_date_desc', 'date', sort_date, 'key', sort_key
        )::text, 'utf8'), 'hex') from numbered where row_no = 100)
        else null end,
      'hasMore', (select count(*) from numbered) > 100,
      'pendingApprovalCount', v_pending_count
    )
  );
end;
$$;

revoke all on function public.get_income_expense_operational_feed(uuid, text, text, text)
  from public, anon;
grant execute on function public.get_income_expense_operational_feed(uuid, text, text, text)
  to authenticated;

notify pgrst, 'reload schema';
