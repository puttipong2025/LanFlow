create or replace function public.save_money_transfer(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := (p_payload->>'id')::uuid;
  v_location_id uuid := (p_payload->>'locationId')::uuid;
  v_idempotency_key text := nullif(p_payload->>'idempotencyKey', '');
  v_operation text := coalesce(p_payload->>'operation', 'create');
  v_transfer_type text := coalesce(p_payload->>'transferType', 'customer');
  v_expected_revision integer := coalesce((p_payload->>'revisionNo')::integer, 0);
  v_existing public.money_transfers;
  v_retry public.money_transfers;
  v_is_create boolean;
  v_slip_ids uuid[];
  v_item_ids uuid[];
  v_changed_sources jsonb;
begin
  if not private.is_active_user() or not private.can_access_money_transfer_module() then
    raise exception 'MT_ACCESS_DENIED: ไม่มีสิทธิ์ใช้งานรายการโอนเงิน';
  end if;
  if v_id is null or v_location_id is null then raise exception 'MT_INVALID_PAYLOAD: ข้อมูลรายการโอนไม่ครบ'; end if;
  if not private.can_access_location(v_location_id) then raise exception 'MT_LOCATION_DENIED: ไม่มีสิทธิ์เข้าถึงสาขา'; end if;
  if v_transfer_type not in ('customer', 'transport', 'branch') then
    raise exception 'MT_UNSUPPORTED_WORKFLOW: ไม่รองรับประเภทการโอนนี้';
  end if;
  if v_operation not in ('create', 'update') then raise exception 'MT_INVALID_OPERATION: operation ไม่ถูกต้อง'; end if;
  if jsonb_typeof(coalesce(p_payload->'slips', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_payload->'items', '[]'::jsonb)) <> 'array' then
    raise exception 'MT_INVALID_PAYLOAD: slips/items ต้องเป็นรายการ';
  end if;

  if v_idempotency_key is not null then
    select * into v_retry from public.money_transfers t
    where t.idempotency_key = v_idempotency_key and t.record_status <> 'deleted'
    for update;
    if v_retry.id is not null then
      if v_retry.location_id <> v_location_id then
        raise exception 'MT_IDEMPOTENCY_CONFLICT: idempotency key อยู่คนละสาขา';
      end if;
      if v_operation = 'create' then
        return public.get_money_transfer_detail(v_retry.id)
          || jsonb_build_object('idempotentReplay', true, 'changedSources', '[]'::jsonb);
      end if;
      if v_retry.id <> v_id then raise exception 'MT_IDEMPOTENCY_CONFLICT: idempotency key ไม่ตรงรายการ'; end if;
    end if;
  end if;

  select * into v_existing from public.money_transfers t where t.id = v_id for update;
  v_is_create := v_existing.id is null;
  if v_operation = 'create' and not v_is_create then
    raise exception 'MT_IDEMPOTENCY_CONFLICT: มีรหัสรายการนี้แล้ว';
  end if;
  if v_operation = 'update' and v_is_create then raise exception 'MT_NOT_FOUND: ไม่พบรายการโอนเงิน'; end if;
  if not v_is_create then
    if v_existing.location_id <> v_location_id then raise exception 'MT_LOCATION_MISMATCH: ห้ามย้ายรายการข้ามสาขา'; end if;
    if v_existing.record_status = 'deleted' then raise exception 'MT_NOT_FOUND: ไม่พบรายการโอนเงิน'; end if;
    if v_existing.revision_no <> v_expected_revision then
      raise exception 'MT_REVISION_CONFLICT: ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดใหม่';
    end if;
    if public.report_lock_no(v_existing) is not null then
      raise exception 'MT_REPORT_LOCKED: รายการถูกล็อกโดยรายงาน';
    end if;
  end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) x
    group by x->>'sourceType', x->>'sourceId' having count(*) > 1
  ) then raise exception 'MT_DUPLICATE_SOURCE: มีแหล่งจ่ายซ้ำในรายการ'; end if;

  -- Deterministic source locking keeps concurrent saves from validating stale availability.
  perform b.id
  from public.rubber_bills b
  where b.id = any(coalesce((select array_agg((x->>'sourceId')::uuid)
    from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) x
    where x->>'sourceType' = 'rubber_bill'), array[]::uuid[]))
  order by b.id for update;
  perform o.id
  from public.ocr_tickets o
  where o.id = any(coalesce((select array_agg((x->>'sourceId')::uuid)
    from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) x
    where x->>'sourceType' = 'ocr_ticket'), array[]::uuid[]))
  order by o.id for update;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) x
    where x->>'sourceType' not in ('rubber_bill', 'ocr_ticket')
  ) then raise exception 'MT_INVALID_SOURCE: ประเภทแหล่งจ่ายไม่ถูกต้อง'; end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) x
    left join public.rubber_bills b on b.id = (x->>'sourceId')::uuid
    where x->>'sourceType' = 'rubber_bill' and (
      b.id is null or b.location_id <> v_location_id or b.record_status <> 'active'
      or b.sync_status::text <> 'synced' or b.server_bill_no is null or b.net_total <= 0
      or public.report_lock_no(b) is not null
      or private.rubber_bill_has_pending_approval(b.id)
      or exists (select 1 from public.rubber_bill_items bi
        where bi.bill_id = b.id and bi.item_type = 'weigh' and coalesce(bi.price, 0) <= 0)
    )
  ) then raise exception 'MT_RUBBER_SOURCE_BLOCKED: บิลยางยังไม่พร้อมโอนหรือถูกล็อก'; end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) x
    left join public.ocr_tickets o on o.id = (x->>'sourceId')::uuid
    where x->>'sourceType' = 'ocr_ticket' and (
      o.id is null or o.location_id <> v_location_id or o.record_status <> 'active'
      or o.sync_status::text <> 'synced' or o.ticket_id is null
      or coalesce(o.total_amount, 0) - coalesce(o.money_deducted, 0) <= 0
      or nullif(trim(coalesce(o.customer_name, '')), '') is null
      or public.report_lock_no(o) is not null
    )
  ) then raise exception 'MT_OCR_SOURCE_BLOCKED: ใบชั่งยังไม่พร้อมโอนหรือถูกล็อก'; end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) x
    join public.money_transfer_items i
      on i.source_type = x->>'sourceType' and i.source_id = (x->>'sourceId')::uuid
    join public.money_transfers t on t.id = i.transfer_id and t.record_status <> 'deleted'
    where i.transfer_id <> v_id
  ) then raise exception 'MT_SOURCE_ALREADY_USED: แหล่งจ่ายถูกใช้ในรายการโอนอื่นแล้ว'; end if;

  if v_is_create then
    insert into public.money_transfers (
      id, client_temp_id, idempotency_key, location_id, customer_id, customer_name,
      account_number, account_name, bank_name, net_amount_to_pay, branch_paid_amount,
      transfer_type, transport_cost, transport_staff_id, transport_staff_name,
      target_location_id, target_location_name, transfer_status, created_by_user_id,
      created_by_name, created_by_phone, revision_no, record_status
    ) values (
      v_id, p_payload->>'clientTempId', v_idempotency_key, v_location_id,
      nullif(p_payload->>'customerId', '')::uuid, p_payload->>'customerName',
      p_payload->>'accountNumber', p_payload->>'accountName', p_payload->>'bankName',
      coalesce((p_payload->>'netAmountToPay')::numeric, 0), coalesce((p_payload->>'branchPaidAmount')::numeric, 0),
      v_transfer_type, nullif(p_payload->>'transportCost', '')::numeric,
      nullif(p_payload->>'transportStaffId', '')::uuid, p_payload->>'transportStaffName',
      nullif(p_payload->>'targetLocationId', '')::uuid, p_payload->>'targetLocationName',
      coalesce(p_payload->>'transferStatus', 'pending'), auth.uid(),
      coalesce(p_payload->>'createdByName', ''), coalesce(p_payload->>'createdByPhone', ''), 0, 'active'
    );
  else
    update public.money_transfers t set
      customer_id = nullif(p_payload->>'customerId', '')::uuid,
      customer_name = p_payload->>'customerName', account_number = p_payload->>'accountNumber',
      account_name = p_payload->>'accountName', bank_name = p_payload->>'bankName',
      net_amount_to_pay = coalesce((p_payload->>'netAmountToPay')::numeric, 0),
      branch_paid_amount = coalesce((p_payload->>'branchPaidAmount')::numeric, 0),
      transfer_type = v_transfer_type, transport_cost = nullif(p_payload->>'transportCost', '')::numeric,
      transport_staff_id = nullif(p_payload->>'transportStaffId', '')::uuid,
      transport_staff_name = p_payload->>'transportStaffName',
      target_location_id = nullif(p_payload->>'targetLocationId', '')::uuid,
      target_location_name = p_payload->>'targetLocationName',
      transfer_status = coalesce(p_payload->>'transferStatus', t.transfer_status),
      revision_no = t.revision_no + 1, updated_at = now()
    where t.id = v_id;
  end if;

  select coalesce(array_agg((x->>'id')::uuid), array[]::uuid[]) into v_slip_ids
  from jsonb_array_elements(coalesce(p_payload->'slips', '[]'::jsonb)) x;
  delete from public.money_transfer_slips s where s.transfer_id = v_id and not (s.id = any(v_slip_ids));
  insert into public.money_transfer_slips (
    id, transfer_id, amount, reference_number, fee, sender_name, receiver_name,
    transaction_date, slip_image_url, sort_order
  ) select
    (x->>'id')::uuid, v_id, coalesce((x->>'amount')::numeric, 0), x->>'referenceNumber',
    coalesce((x->>'fee')::numeric, 0), x->>'senderName', x->>'receiverName',
    nullif(x->>'transactionDate', '')::timestamptz, x->>'slipImageUrl', coalesce((x->>'sortOrder')::integer, 0)
  from jsonb_array_elements(coalesce(p_payload->'slips', '[]'::jsonb)) x
  on conflict (id) do update set
    amount = excluded.amount, reference_number = excluded.reference_number, fee = excluded.fee,
    sender_name = excluded.sender_name, receiver_name = excluded.receiver_name,
    transaction_date = excluded.transaction_date, slip_image_url = excluded.slip_image_url,
    sort_order = excluded.sort_order, updated_at = now();

  select coalesce(array_agg((x->>'id')::uuid), array[]::uuid[]) into v_item_ids
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) x;
  select coalesce(jsonb_agg(jsonb_build_object('sourceType', i.source_type, 'sourceId', i.source_id)), '[]'::jsonb)
  into v_changed_sources from public.money_transfer_items i where i.transfer_id = v_id;
  delete from public.money_transfer_items i where i.transfer_id = v_id and not (i.id = any(v_item_ids));
  insert into public.money_transfer_items (
    id, transfer_id, source_type, source_id, rubber_bill_id, ocr_ticket_id, customer_name, amount
  ) select
    (x->>'id')::uuid, v_id, x->>'sourceType', (x->>'sourceId')::uuid,
    case when x->>'sourceType' = 'rubber_bill' then (x->>'sourceId')::uuid end,
    case when x->>'sourceType' = 'ocr_ticket' then (x->>'sourceId')::uuid end,
    case when x->>'sourceType' = 'rubber_bill' then b.customer_name else o.customer_name end,
    case when x->>'sourceType' = 'rubber_bill' then b.net_total
      else coalesce(o.total_amount, 0) - coalesce(o.money_deducted, 0) end
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) x
  left join public.rubber_bills b on x->>'sourceType' = 'rubber_bill' and b.id = (x->>'sourceId')::uuid
  left join public.ocr_tickets o on x->>'sourceType' = 'ocr_ticket' and o.id = (x->>'sourceId')::uuid
  on conflict (id) do update set
    source_type = excluded.source_type, source_id = excluded.source_id,
    rubber_bill_id = excluded.rubber_bill_id, ocr_ticket_id = excluded.ocr_ticket_id,
    customer_name = excluded.customer_name, amount = excluded.amount;

  select coalesce(jsonb_agg(jsonb_build_object(
    'sourceType', changed.source_type, 'sourceId', changed.source_id
  ) order by changed.source_type, changed.source_id), '[]'::jsonb)
  into v_changed_sources
  from (
    select old_source.value->>'sourceType' source_type,
      (old_source.value->>'sourceId')::uuid source_id
    from jsonb_array_elements(v_changed_sources) old_source
    union
    select x->>'sourceType', (x->>'sourceId')::uuid
    from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) x
  ) changed;

  return public.get_money_transfer_detail(v_id)
    || jsonb_build_object('idempotentReplay', false, 'changedSources', v_changed_sources);
exception
  when unique_violation then
    raise exception 'MT_SOURCE_ALREADY_USED: แหล่งจ่ายถูกใช้ในรายการโอนอื่นแล้ว';
end;
$$;

revoke all on function public.save_money_transfer(jsonb) from public, anon;
grant execute on function public.save_money_transfer(jsonb) to authenticated;

notify pgrst, 'reload schema';
