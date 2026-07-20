-- Cash-basis derived Income/Expense rows for approved Time Tracking sources.
-- This replaces the feed function without changing historical migrations.

create or replace function public.get_income_expense_feed(
  p_location_id uuid,
  p_from_date date,
  p_to_date date,
  p_cursor_date date default null,
  p_cursor_key text default null,
  p_page_size integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_page_size integer := least(greatest(coalesce(p_page_size, 100), 1), 100);
begin
  if not private.is_active_user() or not public.can_access_location(p_location_id) then
    raise exception 'Location access denied';
  end if;
  if p_from_date is null or p_to_date is null or p_from_date > p_to_date then
    raise exception 'Invalid date range';
  end if;

  return (
    with feed as (
      select ie.tx_date as sort_date, 'actual:' || ie.id::text as sort_key,
        jsonb_strip_nulls(jsonb_build_object(
          'id', ie.id, 'clientTempId', coalesce(ie.client_temp_id, ie.id::text),
          'localBillNo', ie.local_bill_no, 'serverBillNo', ie.server_bill_no,
          'idempotencyKey', coalesce(ie.idempotency_key, 'server:' || ie.id::text),
          'locationId', ie.location_id, 'syncStatus', 'synced', 'recordStatus', ie.record_status,
          'type', ie.type, 'number', coalesce(ie.number, ie.server_bill_no, ie.local_bill_no),
          'txDate', ie.tx_date, 'title', ie.title, 'cost', ie.cost, 'unit', ie.unit,
          'price', ie.price, 'incomeSaleItemId', ie.income_sale_item_id,
          'stockProductId', ie.stock_product_id, 'stockQuantity', ie.stock_quantity,
          'billOption', ie.bill_option, 'clientRecordedAt', coalesce(ie.client_recorded_at, ie.created_at),
          'clientCreatedAt', coalesce(ie.client_created_at, ie.created_at),
          'serverReceivedAt', ie.server_received_at, 'revisionNo', ie.revision_no,
          'createdByUserId', ie.created_by_user_id, 'createdByName', ie.created_by_name,
          'createdByPhone', ie.created_by_phone
        )) as row_data
      from public.income_expense ie
      where ie.location_id = p_location_id and ie.record_status = 'active'
        and ie.tx_date between p_from_date and p_to_date

      union all

      select mt.created_at::date, 'transfer-income:' || mt.id::text,
        jsonb_build_object(
          'id', 'money-transfer-income:' || mt.id, 'clientTempId', 'money-transfer-income:' || mt.id,
          'localBillNo', 'TR-' || left(mt.id::text, 8), 'serverBillNo', 'TR-' || left(mt.id::text, 8),
          'idempotencyKey', 'money-transfer:' || mt.id, 'locationId', mt.target_location_id,
          'syncStatus', 'synced', 'recordStatus', 'active', 'type', 'income',
          'number', 'TR-' || left(mt.id::text, 8), 'txDate', mt.created_at::date,
          'title', 'รับโอนจาก สาขาต้นทาง', 'cost', mt.net_amount_to_pay, 'billOption', 'รายรับ',
          'clientRecordedAt', mt.created_at, 'clientCreatedAt', mt.created_at,
          'serverReceivedAt', mt.updated_at, 'revisionNo', mt.revision_no,
          'createdByUserId', mt.created_by_user_id, 'createdByName', coalesce(mt.created_by_name, 'ระบบโอนเงิน'),
          'createdByPhone', mt.created_by_phone, 'relationSourceType', 'money_transfer',
          'relationSourceId', mt.id, 'relationSourceLocationId', mt.location_id,
          'relationLabel', case when mt.location_id = mt.target_location_id then 'โอนให้สาขา' else 'โอนเงินสาขา' end,
          'relationLockReason', 'รายการนี้มาจากการโอนเงินสาขา ต้องแก้ไขหรือลบที่โมดูลโอนเงินต้นทาง'
        )
      from public.money_transfers mt
      where mt.transfer_type = 'branch' and mt.target_location_id = p_location_id
        and mt.record_status <> 'deleted' and mt.transfer_status <> 'cancelled'
        and mt.net_amount_to_pay > 0 and mt.created_at::date between p_from_date and p_to_date

      union all

      select mt.created_at::date, 'transfer-expense:' || mt.id::text,
        jsonb_build_object(
          'id', 'money-transfer-branch-expense:' || mt.id, 'clientTempId', 'money-transfer-branch-expense:' || mt.id,
          'localBillNo', 'TR-' || left(mt.id::text, 8), 'serverBillNo', 'TR-' || left(mt.id::text, 8),
          'idempotencyKey', 'money-transfer-branch-expense:' || mt.id, 'locationId', mt.location_id,
          'syncStatus', 'synced', 'recordStatus', 'active', 'type', 'expense',
          'number', 'TR-' || left(mt.id::text, 8), 'txDate', mt.created_at::date,
          'title', 'โยกเงินไป ' || coalesce(mt.target_location_name, 'สาขาปลายทาง'),
          'cost', mt.net_amount_to_pay, 'billOption', 'ค่าใช้จ่าย',
          'clientRecordedAt', mt.created_at, 'clientCreatedAt', mt.created_at,
          'serverReceivedAt', mt.updated_at, 'revisionNo', mt.revision_no,
          'createdByUserId', mt.created_by_user_id, 'createdByName', coalesce(mt.created_by_name, 'ระบบโอนเงิน'),
          'createdByPhone', mt.created_by_phone, 'relationSourceType', 'money_transfer',
          'relationSourceId', mt.id, 'relationSourceLocationId', mt.location_id,
          'relationLabel', 'โอนเงินสาขา',
          'relationLockReason', 'รายการนี้มาจากการโอนเงินสาขา ต้องแก้ไขหรือลบที่โมดูลโอนเงินต้นทาง'
        )
      from public.money_transfers mt
      where mt.transfer_type = 'branch' and mt.location_id = p_location_id
        and mt.target_location_id <> mt.location_id and mt.record_status <> 'deleted'
        and mt.transfer_status <> 'cancelled' and mt.net_amount_to_pay > 0
        and mt.created_at::date between p_from_date and p_to_date

      union all

      select mt.created_at::date, 'customer-transfer-expense:' || mt.id::text,
        jsonb_build_object(
          'id', 'money-transfer-branch-paid-expense:' || mt.id, 'clientTempId', 'money-transfer-branch-paid-expense:' || mt.id,
          'localBillNo', 'CT-' || left(mt.id::text, 8), 'serverBillNo', 'CT-' || left(mt.id::text, 8),
          'idempotencyKey', 'money-transfer-branch-paid:' || mt.id, 'locationId', mt.location_id,
          'syncStatus', 'synced', 'recordStatus', 'active', 'type', 'expense',
          'number', 'CT-' || left(mt.id::text, 8), 'txDate', mt.created_at::date,
          'title', 'สาขาจ่ายส่วนต่างให้ ' || coalesce(mt.customer_name, 'ลูกค้า'),
          'cost', mt.branch_paid_amount, 'billOption', 'ค่าใช้จ่าย',
          'clientRecordedAt', mt.created_at, 'clientCreatedAt', mt.created_at,
          'serverReceivedAt', mt.updated_at, 'revisionNo', mt.revision_no,
          'createdByUserId', mt.created_by_user_id, 'createdByName', coalesce(mt.created_by_name, 'ระบบโอนเงิน'),
          'createdByPhone', mt.created_by_phone, 'relationSourceType', 'money_transfer',
          'relationSourceId', mt.id, 'relationSourceLocationId', mt.location_id,
          'relationLabel', 'โอน+สาขาจ่าย',
          'relationLockReason', 'รายการนี้มาจากโอนเงินลูกค้าแบบโอน+สาขาจ่าย ต้องแก้ไขหรือลบที่โมดูลโอนเงินลูกค้าต้นทาง'
        )
      from public.money_transfers mt
      where mt.transfer_type = 'customer' and mt.transfer_status = 'branch_and_transfer'
        and mt.location_id = p_location_id and mt.record_status <> 'deleted'
        and mt.branch_paid_amount > 0 and mt.created_at::date between p_from_date and p_to_date

      union all

      select (ft.approved_at at time zone 'Asia/Bangkok')::date, 'time-tracking-withdrawal:' || ft.id::text,
        jsonb_build_object(
          'id', 'time-tracking-withdrawal:' || ft.id, 'clientTempId', 'time-tracking-withdrawal:' || ft.id,
          'localBillNo', 'TW-' || left(ft.id::text, 8), 'serverBillNo', 'TW-' || left(ft.id::text, 8),
          'idempotencyKey', 'time-tracking-withdrawal:' || ft.id, 'locationId', ft.expense_location_id,
          'syncStatus', 'synced', 'recordStatus', 'active', 'type', 'expense',
          'number', 'TW-' || left(ft.id::text, 8), 'txDate', (ft.approved_at at time zone 'Asia/Bangkok')::date,
          'title', 'เบิกเงิน — ' || coalesce(p.name, 'พนักงาน') || coalesce(' — ' || nullif(ft.description, ''), ''),
          'cost', ft.amount, 'billOption', 'ค่าใช้จ่าย',
          'clientRecordedAt', ft.approved_at, 'clientCreatedAt', ft.created_at,
          'serverReceivedAt', ft.updated_at, 'revisionNo', 1,
          'createdByUserId', ft.profile_id, 'createdByName', coalesce(p.name, 'พนักงาน'), 'createdByPhone', '',
          'relationSourceType', 'time_tracking_withdrawal', 'relationSourceId', ft.id,
          'relationSourceLocationId', ft.expense_location_id, 'relationLabel', 'เบิกเงิน',
          'relationLockReason', 'รายการนี้มาจากการเบิกเงินที่อนุมัติแล้ว ต้องแก้ไขสาขาหรือยกเลิกที่โมดูลลงเวลาต้นทาง'
        )
      from public.financial_transactions ft
      join public.profiles p on p.id = ft.profile_id
      where ft.type = 'WITHDRAWAL' and ft.status = 'APPROVED'
        and ft.cancelled_at is null and ft.expense_location_id = p_location_id and ft.amount > 0
        and (ft.approved_at at time zone 'Asia/Bangkok')::date between p_from_date and p_to_date

      union all

      select (ps.approved_at at time zone 'Asia/Bangkok')::date, 'payroll-slip:' || ps.id::text,
        jsonb_build_object(
          'id', 'payroll-slip:' || ps.id, 'clientTempId', 'payroll-slip:' || ps.id,
          'localBillNo', 'PS-' || left(ps.id::text, 8), 'serverBillNo', 'PS-' || left(ps.id::text, 8),
          'idempotencyKey', 'payroll-slip:' || ps.id, 'locationId', ps.expense_location_id,
          'syncStatus', 'synced', 'recordStatus', 'active', 'type', 'expense',
          'number', 'PS-' || left(ps.id::text, 8), 'txDate', (ps.approved_at at time zone 'Asia/Bangkok')::date,
          'title', 'เงินเดือน — ' || coalesce(p.name, 'พนักงาน') || ' — ' || ps.month,
          'cost', ps.net_pay, 'billOption', 'ค่าใช้จ่าย',
          'clientRecordedAt', ps.approved_at, 'clientCreatedAt', ps.created_at,
          'serverReceivedAt', ps.updated_at, 'revisionNo', 1,
          'createdByUserId', ps.profile_id, 'createdByName', coalesce(p.name, 'พนักงาน'), 'createdByPhone', '',
          'relationSourceType', 'payroll_slip', 'relationSourceId', ps.id,
          'relationSourceLocationId', ps.expense_location_id, 'relationLabel', 'เงินเดือน',
          'relationLockReason', 'รายการนี้มาจากเงินเดือนที่อนุมัติแล้ว ต้องแก้ไขสาขาหรือยกเลิกที่โมดูลลงเวลาต้นทาง'
        )
      from public.payroll_slips ps
      join public.profiles p on p.id = ps.profile_id
      where ps.status = 'APPROVED' and ps.net_pay > 0 and ps.cancelled_at is null
        and ps.expense_location_id = p_location_id
        and (ps.approved_at at time zone 'Asia/Bangkok')::date between p_from_date and p_to_date

      union all

      select rb.bill_date, 'rubber:' || rb.bill_date::text,
        jsonb_build_object(
          'id', 'rubber-bill-daily-expense:' || p_location_id || ':' || rb.bill_date,
          'clientTempId', 'rubber-bill-daily-expense:' || p_location_id || ':' || rb.bill_date,
          'localBillNo', 'RB-' || to_char(rb.bill_date, 'YYMMDD'), 'serverBillNo', 'RB-' || to_char(rb.bill_date, 'YYMMDD'),
          'idempotencyKey', 'rubber-bill-daily-expense:' || p_location_id || ':' || rb.bill_date,
          'locationId', p_location_id, 'syncStatus', 'synced', 'recordStatus', 'active', 'type', 'expense',
          'number', 'RB-' || to_char(rb.bill_date, 'YYMMDD'), 'txDate', rb.bill_date,
          'title', 'จ่ายค่ายางจากบิลยาง ' || rb.bill_count || ' ใบ', 'cost', rb.total,
          'billOption', 'ค่าใช้จ่าย', 'clientRecordedAt', rb.recorded_at, 'clientCreatedAt', rb.recorded_at,
          'serverReceivedAt', rb.updated_at, 'revisionNo', rb.revision_no,
          'createdByUserId', '', 'createdByName', 'ระบบบิลยาง', 'createdByPhone', '',
          'relationSourceType', 'rubber_bill_daily', 'relationSourceId', rb.bill_date,
          'relationSourceLocationId', p_location_id, 'relationSourceDate', rb.bill_date,
          'relationLabel', 'บิลยางรวมรายวัน',
          'relationLockReason', 'รายการนี้มาจากบิลยาง ต้องแก้ไขหรือลบที่โมดูลบิลยางต้นทาง'
        )
      from (
        select bill_date, sum(net_total) as total, count(*) as bill_count,
          max(coalesce(client_recorded_at, updated_at, created_at)) as recorded_at,
          max(updated_at) as updated_at, max(revision_no) as revision_no
        from public.rubber_bills rb
        where rb.location_id = p_location_id and rb.record_status = 'active' and rb.net_total > 0
          and rb.bill_date between p_from_date and p_to_date
          and not exists (select 1 from public.money_transfer_items i where i.source_type = 'rubber_bill' and i.source_id = rb.id)
        group by bill_date
      ) rb

      union all

      select ot.date_in, 'ocr:' || ot.date_in::text,
        jsonb_build_object(
          'id', 'ocr-ticket-daily-expense:' || p_location_id || ':' || ot.date_in,
          'clientTempId', 'ocr-ticket-daily-expense:' || p_location_id || ':' || ot.date_in,
          'localBillNo', 'OCR-' || to_char(ot.date_in, 'YYMMDD'), 'serverBillNo', 'OCR-' || to_char(ot.date_in, 'YYMMDD'),
          'idempotencyKey', 'ocr-ticket-daily-expense:' || p_location_id || ':' || ot.date_in,
          'locationId', p_location_id, 'syncStatus', 'synced', 'recordStatus', 'active', 'type', 'expense',
          'number', 'OCR-' || to_char(ot.date_in, 'YYMMDD'), 'txDate', ot.date_in,
          'title', 'จ่ายค่ายางจาก OCR บิลยาง ' || ot.ticket_count || ' ใบ', 'cost', ot.total,
          'billOption', 'ค่าใช้จ่าย', 'clientRecordedAt', ot.recorded_at, 'clientCreatedAt', ot.recorded_at,
          'serverReceivedAt', ot.updated_at, 'revisionNo', ot.revision_no,
          'createdByUserId', '', 'createdByName', 'ระบบ OCR บิลยาง', 'createdByPhone', '',
          'relationSourceType', 'ocr_ticket_daily', 'relationSourceId', ot.date_in,
          'relationSourceLocationId', p_location_id, 'relationSourceDate', ot.date_in,
          'relationLabel', 'OCR บิลยางรวมรายวัน',
          'relationLockReason', 'รายการนี้มาจาก OCR บิลยาง ต้องแก้ไขหรือลบที่โมดูล OCR บิลยางต้นทาง'
        )
      from (
        select date_in, sum(total_amount) as total, count(*) as ticket_count,
          max(coalesce(client_recorded_at, updated_at, created_at)) as recorded_at,
          max(updated_at) as updated_at, max(revision_no) as revision_no
        from public.ocr_tickets ot
        where ot.location_id = p_location_id and ot.record_status = 'active' and ot.total_amount > 0
          and ot.date_in between p_from_date and p_to_date
          and not exists (select 1 from public.money_transfer_items i where i.source_type = 'ocr_ticket' and i.source_id = ot.id)
        group by date_in
      ) ot
    ), filtered as (
      select *, row_number() over (order by sort_date desc, sort_key desc) as row_no
      from feed
      where p_cursor_date is null or (sort_date, sort_key) < (p_cursor_date, p_cursor_key)
    ), page as (
      select * from filtered where row_no <= v_page_size + 1
    )
    select jsonb_build_object(
      'rows', coalesce((select jsonb_agg(row_data order by sort_date desc, sort_key desc) from page where row_no <= v_page_size), '[]'::jsonb),
      'nextCursor', case when (select count(*) from page) > v_page_size then
        encode(convert_to((select sort_date::text || '|' || sort_key from page where row_no = v_page_size), 'utf8'), 'base64')
      else null end
    )
  );
end;
$$;

revoke all on function public.get_income_expense_feed(uuid, date, date, date, text, integer) from public, anon;
grant execute on function public.get_income_expense_feed(uuid, date, date, date, text, integer) to authenticated;
