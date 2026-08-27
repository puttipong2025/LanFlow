-- Restore bank transfers to a receiving branch without inventing a source branch.
-- New branch transfers are owned by the receiver (location_id = target_location_id).

alter table public.money_transfers
  add column if not exists accounting_date date,
  add column if not exists request_fingerprint text;

alter table public.money_transfer_slips
  add column if not exists input_method text,
  add column if not exists ocr_fingerprint text;

alter table public.money_transfer_slips
  drop constraint if exists money_transfer_slips_input_method_check,
  add constraint money_transfer_slips_input_method_check
    check (input_method is null or input_method in ('manual', 'ocr')),
  drop constraint if exists money_transfer_slips_input_contract_check,
  add constraint money_transfer_slips_input_contract_check check (
    input_method is null
    or (
      input_method = 'manual'
      and reference_number is null
      and ocr_fingerprint is null
    )
    or (
      input_method = 'ocr'
      and nullif(trim(reference_number), '') is not null
      and ocr_fingerprint is not null
    )
  );

create index if not exists money_transfer_slips_ocr_fingerprint_idx
  on public.money_transfer_slips (ocr_fingerprint, transfer_id)
  where ocr_fingerprint is not null;

create or replace function private.money_transfer_ocr_fingerprint(
  p_reference_number text,
  p_amount numeric,
  p_transaction_date timestamptz
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when nullif(pg_catalog.btrim(p_reference_number), '') is null
      or p_amount is null
      or p_transaction_date is null
    then null
    else pg_catalog.md5(
      pg_catalog.lower(
        pg_catalog.regexp_replace(pg_catalog.btrim(p_reference_number), '[^[:alnum:]]+', '', 'g')
      )
      || '|' || pg_catalog.round(p_amount, 2)::text
      || '|' || (extract(epoch from p_transaction_date) * 1000)::bigint::text
    )
  end
$$;

revoke all on function private.money_transfer_ocr_fingerprint(text, numeric, timestamptz)
from public, anon, authenticated, service_role;

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
  v_target_location_id uuid := nullif(p_payload->>'targetLocationId', '')::uuid;
  v_request_fingerprint text := pg_catalog.md5((p_payload - 'operation')::text);
  v_existing public.money_transfers;
  v_retry public.money_transfers;
  v_is_create boolean;
  v_slip_ids uuid[];
  v_item_ids uuid[];
  v_changed_sources jsonb;
  v_target_location_name text;
  v_accounting_date date;
  v_branch_total numeric(12,2);
  v_ocr_fingerprint text;
begin
  if not private.is_active_user() or not private.can_access_money_transfer_module() then
    raise exception 'MT_ACCESS_DENIED: ไม่มีสิทธิ์ใช้งานรายการโอนเงิน';
  end if;
  if v_id is null or v_location_id is null then
    raise exception 'MT_INVALID_PAYLOAD: ข้อมูลรายการโอนไม่ครบ';
  end if;
  if not private.can_access_location(v_location_id) then
    raise exception 'MT_LOCATION_DENIED: ไม่มีสิทธิ์เข้าถึงสาขา';
  end if;
  if v_transfer_type not in ('customer', 'transport', 'branch') then
    raise exception 'MT_UNSUPPORTED_WORKFLOW: ไม่รองรับประเภทการโอนนี้';
  end if;
  if v_operation not in ('create', 'update') then
    raise exception 'MT_INVALID_OPERATION: operation ไม่ถูกต้อง';
  end if;
  if jsonb_typeof(coalesce(p_payload->'slips', '[]'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_payload->'items', '[]'::jsonb)) <> 'array' then
    raise exception 'MT_INVALID_PAYLOAD: slips/items ต้องเป็นรายการ';
  end if;

  if v_idempotency_key is not null and v_operation = 'create' then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('money-transfer-create:' || v_idempotency_key, 0)
    );
  end if;

  if v_idempotency_key is not null then
    select * into v_retry
    from public.money_transfers t
    where t.idempotency_key = v_idempotency_key
      and t.record_status <> 'deleted'
    for update;

    if v_retry.id is not null then
      if v_retry.location_id <> v_location_id then
        raise exception 'MT_IDEMPOTENCY_CONFLICT: idempotency key อยู่คนละสาขา';
      end if;
      if v_operation = 'create' then
        if v_retry.request_fingerprint is not null
          and v_retry.request_fingerprint <> v_request_fingerprint then
          raise exception 'MT_IDEMPOTENCY_PAYLOAD_MISMATCH: idempotency key ถูกใช้กับข้อมูลอื่นแล้ว';
        end if;
        return public.get_money_transfer_detail(v_retry.id)
          || jsonb_build_object('idempotentReplay', true, 'changedSources', '[]'::jsonb);
      end if;
      if v_retry.id <> v_id then
        raise exception 'MT_IDEMPOTENCY_CONFLICT: idempotency key ไม่ตรงรายการ';
      end if;
    end if;
  end if;

  select * into v_existing
  from public.money_transfers t
  where t.id = v_id
  for update;
  v_is_create := v_existing.id is null;

  if v_operation = 'create' and not v_is_create then
    raise exception 'MT_IDEMPOTENCY_CONFLICT: มีรหัสรายการนี้แล้ว';
  end if;
  if v_operation = 'update' and v_is_create then
    raise exception 'MT_NOT_FOUND: ไม่พบรายการโอนเงิน';
  end if;
  if not v_is_create then
    if v_existing.location_id <> v_location_id then
      raise exception 'MT_LOCATION_MISMATCH: ห้ามย้ายรายการข้ามสาขา';
    end if;
    if v_existing.record_status = 'deleted' then
      raise exception 'MT_NOT_FOUND: ไม่พบรายการโอนเงิน';
    end if;
    if v_existing.revision_no <> v_expected_revision then
      raise exception 'MT_REVISION_CONFLICT: ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดใหม่';
    end if;
    if public.report_lock_no(v_existing) is not null then
      raise exception 'MT_REPORT_LOCKED: รายการถูกล็อกโดยรายงาน';
    end if;
    if v_existing.transfer_type <> v_transfer_type then
      raise exception 'MT_TRANSFER_TYPE_IMMUTABLE: ห้ามเปลี่ยนประเภทรายการโอน';
    end if;
    if v_existing.transfer_type = 'branch'
      and v_existing.location_id <> v_existing.target_location_id then
      raise exception 'MT_LEGACY_BRANCH_READ_ONLY: รายการโอนระหว่างสาขารุ่นเดิมแก้ไขไม่ได้';
    end if;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'slips', '[]'::jsonb)) x
    group by x->>'id'
    having count(*) > 1
  ) then
    raise exception 'MT_DUPLICATE_SLIP_ID: มีรหัสสลิปซ้ำในรายการ';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'slips', '[]'::jsonb)) x
    join public.money_transfer_slips s on s.id = (x->>'id')::uuid
    where s.transfer_id <> v_id
  ) then
    raise exception 'MT_SLIP_PARENT_CONFLICT: สลิปอยู่ในรายการโอนอื่น';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) x
    group by x->>'id'
    having count(*) > 1
  ) then
    raise exception 'MT_DUPLICATE_ITEM_ID: มีรหัสแหล่งจ่ายซ้ำในรายการ';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) x
    join public.money_transfer_items i on i.id = (x->>'id')::uuid
    where i.transfer_id <> v_id
  ) then
    raise exception 'MT_ITEM_PARENT_CONFLICT: แหล่งจ่ายอยู่ในรายการโอนอื่น';
  end if;

  if v_transfer_type = 'branch' then
    if v_target_location_id is null or v_target_location_id <> v_location_id then
      raise exception 'MT_BRANCH_TARGET_MISMATCH: รายการโอนให้สาขาต้องเป็นของสาขาผู้รับ';
    end if;
    if not private.can_access_location(v_target_location_id) then
      raise exception 'MT_TARGET_LOCATION_DENIED: ไม่มีสิทธิ์โอนให้สาขานี้';
    end if;
    select l.name into v_target_location_name
    from public.locations l
    where l.id = v_target_location_id
      and l.is_active = true;
    if v_target_location_name is null then
      raise exception 'MT_TARGET_LOCATION_INACTIVE: สาขาผู้รับไม่เปิดใช้งาน';
    end if;
    if jsonb_array_length(coalesce(p_payload->'items', '[]'::jsonb)) <> 0 then
      raise exception 'MT_BRANCH_SOURCE_NOT_ALLOWED: โอนให้สาขาไม่มีรายการต้นทาง';
    end if;
    if jsonb_array_length(coalesce(p_payload->'slips', '[]'::jsonb)) = 0 then
      raise exception 'MT_SLIP_REQUIRED: กรุณาเพิ่มสลิปอย่างน้อยหนึ่งใบ';
    end if;
    if exists (
      select 1
      from jsonb_array_elements(p_payload->'slips') x
      where nullif(x->>'id', '') is null
        or coalesce((x->>'amount')::numeric, 0) <= 0
        or coalesce((x->>'fee')::numeric, 0) < 0
        or nullif(x->>'transactionDate', '') is null
        or x->>'inputMethod' not in ('manual', 'ocr')
        or (x->>'inputMethod' = 'manual' and nullif(trim(x->>'referenceNumber'), '') is not null)
        or (x->>'inputMethod' = 'ocr' and nullif(trim(x->>'referenceNumber'), '') is null)
    ) then
      raise exception 'MT_INVALID_SLIP: จำนวนเงิน ค่าธรรมเนียม วันเวลา หรือที่มาของสลิปไม่ถูกต้อง';
    end if;

    select
      min(((x->>'transactionDate')::timestamptz at time zone 'Asia/Bangkok')::date),
      round(sum((x->>'amount')::numeric), 2)
    into v_accounting_date, v_branch_total
    from jsonb_array_elements(p_payload->'slips') x;

    if exists (
      select 1
      from jsonb_array_elements(p_payload->'slips') x
      where ((x->>'transactionDate')::timestamptz at time zone 'Asia/Bangkok')::date
        <> v_accounting_date
    ) then
      raise exception 'MT_SLIP_DATE_MISMATCH: สลิปทุกใบต้องเป็นวันเดียวกันตามเวลาไทย';
    end if;

    if exists (
      select 1
      from jsonb_array_elements(p_payload->'slips') x
      where x->>'inputMethod' = 'ocr'
      group by private.money_transfer_ocr_fingerprint(
        x->>'referenceNumber',
        (x->>'amount')::numeric,
        (x->>'transactionDate')::timestamptz
      )
      having count(*) > 1
    ) then
      raise exception 'MT_OCR_DUPLICATE: พบสลิป OCR ซ้ำในรายการ';
    end if;

    for v_ocr_fingerprint in
      select distinct private.money_transfer_ocr_fingerprint(
        x->>'referenceNumber',
        (x->>'amount')::numeric,
        (x->>'transactionDate')::timestamptz
      )
      from jsonb_array_elements(p_payload->'slips') x
      where x->>'inputMethod' = 'ocr'
      order by 1
    loop
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('money-transfer-ocr:' || v_ocr_fingerprint, 0)
      );
    end loop;

    if exists (
      select 1
      from jsonb_array_elements(p_payload->'slips') x
      join public.money_transfer_slips s
        on s.ocr_fingerprint = private.money_transfer_ocr_fingerprint(
          x->>'referenceNumber',
          (x->>'amount')::numeric,
          (x->>'transactionDate')::timestamptz
        )
      join public.money_transfers t
        on t.id = s.transfer_id
       and t.record_status <> 'deleted'
      where x->>'inputMethod' = 'ocr'
        and t.id <> v_id
    ) then
      raise exception 'MT_OCR_DUPLICATE: สลิป OCR ถูกใช้ในรายการอื่นแล้ว';
    end if;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) x
    group by x->>'sourceType', x->>'sourceId'
    having count(*) > 1
  ) then
    raise exception 'MT_DUPLICATE_SOURCE: มีแหล่งจ่ายซ้ำในรายการ';
  end if;

  perform b.id
  from public.rubber_bills b
  where b.id = any(coalesce((
    select array_agg((x->>'sourceId')::uuid)
    from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) x
    where x->>'sourceType' = 'rubber_bill'
  ), array[]::uuid[]))
  order by b.id
  for update;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) x
    where x->>'sourceType' <> 'rubber_bill'
  ) then
    raise exception 'MT_INVALID_SOURCE: ประเภทแหล่งจ่ายไม่ถูกต้อง';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) x
    left join public.rubber_bills b on b.id = (x->>'sourceId')::uuid
    where x->>'sourceType' = 'rubber_bill' and (
      b.id is null
      or b.location_id <> v_location_id
      or b.record_status <> 'active'
      or b.sync_status::text <> 'synced'
      or b.server_bill_no is null
      or b.net_total <= 0
      or (
        public.report_lock_no(b) is not null
        and not exists (
          select 1
          from public.money_transfer_items current_item
          where current_item.transfer_id = v_id
            and current_item.source_type = 'rubber_bill'
            and current_item.source_id = b.id
        )
      )
      or private.rubber_bill_has_pending_approval(b.id)
      or exists (
        select 1
        from public.rubber_bill_items bi
        where bi.bill_id = b.id
          and bi.item_type = 'weigh'
          and coalesce(bi.price, 0) <= 0
      )
    )
  ) then
    raise exception 'MT_RUBBER_SOURCE_BLOCKED: บิลยางยังไม่พร้อมโอนหรือถูกล็อก';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) x
    join public.money_transfer_items i
      on i.source_type = x->>'sourceType'
     and i.source_id = (x->>'sourceId')::uuid
    join public.money_transfers t
      on t.id = i.transfer_id
     and t.record_status <> 'deleted'
    where i.transfer_id <> v_id
  ) then
    raise exception 'MT_SOURCE_ALREADY_USED: แหล่งจ่ายถูกใช้ในรายการโอนอื่นแล้ว';
  end if;

  if v_is_create then
    insert into public.money_transfers (
      id, client_temp_id, idempotency_key, request_fingerprint, location_id,
      customer_id, customer_name, account_number, account_name, bank_name,
      net_amount_to_pay, branch_paid_amount, transfer_type, transport_cost,
      transport_staff_id, transport_staff_name, target_location_id,
      target_location_name, transfer_status, accounting_date,
      created_by_user_id, created_by_name, created_by_phone, revision_no, record_status
    ) values (
      v_id, p_payload->>'clientTempId', v_idempotency_key, v_request_fingerprint, v_location_id,
      nullif(p_payload->>'customerId', '')::uuid, p_payload->>'customerName',
      p_payload->>'accountNumber', p_payload->>'accountName', p_payload->>'bankName',
      case when v_transfer_type = 'branch' then v_branch_total
        else coalesce((p_payload->>'netAmountToPay')::numeric, 0) end,
      case when v_transfer_type = 'branch' then 0
        else coalesce((p_payload->>'branchPaidAmount')::numeric, 0) end,
      v_transfer_type, nullif(p_payload->>'transportCost', '')::numeric,
      nullif(p_payload->>'transportStaffId', '')::uuid, p_payload->>'transportStaffName',
      case when v_transfer_type = 'branch' then v_location_id else v_target_location_id end,
      case when v_transfer_type = 'branch' then v_target_location_name else p_payload->>'targetLocationName' end,
      case when v_transfer_type = 'branch' then 'paid'
        else coalesce(p_payload->>'transferStatus', 'pending') end,
      case when v_transfer_type = 'branch' then v_accounting_date end,
      auth.uid(), coalesce(p_payload->>'createdByName', ''),
      coalesce(p_payload->>'createdByPhone', ''), 0, 'active'
    );
  else
    update public.money_transfers t set
      customer_id = nullif(p_payload->>'customerId', '')::uuid,
      customer_name = p_payload->>'customerName',
      account_number = p_payload->>'accountNumber',
      account_name = p_payload->>'accountName',
      bank_name = p_payload->>'bankName',
      net_amount_to_pay = case when v_transfer_type = 'branch' then v_branch_total
        else coalesce((p_payload->>'netAmountToPay')::numeric, 0) end,
      branch_paid_amount = case when v_transfer_type = 'branch' then 0
        else coalesce((p_payload->>'branchPaidAmount')::numeric, 0) end,
      transport_cost = nullif(p_payload->>'transportCost', '')::numeric,
      transport_staff_id = nullif(p_payload->>'transportStaffId', '')::uuid,
      transport_staff_name = p_payload->>'transportStaffName',
      target_location_id = case when v_transfer_type = 'branch' then v_location_id
        else v_target_location_id end,
      target_location_name = case when v_transfer_type = 'branch' then v_target_location_name
        else p_payload->>'targetLocationName' end,
      transfer_status = case when v_transfer_type = 'branch' then 'paid'
        else coalesce(p_payload->>'transferStatus', t.transfer_status) end,
      accounting_date = case when v_transfer_type = 'branch' then v_accounting_date
        else t.accounting_date end,
      revision_no = t.revision_no + 1,
      updated_at = now()
    where t.id = v_id;
  end if;

  select coalesce(array_agg((x->>'id')::uuid), array[]::uuid[])
  into v_slip_ids
  from jsonb_array_elements(coalesce(p_payload->'slips', '[]'::jsonb)) x;

  delete from public.money_transfer_slips s
  where s.transfer_id = v_id
    and not (s.id = any(v_slip_ids));

  insert into public.money_transfer_slips (
    id, transfer_id, amount, reference_number, fee, sender_name, receiver_name,
    transaction_date, slip_image_url, sort_order, input_method, ocr_fingerprint
  )
  select
    (x->>'id')::uuid,
    v_id,
    coalesce((x->>'amount')::numeric, 0),
    case when x->>'inputMethod' = 'manual' then null else nullif(x->>'referenceNumber', '') end,
    coalesce((x->>'fee')::numeric, 0),
    x->>'senderName',
    x->>'receiverName',
    nullif(x->>'transactionDate', '')::timestamptz,
    x->>'slipImageUrl',
    coalesce((x->>'sortOrder')::integer, 0),
    nullif(x->>'inputMethod', ''),
    case when x->>'inputMethod' = 'ocr' then private.money_transfer_ocr_fingerprint(
      x->>'referenceNumber',
      (x->>'amount')::numeric,
      (x->>'transactionDate')::timestamptz
    ) end
  from jsonb_array_elements(coalesce(p_payload->'slips', '[]'::jsonb)) x
  on conflict (id) do update set
    amount = excluded.amount,
    reference_number = excluded.reference_number,
    fee = excluded.fee,
    sender_name = excluded.sender_name,
    receiver_name = excluded.receiver_name,
    transaction_date = excluded.transaction_date,
    slip_image_url = excluded.slip_image_url,
    sort_order = excluded.sort_order,
    input_method = excluded.input_method,
    ocr_fingerprint = excluded.ocr_fingerprint,
    updated_at = now()
  where money_transfer_slips.transfer_id = v_id;

  select coalesce(array_agg((x->>'id')::uuid), array[]::uuid[])
  into v_item_ids
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) x;

  select coalesce(jsonb_agg(jsonb_build_object(
    'sourceType', i.source_type,
    'sourceId', i.source_id
  )), '[]'::jsonb)
  into v_changed_sources
  from public.money_transfer_items i
  where i.transfer_id = v_id;

  delete from public.money_transfer_items i
  where i.transfer_id = v_id
    and not (i.id = any(v_item_ids));

  insert into public.money_transfer_items (
    id, transfer_id, source_type, source_id, rubber_bill_id, customer_name, amount
  )
  select
    (x->>'id')::uuid,
    v_id,
    'rubber_bill',
    (x->>'sourceId')::uuid,
    (x->>'sourceId')::uuid,
    b.customer_name,
    b.net_total
  from jsonb_array_elements(coalesce(p_payload->'items', '[]'::jsonb)) x
  join public.rubber_bills b on b.id = (x->>'sourceId')::uuid
  where not exists (
    select 1
    from public.money_transfer_items existing
    where existing.id = (x->>'id')::uuid
      and existing.transfer_id = v_id
      and existing.source_type = 'rubber_bill'
      and existing.source_id = (x->>'sourceId')::uuid
      and existing.customer_name is not distinct from b.customer_name
      and existing.amount is not distinct from b.net_total
  )
  on conflict (id) do update set
    source_type = excluded.source_type,
    source_id = excluded.source_id,
    rubber_bill_id = excluded.rubber_bill_id,
    customer_name = excluded.customer_name,
    amount = excluded.amount
  where money_transfer_items.transfer_id = v_id
    and (
      money_transfer_items.source_type is distinct from excluded.source_type
      or money_transfer_items.source_id is distinct from excluded.source_id
      or money_transfer_items.rubber_bill_id is distinct from excluded.rubber_bill_id
      or money_transfer_items.customer_name is distinct from excluded.customer_name
      or money_transfer_items.amount is distinct from excluded.amount
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'sourceType', changed.source_type,
    'sourceId', changed.source_id
  ) order by changed.source_type, changed.source_id), '[]'::jsonb)
  into v_changed_sources
  from (
    select
      old_source.value->>'sourceType' source_type,
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

-- Ordinary clients may read these tables through RLS, but every write must use
-- the server-authoritative RPCs above. service_role remains available for tests
-- and operational recovery.
revoke insert, update, delete on public.money_transfers from authenticated;
revoke insert, update, delete on public.money_transfer_slips from authenticated;
revoke insert, update, delete on public.money_transfer_items from authenticated;

create or replace function public.delete_money_transfer(
  p_transfer_id uuid,
  p_expected_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer public.money_transfers;
begin
  if p_transfer_id is null or p_expected_revision is null then
    raise exception 'MT_INVALID_PAYLOAD: ข้อมูลลบรายการโอนไม่ครบ';
  end if;

  select * into v_transfer
  from public.money_transfers t
  where t.id = p_transfer_id
  for update;

  if not found then
    raise exception 'MONEY_TRANSFER_NOT_FOUND';
  end if;

  if v_transfer.record_status <> 'deleted'
    and v_transfer.revision_no <> p_expected_revision then
    raise exception 'MT_REVISION_CONFLICT: ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดใหม่';
  end if;

  return public.delete_money_transfer(p_transfer_id);
end;
$$;

revoke all on function public.delete_money_transfer(uuid) from authenticated;
revoke all on function public.delete_money_transfer(uuid, integer) from public, anon;
grant execute on function public.delete_money_transfer(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
