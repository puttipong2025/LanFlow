-- Put cash branch-transfer accounting rows in the authoritative paginated feed.
-- The source expense is recognized at sent_at; the target income is recognized
-- only after receipt, at received_at, using the amount physically received.

do $$
declare
  v_definition text;
  v_anchor text := $anchor$
      union all

      select mt.created_at::date, 'customer-transfer-expense:' || mt.id::text,$anchor$;
  v_cash_unions text := $cash$
      union all

      select (d.sent_at at time zone 'Asia/Bangkok')::date, 'cash-transfer-expense:' || mt.id::text,
        jsonb_build_object(
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
          'relationLabel', case d.cash_status
            when 'pending_receipt' then 'รอรับเงิน'
            when 'received' then 'รับเงินแล้ว'
            when 'mismatched' then 'ยอดไม่ตรง ' || case when d.difference_total >= 0 then '+฿' else '-฿' end || trim(to_char(abs(d.difference_total), 'FM999999999990'))
            else 'ยอมรับผลต่าง ' || case when d.difference_total >= 0 then '+฿' else '-฿' end || trim(to_char(abs(d.difference_total), 'FM999999999990'))
          end,
          'relationLockReason', 'รายการนี้มาจากการโยกเงินสด ต้องเปิดรายละเอียดเพื่อดูข้อมูล'
        )
      from public.money_transfers mt
      join public.money_transfer_cash_details d on d.transfer_id = mt.id
      where mt.transfer_type = 'cash' and mt.transfer_method = 'cash'
        and mt.location_id = p_location_id and mt.record_status <> 'deleted'
        and (d.sent_at at time zone 'Asia/Bangkok')::date between p_from_date and p_to_date

      union all

      select (d.received_at at time zone 'Asia/Bangkok')::date, 'cash-transfer-income:' || mt.id::text,
        jsonb_build_object(
          'id', 'cash-transfer-income:' || mt.id, 'clientTempId', 'cash-transfer-income:' || mt.id,
          'localBillNo', 'CASH-' || left(mt.id::text, 8), 'serverBillNo', 'CASH-' || left(mt.id::text, 8),
          'idempotencyKey', 'cash-transfer-income:' || mt.id, 'locationId', mt.target_location_id,
          'syncStatus', 'synced', 'recordStatus', 'active', 'type', 'income',
          'number', 'CASH-' || left(mt.id::text, 8),
          'txDate', (d.received_at at time zone 'Asia/Bangkok')::date,
          'title', 'รับโอนเงินสดจากสาขาต้นทาง',
          'cost', d.received_total, 'billOption', 'รายรับ',
          'clientRecordedAt', d.received_at, 'clientCreatedAt', d.received_at,
          'serverReceivedAt', d.updated_at, 'revisionNo', mt.revision_no,
          'createdByUserId', mt.created_by_user_id, 'createdByName', mt.created_by_name,
          'createdByPhone', mt.created_by_phone, 'relationSourceType', 'money_transfer',
          'relationSourceId', 'cash:' || mt.id, 'relationSourceLocationId', mt.location_id,
          'relationLabel', case d.cash_status
            when 'received' then 'รับเงินแล้ว'
            when 'mismatched' then 'ยอดไม่ตรง ' || case when d.difference_total >= 0 then '+฿' else '-฿' end || trim(to_char(abs(d.difference_total), 'FM999999999990'))
            else 'ยอมรับผลต่าง ' || case when d.difference_total >= 0 then '+฿' else '-฿' end || trim(to_char(abs(d.difference_total), 'FM999999999990'))
          end,
          'relationLockReason', 'รายการนี้มาจากการโยกเงินสด ต้องเปิดรายละเอียดเพื่อดูข้อมูล'
        )
      from public.money_transfers mt
      join public.money_transfer_cash_details d on d.transfer_id = mt.id
      where mt.transfer_type = 'cash' and mt.transfer_method = 'cash'
        and mt.target_location_id = p_location_id and mt.record_status <> 'deleted'
        and d.cash_status in ('received', 'mismatched', 'difference_accepted')
        and (d.received_at at time zone 'Asia/Bangkok')::date between p_from_date and p_to_date
$cash$;
begin
  select pg_get_functiondef(
    'public.get_income_expense_feed(uuid, date, date, date, text, integer)'::regprocedure
  ) into v_definition;

  if strpos(v_definition, v_anchor) = 0 then
    raise exception 'Unable to locate income/expense feed insertion point';
  end if;

  v_definition := replace(v_definition, v_anchor, v_cash_unions || v_anchor);
  execute v_definition;
end;
$$;
