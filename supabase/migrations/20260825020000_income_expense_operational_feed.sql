-- Bounded operational reads for Income/Expense and cash branch transfers.
-- This is an additive read-model cutover; no business rows or write lifecycles change.

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
  v_can_manage boolean := private.can_access_super_admin_features();
  v_pending_count integer := 0;
  v_cursor jsonb;
  v_cursor_date date;
  v_cursor_at timestamptz;
  v_cursor_key text;
begin
  if not private.is_active_user() or not private.can_access_location(p_location_id) then
    raise exception 'Location access denied';
  end if;
  if p_mode not in ('latest', 'pending_approval') then
    raise exception 'Invalid feed mode';
  end if;
  if length(v_search) > 200 then
    raise exception 'Invalid search';
  end if;
  if p_mode = 'pending_approval' and not coalesce(v_can_manage, false) then
    raise exception 'Approval access denied';
  end if;

  if p_cursor is not null then
    begin
      if length(p_cursor) > 4096
        or length(p_cursor) % 2 <> 0
        or p_cursor !~ '^[0-9a-f]+$'
      then
        raise exception 'Invalid cursor';
      end if;
      v_cursor := convert_from(decode(p_cursor, 'hex'), 'utf8')::jsonb;
    exception when others then
      raise exception 'Invalid cursor';
    end;

    if coalesce((v_cursor->>'v')::integer, 0) <> 1
      or v_cursor->>'locationId' is distinct from p_location_id::text
      or v_cursor->>'mode' is distinct from p_mode
      or v_cursor->>'search' is distinct from v_search
      or v_cursor->>'sort' is distinct from
        (case when p_mode = 'latest' then 'tx_date_desc' else 'requested_at_asc' end)
    then
      raise exception 'Cursor scope mismatch';
    end if;

    begin
      v_cursor_key := nullif(v_cursor->>'key', '');
      if p_mode = 'latest' then
        v_cursor_date := (v_cursor->>'date')::date;
      else
        v_cursor_at := (v_cursor->>'at')::timestamptz;
      end if;
      if v_cursor_key is null then raise exception 'Invalid cursor'; end if;
    exception when others then
      raise exception 'Invalid cursor';
    end;
  end if;

  if coalesce(v_can_manage, false) then
    select
      (select count(*) from public.income_expense_approval_requests r
       where r.location_id = p_location_id and r.request_status = 'pending')
      +
      (select count(*) from public.cash_transfer_delete_requests r
       where r.source_location_id = p_location_id and r.request_status = 'pending')
    into v_pending_count;
  end if;

  if p_mode = 'pending_approval' then
    return (
      with candidates as (
        select
          r.created_at as sort_at,
          'income:' || r.id::text as sort_key,
          lower(regexp_replace(concat_ws(' ',
            coalesce(r.requested_payload->>'number', r.requested_payload->>'serverBillNo', r.requested_payload->>'localBillNo'),
            coalesce(r.requested_payload->>'txDate', (r.created_at at time zone 'Asia/Bangkok')::date::text),
            r.title, coalesce(r.requested_payload->>'billOption', r.tx_type),
            r.requested_by_name, r.requested_by_phone
          ), '\s+', ' ', 'g')) as search_text,
          jsonb_strip_nulls(jsonb_build_object(
            'id', 'approval-income:' || r.id,
            'clientTempId', coalesce(r.requested_payload->>'clientTempId', r.id::text),
            'localBillNo', coalesce(r.requested_payload->>'localBillNo', 'REQ-' || left(r.id::text, 8)),
            'serverBillNo', r.requested_payload->>'serverBillNo',
            'idempotencyKey', r.request_idempotency_key,
            'locationId', r.location_id,
            'syncStatus', 'pending', 'recordStatus', 'active',
            'type', r.tx_type,
            'number', coalesce(r.requested_payload->>'number', r.requested_payload->>'serverBillNo', r.requested_payload->>'localBillNo', 'REQ-' || left(r.id::text, 8)),
            'txDate', case when coalesce(r.requested_payload->>'txDate', '') ~ '^\d{4}-\d{2}-\d{2}$'
              then r.requested_payload->>'txDate'
              else (r.created_at at time zone 'Asia/Bangkok')::date::text end,
            'title', r.title, 'cost', r.cost,
            'billOption', coalesce(r.requested_payload->>'billOption', case when r.tx_type = 'income' then 'รายรับ' else 'ค่าใช้จ่าย' end),
            'clientRecordedAt', coalesce(r.requested_payload->>'clientRecordedAt', r.created_at::text),
            'clientCreatedAt', coalesce(r.requested_payload->>'clientCreatedAt', r.created_at::text),
            'serverReceivedAt', r.created_at,
            'revisionNo', coalesce((r.requested_payload->>'expectedRevisionNo')::integer, 0),
            'createdByUserId', r.requested_by_user_id,
            'createdByName', r.requested_by_name,
            'createdByPhone', r.requested_by_phone,
            'approvalPending', true,
            'approvalRequestId', r.id,
            'approvalRequestType', 'income_expense',
            'approvalOperation', r.requested_operation,
            'approvalReasons', to_jsonb(r.matched_reasons)
          )) as row_data
        from public.income_expense_approval_requests r
        where r.location_id = p_location_id and r.request_status = 'pending'

        union all

        select
          r.created_at,
          'cash-delete:' || r.id::text,
          lower(regexp_replace(concat_ws(' ', r.transfer_display_no,
            (r.created_at at time zone 'Asia/Bangkok')::date::text,
            'ลบรายการโยกเงินสด', r.source_location_name, r.target_location_name,
            r.requested_by_name, r.requested_by_phone
          ), '\s+', ' ', 'g')),
          jsonb_strip_nulls(jsonb_build_object(
            'id', 'approval-cash-delete:' || r.id,
            'clientTempId', 'approval-cash-delete:' || r.id,
            'localBillNo', r.transfer_display_no,
            'serverBillNo', r.transfer_display_no,
            'idempotencyKey', 'approval-cash-delete:' || r.id,
            'locationId', r.source_location_id,
            'syncStatus', 'pending', 'recordStatus', 'active',
            'type', 'expense', 'number', r.transfer_display_no,
            'txDate', (r.created_at at time zone 'Asia/Bangkok')::date,
            'title', 'คำขอลบรายการโยกเงินสด — ' || r.source_location_name || ' → ' || r.target_location_name,
            'cost', r.sent_total, 'billOption', 'ค่าใช้จ่าย',
            'clientRecordedAt', r.created_at, 'clientCreatedAt', r.created_at,
            'serverReceivedAt', r.updated_at, 'revisionNo', 0,
            'createdByUserId', r.requested_by_user_id,
            'createdByName', r.requested_by_name,
            'createdByPhone', r.requested_by_phone,
            'relationSourceType', 'money_transfer',
            'relationSourceId', case when r.transfer_id is null then null else 'cash:' || r.transfer_id end,
            'relationSourceLocationId', r.source_location_id,
            'relationLabel', 'รอตรวจคำขอลบ',
            'relationLockReason', 'รายการนี้เป็นคำขอลบการโยกเงินสด ต้องตรวจคำขอก่อนดำเนินการ',
            'approvalPending', true,
            'approvalRequestId', r.id,
            'approvalRequestType', 'cash_transfer_delete',
            'approvalOperation', 'delete',
            'approvalReasons', '[]'::jsonb
          ))
        from public.cash_transfer_delete_requests r
        where r.source_location_id = p_location_id and r.request_status = 'pending'
      ), page as (
        select *
        from candidates c
        where (v_search = '' or position(v_search in c.search_text) > 0)
          and (v_cursor_at is null or (c.sort_at, c.sort_key) > (v_cursor_at, v_cursor_key))
        order by c.sort_at asc, c.sort_key asc
        limit 101
      ), numbered as (
        select *, row_number() over (order by sort_at asc, sort_key asc) as row_no
        from page
      )
      select jsonb_build_object(
        'rows', coalesce((select jsonb_agg(row_data order by sort_at asc, sort_key asc)
          from numbered where row_no <= 100), '[]'::jsonb),
        'nextCursor', case when (select count(*) from numbered) > 100 then
          (select encode(convert_to(jsonb_build_object(
            'v', 1, 'locationId', p_location_id, 'mode', p_mode, 'search', v_search,
            'sort', 'requested_at_asc', 'at', sort_at, 'key', sort_key
          )::text, 'utf8'), 'hex') from numbered where row_no = 100)
          else null end,
        'hasMore', (select count(*) from numbered) > 100,
        'pendingApprovalCount', v_pending_count
      )
    );
  end if;

  return (
    with candidates as (
      select
        ie.tx_date as sort_date,
        'actual:' || ie.id::text as sort_key,
        lower(regexp_replace(concat_ws(' ', ie.number, ie.server_bill_no, ie.local_bill_no,
          ie.tx_date::text, ie.title, ie.bill_option, ie.type::text,
          ie.created_by_name, ie.created_by_phone
        ), '\s+', ' ', 'g')) as search_text,
        jsonb_strip_nulls(jsonb_build_object(
          'id', ie.id, 'clientTempId', coalesce(ie.client_temp_id, ie.id::text),
          'localBillNo', ie.local_bill_no, 'serverBillNo', ie.server_bill_no,
          'idempotencyKey', coalesce(ie.idempotency_key, 'server:' || ie.id::text),
          'locationId', ie.location_id, 'syncStatus', 'synced', 'recordStatus', ie.record_status,
          'type', ie.type, 'number', coalesce(ie.number, ie.server_bill_no, ie.local_bill_no),
          'txDate', ie.tx_date, 'title', ie.title, 'cost', ie.cost,
          'unit', ie.unit, 'price', ie.price,
          'incomeSaleItemId', ie.income_sale_item_id,
          'stockProductId', ie.stock_product_id, 'stockQuantity', ie.stock_quantity,
          'billOption', ie.bill_option,
          'clientRecordedAt', coalesce(ie.client_recorded_at, ie.created_at),
          'clientCreatedAt', coalesce(ie.client_created_at, ie.created_at),
          'serverReceivedAt', ie.server_received_at, 'revisionNo', ie.revision_no,
          'createdByUserId', ie.created_by_user_id,
          'createdByName', ie.created_by_name, 'createdByPhone', ie.created_by_phone,
          'saleLineCount', (select count(*) from public.income_expense_sale_lines l where l.income_expense_id = ie.id),
          'reportLockNo', public.report_lock_no(ie),
          'relationLockReason', case when public.report_lock_no(ie) is not null
            then 'ล็อกโดยรายงาน ' || public.report_lock_no(ie) || ' — ต้องลบรายงานล่าสุดตามลำดับก่อน' end
        )) as row_data
      from public.income_expense ie
      where ie.location_id = p_location_id and ie.record_status = 'active'

      union all

      select
        (mt.created_at at time zone 'Asia/Bangkok')::date,
        'transfer-income:' || mt.id,
        lower(regexp_replace(concat_ws(' ', 'TR-' || left(mt.id::text, 8),
          (mt.created_at at time zone 'Asia/Bangkok')::date::text,
          'รับโอนจาก', source_location.name, 'รายรับ', mt.created_by_name, mt.created_by_phone
        ), '\s+', ' ', 'g')),
        jsonb_strip_nulls(jsonb_build_object(
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
        ))
      from public.money_transfers mt
      left join public.locations source_location on source_location.id = mt.location_id
      where mt.transfer_type = 'branch' and mt.target_location_id = p_location_id
        and mt.record_status <> 'deleted' and mt.transfer_status <> 'cancelled'
        and mt.net_amount_to_pay > 0

      union all

      select
        (mt.created_at at time zone 'Asia/Bangkok')::date,
        'transfer-expense:' || mt.id,
        lower(regexp_replace(concat_ws(' ', 'TR-' || left(mt.id::text, 8),
          (mt.created_at at time zone 'Asia/Bangkok')::date::text,
          'โยกเงินไป', mt.target_location_name, 'ค่าใช้จ่าย', mt.created_by_name, mt.created_by_phone
        ), '\s+', ' ', 'g')),
        jsonb_strip_nulls(jsonb_build_object(
          'id', 'money-transfer-branch-expense:' || mt.id, 'clientTempId', 'money-transfer-branch-expense:' || mt.id,
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
        ))
      from public.money_transfers mt
      where mt.transfer_type = 'branch' and mt.location_id = p_location_id
        and mt.target_location_id <> mt.location_id and mt.record_status <> 'deleted'
        and mt.transfer_status <> 'cancelled' and mt.net_amount_to_pay > 0

      union all

      select
        (mt.created_at at time zone 'Asia/Bangkok')::date,
        'customer-transfer-expense:' || mt.id,
        lower(regexp_replace(concat_ws(' ', 'CT-' || left(mt.id::text, 8),
          (mt.created_at at time zone 'Asia/Bangkok')::date::text,
          'สาขาจ่ายส่วนต่างให้', mt.customer_name, 'ค่าใช้จ่าย', mt.created_by_name, mt.created_by_phone
        ), '\s+', ' ', 'g')),
        jsonb_strip_nulls(jsonb_build_object(
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
        ))
      from public.money_transfers mt
      where mt.transfer_type = 'customer' and mt.transfer_status = 'branch_and_transfer'
        and mt.location_id = p_location_id and mt.record_status <> 'deleted'
        and mt.branch_paid_amount > 0

      union all

      select
        (d.sent_at at time zone 'Asia/Bangkok')::date,
        'cash-transfer-expense:' || mt.id,
        lower(regexp_replace(concat_ws(' ', 'CASH-' || left(mt.id::text, 8),
          (d.sent_at at time zone 'Asia/Bangkok')::date::text,
          'โยกเงินสดไป', mt.target_location_name, 'ค่าใช้จ่าย', mt.created_by_name, mt.created_by_phone
        ), '\s+', ' ', 'g')),
        jsonb_strip_nulls(jsonb_build_object(
          'id', 'cash-transfer-expense:' || mt.id, 'clientTempId', 'cash-transfer-expense:' || mt.id,
          'localBillNo', 'CASH-' || left(mt.id::text, 8), 'serverBillNo', 'CASH-' || left(mt.id::text, 8),
          'idempotencyKey', 'cash-transfer-expense:' || mt.id, 'locationId', mt.location_id,
          'syncStatus', 'synced', 'recordStatus', 'active', 'type', 'expense',
          'number', 'CASH-' || left(mt.id::text, 8),
          'txDate', (d.sent_at at time zone 'Asia/Bangkok')::date,
          'title', 'โยกเงินสดไป ' || coalesce(mt.target_location_name, 'สาขาปลายทาง'),
          'cost', d.sent_total, 'billOption', 'ค่าใช้จ่าย',
          'clientRecordedAt', d.sent_at, 'clientCreatedAt', d.sent_at,
          'serverReceivedAt', d.updated_at, 'revisionNo', mt.revision_no,
          'createdByUserId', mt.created_by_user_id, 'createdByName', mt.created_by_name,
          'createdByPhone', mt.created_by_phone, 'relationSourceType', 'money_transfer',
          'relationSourceId', 'cash:' || mt.id, 'relationSourceLocationId', mt.location_id,
          'relationLabel', case when d.cash_status = 'pending_receipt' then 'รอรับเงิน'
            when coalesce(d.difference_total, 0) <> 0 then 'รับเงินแล้ว · ผลต่าง ' || d.difference_total::text
            else 'รับเงินแล้ว' end,
          'relationLockReason', 'รายการนี้มาจากการโยกเงินสด ต้องเปิดรายละเอียดเพื่อดูข้อมูล',
          'reportLockNo', public.report_lock_no(mt),
          'cashStatus', d.cash_status,
          'cashSourceLocationLabel', source_location.name
        ))
      from public.money_transfers mt
      join public.money_transfer_cash_details d on d.transfer_id = mt.id
      left join public.locations source_location on source_location.id = mt.location_id
      where mt.transfer_type = 'cash' and mt.transfer_method = 'cash'
        and mt.location_id = p_location_id and mt.record_status <> 'deleted'

      union all

      select
        (d.received_at at time zone 'Asia/Bangkok')::date,
        'cash-transfer-income:' || mt.id,
        lower(regexp_replace(concat_ws(' ', 'CASH-' || left(mt.id::text, 8),
          (d.received_at at time zone 'Asia/Bangkok')::date::text,
          'รับโอนเงินสดจาก', source_location.name, 'รายรับ', mt.created_by_name, mt.created_by_phone
        ), '\s+', ' ', 'g')),
        jsonb_strip_nulls(jsonb_build_object(
          'id', 'cash-transfer-income:' || mt.id, 'clientTempId', 'cash-transfer-income:' || mt.id,
          'localBillNo', 'CASH-' || left(mt.id::text, 8), 'serverBillNo', 'CASH-' || left(mt.id::text, 8),
          'idempotencyKey', 'cash-transfer-income:' || mt.id, 'locationId', mt.target_location_id,
          'syncStatus', 'synced', 'recordStatus', 'active', 'type', 'income',
          'number', 'CASH-' || left(mt.id::text, 8),
          'txDate', (d.received_at at time zone 'Asia/Bangkok')::date,
          'title', 'รับโอนเงินสดจาก ' || coalesce(source_location.name, 'สาขาต้นทาง'),
          'cost', d.received_total, 'billOption', 'รายรับ',
          'clientRecordedAt', d.received_at, 'clientCreatedAt', d.received_at,
          'serverReceivedAt', d.updated_at, 'revisionNo', mt.revision_no,
          'createdByUserId', mt.created_by_user_id, 'createdByName', mt.created_by_name,
          'createdByPhone', mt.created_by_phone, 'relationSourceType', 'money_transfer',
          'relationSourceId', 'cash:' || mt.id, 'relationSourceLocationId', mt.location_id,
          'relationLabel', case when coalesce(d.difference_total, 0) <> 0
            then 'รับเงินแล้ว · ผลต่าง ' || d.difference_total::text else 'รับเงินแล้ว' end,
          'relationLockReason', 'รายการนี้มาจากการโยกเงินสด ต้องเปิดรายละเอียดเพื่อดูข้อมูล',
          'reportLockNo', public.report_lock_no(mt),
          'cashStatus', d.cash_status,
          'cashSourceLocationLabel', source_location.name
        ))
      from public.money_transfers mt
      join public.money_transfer_cash_details d on d.transfer_id = mt.id
      left join public.locations source_location on source_location.id = mt.location_id
      where mt.transfer_type = 'cash' and mt.transfer_method = 'cash'
        and mt.target_location_id = p_location_id and mt.record_status <> 'deleted'
        and d.cash_status = 'received' and d.received_at is not null

      union all

      select
        (ft.approved_at at time zone 'Asia/Bangkok')::date,
        'time-tracking-withdrawal:' || ft.id,
        lower(regexp_replace(concat_ws(' ', 'TW-' || left(ft.id::text, 8),
          (ft.approved_at at time zone 'Asia/Bangkok')::date::text,
          'เบิกเงิน', profile.name, ft.description, 'ค่าใช้จ่าย', profile.phone
        ), '\s+', ' ', 'g')),
        jsonb_strip_nulls(jsonb_build_object(
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
        ))
      from public.financial_transactions ft
      join public.profiles profile on profile.id = ft.profile_id
      where ft.type = 'WITHDRAWAL' and ft.status = 'APPROVED'
        and ft.cancelled_at is null and ft.expense_location_id = p_location_id and ft.amount > 0

      union all

      select
        (ps.approved_at at time zone 'Asia/Bangkok')::date,
        'payroll-slip:' || ps.id,
        lower(regexp_replace(concat_ws(' ', 'PS-' || left(ps.id::text, 8),
          (ps.approved_at at time zone 'Asia/Bangkok')::date::text,
          'เงินเดือน', profile.name, ps.month, 'ค่าใช้จ่าย', profile.phone
        ), '\s+', ' ', 'g')),
        jsonb_strip_nulls(jsonb_build_object(
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
        ))
      from public.payroll_slips ps
      join public.profiles profile on profile.id = ps.profile_id
      where ps.status = 'APPROVED' and ps.net_pay > 0 and ps.cancelled_at is null
        and ps.expense_location_id = p_location_id

      union all

      select
        (e.verified_at at time zone 'Asia/Bangkok')::date,
        'rubber-export-expense:' || e.id,
        lower(regexp_replace(concat_ws(' ', e.export_no,
          (e.verified_at at time zone 'Asia/Bangkok')::date::text,
          'ค่าทำงานส่งออกยาง', 'ค่าใช้จ่าย', e.created_by_name, e.created_by_phone
        ), '\s+', ' ', 'g')),
        jsonb_strip_nulls(jsonb_build_object(
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
        ))
      from public.rubber_exports e
      where e.location_id = p_location_id and e.status = 'verified'
        and e.expense_destination = 'branch' and e.work_total > 0

      union all

      select
        rb.bill_date,
        'rubber:' || rb.bill_date::text,
        lower(regexp_replace(concat_ws(' ', 'RB-' || to_char(rb.bill_date, 'YYMMDD'),
          rb.bill_date::text, 'จ่ายค่ายางจากบิลยาง', 'ค่าใช้จ่าย', 'ระบบบิลยาง'
        ), '\s+', ' ', 'g')),
        jsonb_strip_nulls(jsonb_build_object(
          'id', 'rubber-bill-daily-expense:' || p_location_id || ':' || rb.bill_date,
          'clientTempId', 'rubber-bill-daily-expense:' || p_location_id || ':' || rb.bill_date,
          'localBillNo', 'RB-' || to_char(rb.bill_date, 'YYMMDD'),
          'serverBillNo', 'RB-' || to_char(rb.bill_date, 'YYMMDD'),
          'idempotencyKey', 'rubber-bill-daily-expense:' || p_location_id || ':' || rb.bill_date,
          'locationId', p_location_id, 'syncStatus', 'synced', 'recordStatus', 'active',
          'type', 'expense', 'number', 'RB-' || to_char(rb.bill_date, 'YYMMDD'),
          'txDate', rb.bill_date,
          'title', 'จ่ายค่ายางจากบิลยาง ' || rb.bill_count || ' ใบ',
          'cost', rb.total, 'billOption', 'ค่าใช้จ่าย',
          'clientRecordedAt', rb.recorded_at, 'clientCreatedAt', rb.recorded_at,
          'serverReceivedAt', rb.updated_at, 'revisionNo', rb.revision_no,
          'createdByUserId', '', 'createdByName', 'ระบบบิลยาง', 'createdByPhone', '',
          'relationSourceType', 'rubber_bill_daily', 'relationSourceId', rb.bill_date,
          'relationSourceLocationId', p_location_id, 'relationSourceDate', rb.bill_date,
          'relationLabel', 'บิลยางรวมรายวัน',
          'relationLockReason', 'รายการนี้มาจากบิลยาง ต้องแก้ไขหรือลบที่โมดูลบิลยางต้นทาง',
          'reportLockNo', rb.report_lock_no
        ))
      from (
        select b.bill_date, sum(b.net_total) as total, count(*) as bill_count,
          max(coalesce(b.client_recorded_at, b.updated_at, b.created_at)) as recorded_at,
          max(b.updated_at) as updated_at, max(b.revision_no) as revision_no,
          max(public.report_lock_no(b)) as report_lock_no
        from public.rubber_bills b
        where b.location_id = p_location_id and b.record_status = 'active' and b.net_total > 0
          and not exists (
            select 1 from public.money_transfer_items i
            where i.source_type = 'rubber_bill' and i.source_id = b.id
          )
        group by b.bill_date
      ) rb
    ), page as (
      select *
      from candidates c
      where (v_search = '' or position(v_search in c.search_text) > 0)
        and (v_cursor_date is null or (c.sort_date, c.sort_key) < (v_cursor_date, v_cursor_key))
      order by c.sort_date desc, c.sort_key desc
      limit 101
    ), numbered as (
      select *, row_number() over (order by sort_date desc, sort_key desc) as row_no
      from page
    )
    select jsonb_build_object(
      'rows', coalesce((select jsonb_agg(row_data order by sort_date desc, sort_key desc)
        from numbered where row_no <= 100), '[]'::jsonb),
      'nextCursor', case when (select count(*) from numbered) > 100 then
        (select encode(convert_to(jsonb_build_object(
          'v', 1, 'locationId', p_location_id, 'mode', p_mode, 'search', v_search,
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

create or replace function public.get_cash_branch_transfer_pending_summary(p_location_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not private.is_active_user() or not private.can_access_location(p_location_id) then
    raise exception 'Location access denied';
  end if;

  return (
    with pending as (
      select mt.*, d.sent_total, d.cash_status, d.note, d.sent_at,
        source_location.name as source_location_name,
        public.report_lock_no(mt) as report_lock_no
      from public.money_transfers mt
      join public.money_transfer_cash_details d on d.transfer_id = mt.id
      left join public.locations source_location on source_location.id = mt.location_id
      where mt.transfer_type = 'cash' and mt.transfer_method = 'cash'
        and mt.record_status <> 'deleted'
        and mt.target_location_id = p_location_id
        and d.cash_status = 'pending_receipt'
    ), page as (
      select * from pending order by sent_at asc, id asc limit 20
    )
    select jsonb_build_object(
      'transfers', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id,
        'locationId', location_id,
        'sourceLocationName', source_location_name,
        'targetLocationId', target_location_id,
        'targetLocationName', target_location_name,
        'createdByUserId', created_by_user_id,
        'createdByName', created_by_name,
        'createdByPhone', created_by_phone,
        'sentTotal', sent_total,
        'status', cash_status,
        'note', note,
        'sentAt', sent_at,
        'reportLockNo', report_lock_no
      ) order by sent_at asc, id asc) from page), '[]'::jsonb),
      'total', (select count(*) from pending)
    )
  );
end;
$$;

revoke all on function public.get_cash_branch_transfer_pending_summary(uuid)
  from public, anon;
grant execute on function public.get_cash_branch_transfer_pending_summary(uuid)
  to authenticated;

create or replace function public.get_cash_branch_transfer_detail(p_transfer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_transfer public.money_transfers%rowtype;
  v_detail public.money_transfer_cash_details%rowtype;
begin
  if not private.is_active_user() then
    raise exception 'Authentication required';
  end if;

  select * into v_transfer
  from public.money_transfers mt
  where mt.id = p_transfer_id
    and mt.transfer_type = 'cash'
    and mt.transfer_method = 'cash'
    and mt.record_status <> 'deleted';

  if v_transfer.id is null then
    raise exception 'Cash transfer not found';
  end if;
  if not private.can_access_location(v_transfer.location_id)
    and not private.can_access_location(v_transfer.target_location_id)
  then
    raise exception 'Location access denied';
  end if;

  select * into v_detail
  from public.money_transfer_cash_details d
  where d.transfer_id = p_transfer_id;

  if v_detail.transfer_id is null then
    raise exception 'Cash transfer not found';
  end if;

  return to_jsonb(v_transfer) || jsonb_build_object(
    'report_lock_no', public.report_lock_no(v_transfer),
    'money_transfer_cash_details', jsonb_build_array(to_jsonb(v_detail))
  );
end;
$$;

revoke all on function public.get_cash_branch_transfer_detail(uuid)
  from public, anon;
grant execute on function public.get_cash_branch_transfer_detail(uuid)
  to authenticated;

notify pgrst, 'reload schema';
