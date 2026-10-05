-- Remove Rubber price quotas while preserving the central-price allowance policy.

-- Preserve the current maximum allowance actor/time as standalone provenance.
alter table public.rubber_bill_approval_settings
  rename column quota_updated_by_user_id to max_price_allowance_updated_by_user_id;
alter table public.rubber_bill_approval_settings
  rename column quota_updated_by_name to max_price_allowance_updated_by_name;
alter table public.rubber_bill_approval_settings
  rename column quota_updated_by_phone to max_price_allowance_updated_by_phone;
alter table public.rubber_bill_approval_settings
  rename column quota_updated_at to max_price_allowance_updated_at;

alter table public.rubber_bill_approval_settings
  rename constraint rubber_bill_approval_settings_quota_updated_by_user_id_fkey
  to rubber_bill_settings_max_allowance_actor_fkey;

create function private.resolve_rubber_bill_price_policy_without_quota(p_location_id uuid)
returns table (
  group_id uuid,
  rule_source text,
  central_price numeric,
  price_allowance numeric,
  effective_price_cap numeric,
  edit_window_minutes integer,
  price_rule_revision bigint,
  updated_by_name text,
  updated_by_phone text,
  updated_at timestamptz,
  non_current_date_requires_approval boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    g.id,
    case when g.id is null then 'ungrouped' else 'group' end,
    s.central_price,
    coalesce(g.price_allowance, s.ungrouped_price_allowance),
    s.central_price + coalesce(g.price_allowance, s.ungrouped_price_allowance),
    coalesce(g.edit_window_minutes, s.ungrouped_edit_window_minutes),
    s.price_rule_revision,
    coalesce(g.updated_by_name, s.ungrouped_updated_by_name),
    coalesce(g.updated_by_phone, s.ungrouped_updated_by_phone),
    coalesce(g.updated_at, s.ungrouped_updated_at),
    s.non_current_date_requires_approval
  from public.rubber_bill_approval_settings s
  left join public.rubber_approval_group_locations gl
    on gl.location_id = p_location_id
  left join public.rubber_approval_groups g
    on g.id = gl.group_id
  where s.id = true
$$;

create or replace function private.effective_rubber_approval_settings(p_location_id uuid)
returns table (
  group_id uuid,
  price_time_exempt boolean,
  edit_window_minutes integer,
  configured_price numeric,
  updated_by_name text,
  updated_by_phone text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    policy.group_id,
    false,
    policy.edit_window_minutes,
    coalesce(
      nullif(current_setting('lanflow.rubber_price_cap_override', true), '')::numeric,
      policy.effective_price_cap
    ),
    policy.updated_by_name,
    policy.updated_by_phone,
    policy.updated_at
  from private.resolve_rubber_bill_price_policy_without_quota(p_location_id) policy
$$;

create or replace function public.get_effective_rubber_approval_settings(p_location_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_policy record;
begin
  if p_location_id is null
     or not private.is_active_user()
     or not private.can_access_location(p_location_id) then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์ดูการตั้งค่าของสาขานี้';
  end if;
  if not exists (
    select 1 from public.locations l
    where l.id = p_location_id and l.is_active = true
  ) then
    raise exception 'RUBBER_LOCATION_NOT_FOUND: ไม่พบสาขาที่ใช้งาน';
  end if;

  select * into v_policy
  from private.resolve_rubber_bill_price_policy_without_quota(p_location_id);

  return jsonb_build_object(
    'locationId', p_location_id,
    'groupId', v_policy.group_id,
    'ruleSource', v_policy.rule_source,
    'editWindowMinutes', v_policy.edit_window_minutes,
    'centralPrice', v_policy.central_price,
    'priceAllowance', v_policy.price_allowance,
    'effectivePriceCap', v_policy.effective_price_cap,
    'priceRuleRevision', v_policy.price_rule_revision,
    'nonCurrentDateRequiresApproval', v_policy.non_current_date_requires_approval,
    'updatedByName', v_policy.updated_by_name,
    'updatedByPhone', v_policy.updated_by_phone,
    'updatedAt', v_policy.updated_at
  );
end
$$;

create or replace function public.list_rubber_approval_groups()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_groups jsonb;
  v_ungrouped_location_ids jsonb;
  v_settings public.rubber_bill_approval_settings%rowtype;
begin
  if not private.is_active_user() or not private.can_access_super_admin_features() then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์จัดการกลุ่มอนุมัติบิลยาง';
  end if;

  select * into v_settings
  from public.rubber_bill_approval_settings
  where id = true;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', grouped.id,
    'locationIds', grouped.location_ids,
    'editWindowMinutes', grouped.edit_window_minutes,
    'priceAllowance', grouped.price_allowance,
    'revisionNo', grouped.revision_no,
    'updatedByName', grouped.updated_by_name,
    'updatedByPhone', grouped.updated_by_phone,
    'updatedAt', grouped.updated_at
  ) order by grouped.created_at, grouped.id), '[]'::jsonb)
  into v_groups
  from (
    select g.id, g.edit_window_minutes, g.price_allowance, g.revision_no,
      g.updated_by_name, g.updated_by_phone, g.created_at, g.updated_at,
      to_jsonb(array_agg(gl.location_id order by l.name, gl.location_id)) location_ids
    from public.rubber_approval_groups g
    join public.rubber_approval_group_locations gl on gl.group_id = g.id
    join public.locations l on l.id = gl.location_id
    group by g.id
  ) grouped;

  select coalesce(jsonb_agg(l.id order by l.name, l.id), '[]'::jsonb)
  into v_ungrouped_location_ids
  from public.locations l
  where l.is_active = true
    and not exists (
      select 1 from public.rubber_approval_group_locations gl
      where gl.location_id = l.id
    );

  return jsonb_build_object(
    'groups', v_groups,
    'availableLocationIds', v_ungrouped_location_ids,
    'centralPrice', jsonb_build_object(
      'value', v_settings.central_price,
      'revision', v_settings.central_price_revision,
      'updatedByName', v_settings.central_price_updated_by_name,
      'updatedByPhone', v_settings.central_price_updated_by_phone,
      'updatedAt', v_settings.central_price_updated_at
    ),
    'ungroupedDefaults', jsonb_build_object(
      'locationIds', v_ungrouped_location_ids,
      'editWindowMinutes', v_settings.ungrouped_edit_window_minutes,
      'priceAllowance', v_settings.ungrouped_price_allowance,
      'revision', v_settings.ungrouped_revision,
      'updatedByName', v_settings.ungrouped_updated_by_name,
      'updatedByPhone', v_settings.ungrouped_updated_by_phone,
      'updatedAt', v_settings.ungrouped_updated_at
    ),
    'maxPriceAllowance', jsonb_build_object(
      'value', v_settings.max_price_allowance,
      'updatedByName', v_settings.max_price_allowance_updated_by_name,
      'updatedByPhone', v_settings.max_price_allowance_updated_by_phone,
      'updatedAt', v_settings.max_price_allowance_updated_at
    )
  );
end
$$;

create or replace function private.rubber_bill_submission_decision(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_operation text;
  v_location_id uuid;
  v_bill public.rubber_bills%rowtype;
  v_policy record;
  v_proposed_prices jsonb := '[]'::jsonb;
  v_current_prices jsonb := '[]'::jsonb;
  v_max_price numeric;
  v_price_changed boolean := false;
  v_business_date date;
  v_non_price_approval boolean := false;
begin
  v_operation := payload->>'operation';
  if not coalesce(private.is_active_user(), false) then
    return jsonb_build_object('disposition', 'failed', 'errorMessage', 'Unauthorized or inactive user');
  end if;
  if v_operation is null or v_operation not in ('create', 'update', 'delete') then
    return jsonb_build_object('disposition', 'failed', 'errorMessage', 'Invalid operation');
  end if;
  begin
    v_location_id := (payload->>'locationId')::uuid;
  exception when others then
    return jsonb_build_object('disposition', 'failed', 'errorMessage', 'Invalid approval payload');
  end;
  if v_location_id is null
     or coalesce(payload->>'clientTempId', '') = ''
     or coalesce(payload->>'idempotencyKey', '') = ''
     or not public.can_access_location(v_location_id) then
    return jsonb_build_object('disposition', 'failed', 'errorMessage', 'Location access denied or invalid identity');
  end if;
  begin
    v_payload := private.normalize_rubber_bill_calculation_payload(payload);
  exception
    when raise_exception then
      return jsonb_build_object('disposition', 'failed', 'errorMessage', sqlerrm);
    when others then
      return jsonb_build_object('disposition', 'failed', 'errorMessage', 'ข้อมูลตัวเลขในบิลยางไม่ถูกต้อง');
  end;

  select * into v_policy
  from private.resolve_rubber_bill_price_policy_without_quota(v_location_id);
  if v_policy.central_price is null then
    return jsonb_build_object('disposition', 'failed', 'errorMessage', 'ไม่พบกติกาบิลยาง');
  end if;

  if v_operation = 'delete' then
    select * into v_bill from public.rubber_bills b
    where b.client_temp_id = v_payload->>'clientTempId';
    if v_bill.id is null then
      return jsonb_build_object('disposition', 'failed', 'errorMessage', 'Cannot delete non-existent record');
    end if;
    if v_bill.location_id <> v_location_id then
      return jsonb_build_object('disposition', 'failed', 'errorMessage', 'Location mismatch');
    end if;
    v_business_date := v_bill.bill_date;
  elsif v_operation = 'update' then
    select * into v_bill from public.rubber_bills b
    where b.client_temp_id = v_payload->>'clientTempId';
    if v_bill.id is null then
      return jsonb_build_object('disposition', 'failed', 'errorMessage', 'Cannot update non-existent record');
    end if;
    if v_bill.location_id <> v_location_id then
      return jsonb_build_object('disposition', 'failed', 'errorMessage', 'Location mismatch');
    end if;
    begin
      v_business_date := (v_payload->>'billDate')::date;
    exception when others then
      return jsonb_build_object('disposition', 'failed', 'errorMessage', 'วันที่บิลไม่ถูกต้อง');
    end;
  else
    begin
      v_business_date := (v_payload->>'billDate')::date;
    exception when others then
      return jsonb_build_object('disposition', 'failed', 'errorMessage', 'วันที่บิลไม่ถูกต้อง');
    end;
  end if;

  if v_bill.id is not null then
    if private.active_report_no('rubber_bill', v_bill.id) is not null then
      return jsonb_build_object('disposition', 'failed', 'errorMessage', 'บิลอยู่ในรายงานแล้ว จึงดำเนินการไม่ได้');
    end if;
    if private.rubber_bill_has_active_transfer(v_bill.id) then
      return jsonb_build_object('disposition', 'failed', 'errorMessage', 'บิลอยู่ในรายการโอนเงินแล้ว จึงดำเนินการไม่ได้');
    end if;
    if clock_timestamp() >= v_bill.created_at
       + make_interval(mins => v_policy.edit_window_minutes) then
      v_non_price_approval := true;
    end if;
  end if;
  if v_policy.non_current_date_requires_approval
     and v_business_date is distinct from (clock_timestamp() at time zone 'Asia/Bangkok')::date then
    v_non_price_approval := true;
  end if;

  if v_operation in ('create', 'update') then
    select
      coalesce(jsonb_agg((item->>'unitPrice')::numeric order by (item->>'sequenceNo')::integer), '[]'::jsonb),
      max((item->>'unitPrice')::numeric)
    into v_proposed_prices, v_max_price
    from jsonb_array_elements(coalesce(v_payload->'items', '[]'::jsonb)) item
    where item->>'itemType' = 'weigh';
  end if;
  if v_operation = 'create' then
    v_price_changed := true;
  elsif v_operation = 'update' then
    select coalesce(jsonb_agg(i.price order by i.sequence_no), '[]'::jsonb)
    into v_current_prices
    from public.rubber_bill_items i
    where i.bill_id = v_bill.id and i.item_type = 'weigh';
    v_price_changed := v_current_prices is distinct from v_proposed_prices;
  end if;

  return jsonb_build_object(
    'disposition', case
      when v_non_price_approval then 'approval_required'
      when v_price_changed and v_max_price is not null and v_max_price > v_policy.effective_price_cap
        then 'approval_required'
      else 'direct'
    end,
    'priceDecision', case
      when v_non_price_approval then 'not_applicable'
      when not v_price_changed then 'unchanged'
      when v_max_price is not null and v_max_price > v_policy.effective_price_cap then 'above_cap'
      else 'within_cap'
    end,
    'priceChanged', v_price_changed,
    'centralPrice', v_policy.central_price,
    'priceAllowance', v_policy.price_allowance,
    'effectivePriceCap', v_policy.effective_price_cap,
    'priceRuleRevision', v_policy.price_rule_revision,
    'ruleSource', v_policy.rule_source,
    'maxPrice', v_max_price
  );
exception when others then
  return jsonb_build_object('disposition', 'failed', 'errorMessage', 'ตรวจสอบกติกาบิลยางไม่สำเร็จ');
end
$$;

create or replace function public.sync_rubber_bill(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation text := payload->>'operation';
  v_business_date date;
  v_requires_approval boolean := false;
  v_decision jsonb;
  v_reservation jsonb;
  v_result jsonb;
  v_bill_id uuid;
  v_request_id uuid;
  v_location_id uuid;
  v_expected_revision integer;
  v_existing_bill public.rubber_bills%rowtype;
  v_existing_request public.rubber_bill_approval_requests%rowtype;
begin
  if not coalesce(private.is_active_user(), false) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Unauthorized or inactive user');
  end if;
  if v_operation is null or v_operation not in ('create', 'update', 'delete') then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid operation');
  end if;
  begin
    v_location_id := (payload->>'locationId')::uuid;
    v_expected_revision := (payload->>'expectedRevisionNo')::integer;
  exception when others then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid approval payload');
  end;
  if v_location_id is null or v_expected_revision is null or v_expected_revision < 0
     or coalesce(payload->>'clientTempId', '') = ''
     or coalesce(payload->>'idempotencyKey', '') = ''
     or not public.can_access_location(v_location_id) then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Location access denied or invalid identity');
  end if;

  select * into v_existing_bill
  from public.rubber_bills b
  where b.client_temp_id = payload->>'clientTempId'
    and b.location_id = v_location_id
    and b.idempotency_key = payload->>'idempotencyKey';
  if v_existing_bill.id is not null then
    if not (
      (v_operation = 'create' and v_expected_revision = 0 and v_existing_bill.revision_no = 1 and v_existing_bill.record_status = 'active')
      or (v_operation = 'update' and v_existing_bill.revision_no > 1 and v_expected_revision = v_existing_bill.revision_no - 1 and v_existing_bill.record_status = 'active')
      or (v_operation = 'delete' and v_existing_bill.revision_no > 1 and v_expected_revision = v_existing_bill.revision_no - 1 and v_existing_bill.record_status = 'deleted')
    ) then
      return jsonb_build_object('status', 'conflict', 'errorMessage', 'Idempotency key operation mismatch');
    end if;
    return jsonb_build_object(
      'status', 'synced',
      'id', v_existing_bill.id,
      'serverBillNo', v_existing_bill.server_bill_no,
      'revisionNo', v_existing_bill.revision_no,
      'serverReceivedAt', v_existing_bill.server_received_at
    );
  end if;

  select * into v_existing_request
  from public.rubber_bill_approval_requests r
  where r.client_temp_id = payload->>'clientTempId'
    and r.location_id = v_location_id
    and r.idempotency_key = payload->>'idempotencyKey'
  order by r.requested_at
  limit 1;
  if v_existing_request.id is not null
     and (v_existing_request.operation is distinct from v_operation
       or v_existing_request.base_revision_no is distinct from v_expected_revision) then
    return jsonb_build_object('status', 'conflict', 'errorMessage', 'Idempotency key operation mismatch');
  end if;
  if v_operation = 'create' and v_existing_request.id is not null then
    if v_existing_request.request_status = 'approved' and v_existing_request.created_bill_id is not null then
      select * into v_existing_bill from public.rubber_bills b
      where b.id = v_existing_request.created_bill_id;
      if v_existing_bill.id is not null then
        return jsonb_build_object(
          'status', 'synced', 'id', v_existing_bill.id,
          'serverBillNo', v_existing_bill.server_bill_no,
          'revisionNo', v_existing_bill.revision_no,
          'serverReceivedAt', v_existing_bill.server_received_at
        );
      end if;
    end if;
    return jsonb_build_object(
      'status', 'pending_approval', 'requestId', v_existing_request.id,
      'operation', v_operation, 'clientTempId', payload->>'clientTempId'
    );
  end if;

  begin
    if v_operation = 'delete' then
      select bill_date into v_business_date from public.rubber_bills
      where client_temp_id = payload->>'clientTempId';
    else
      v_business_date := (payload->>'billDate')::date;
    end if;
  exception when others then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'วันที่บิลไม่ถูกต้อง');
  end;
  select coalesce(non_current_date_requires_approval, false)
  into v_requires_approval
  from public.rubber_bill_approval_settings where id = true;
  if v_requires_approval
     and v_business_date is distinct from (clock_timestamp() at time zone 'Asia/Bangkok')::date then
    payload := payload || jsonb_build_object('forceNonCurrentDateApproval', true);
  end if;

  perform pg_advisory_xact_lock_shared(hashtextextended('rubber-approval-policy', 0));
  v_decision := private.rubber_bill_submission_decision(payload);
  if v_decision->>'disposition' = 'failed' then
    return jsonb_build_object(
      'status', 'failed',
      'errorMessage', coalesce(v_decision->>'errorMessage', 'ตรวจสอบกติกาบิลยางไม่สำเร็จ')
    );
  end if;

  begin
    v_reservation := private.reserve_rubber_bill_ocr_source(payload);
    if v_reservation->>'status' = 'conflict' then return v_reservation; end if;
    if v_reservation->>'status' <> 'ok' then
      v_result := v_reservation;
      raise exception using errcode = 'P0002', message = 'ROLLBACK_OCR_RESERVATION';
    end if;

    v_result := private.sync_rubber_bill_approval_20260823010000(payload);
    if v_result->>'status' in ('failed', 'conflict') then
      raise exception using errcode = 'P0002', message = 'ROLLBACK_OCR_RESERVATION';
    end if;

    if v_result->>'status' = 'synced' then
      v_bill_id := (v_result->>'id')::uuid;
      if v_operation = 'create' or coalesce((v_decision->>'priceChanged')::boolean, false) then
        update public.rubber_bills
        set central_price_snapshot = (v_decision->>'centralPrice')::numeric,
            price_allowance_snapshot = (v_decision->>'priceAllowance')::numeric,
            effective_price_cap_snapshot = (v_decision->>'effectivePriceCap')::numeric,
            price_rule_revision_snapshot = (v_decision->>'priceRuleRevision')::bigint,
            rubber_price_rule_source = v_decision->>'ruleSource'
        where id = v_bill_id;
      end if;
    elsif v_result->>'status' = 'pending_approval' then
      v_request_id := (v_result->>'requestId')::uuid;
      update public.rubber_bill_approval_requests
      set configured_price_snapshot = (v_decision->>'effectivePriceCap')::numeric,
          central_price_snapshot = (v_decision->>'centralPrice')::numeric,
          price_allowance_snapshot = (v_decision->>'priceAllowance')::numeric,
          effective_price_cap_snapshot = (v_decision->>'effectivePriceCap')::numeric,
          price_rule_revision_snapshot = (v_decision->>'priceRuleRevision')::bigint,
          rubber_price_rule_source = v_decision->>'ruleSource'
      where id = v_request_id;
    end if;
    return v_result;
  exception when sqlstate 'P0002' then
    return v_result;
  when others then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'บันทึกบิลยางไม่สำเร็จ');
  end;
end
$$;

create or replace function public.approve_rubber_bill_approval_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_request public.rubber_bill_approval_requests%rowtype;
  v_result jsonb;
  v_actor_name text;
  v_actor_phone text;
  v_created_bill_id uuid;
  v_report_no text;
begin
  if not private.is_active_user() or not public.can_access_super_admin_features() then
    raise exception 'ไม่มีสิทธิ์อนุมัติคำขอบิลยาง';
  end if;
  select * into v_request from public.rubber_bill_approval_requests
  where id = p_request_id for update;
  if v_request.id is null or v_request.request_status <> 'pending' then
    raise exception 'ไม่พบคำขอที่รออนุมัติ';
  end if;
  if v_request.bill_id is not null then
    perform pg_advisory_xact_lock(hashtext('rubber-bill-approval:' || v_request.bill_id::text));
    v_report_no := private.active_report_no('rubber_bill', v_request.bill_id);
    if v_report_no is not null then raise exception 'บิลอยู่ในรายงาน % แล้ว จึงอนุมัติไม่ได้', v_report_no; end if;
    if private.rubber_bill_has_active_transfer(v_request.bill_id) then
      raise exception 'บิลอยู่ในรายการโอนเงินแล้ว จึงอนุมัติไม่ได้';
    end if;
  else
    perform pg_advisory_xact_lock(hashtext('rubber-bill-create:' || v_request.client_temp_id));
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_request.location_id::text, 0));

  if v_request.operation = 'create' and v_request.proposed_payload->>'inputMethod' = 'ocr' then
    perform 1 from public.rubber_bill_ocr_sources s
    where s.id = nullif(v_request.proposed_payload->>'ocrUploadId', '')::uuid
      and s.owner_user_id = v_request.requested_by_user_id
      and s.location_id = v_request.location_id
      and s.reserved_client_temp_id = v_request.client_temp_id
      and s.reserved_idempotency_key = v_request.idempotency_key
      and s.state = 'reserved'
    for update;
    if not found then raise exception 'ข้อมูลอ้างอิงรูป OCR ไม่ตรงกับคำขออนุมัติ'; end if;
  end if;

  v_result := public.sync_rubber_bill_core_20260725010000(v_request.proposed_payload);
  if v_result->>'status' <> 'synced' then
    raise exception '%', coalesce(v_result->>'errorMessage', 'อนุมัติคำขอไม่สำเร็จ');
  end if;
  v_created_bill_id := (v_result->>'id')::uuid;
  select name, phone into v_actor_name, v_actor_phone
  from public.profiles where id = auth.uid();

  update public.rubber_bills
  set created_by_user_id = case when v_request.operation = 'create' then v_request.requested_by_user_id else created_by_user_id end,
      created_by_name = case when v_request.operation = 'create' then v_request.requested_by_name else created_by_name end,
      created_by_phone = case when v_request.operation = 'create' then v_request.requested_by_phone else created_by_phone end,
      approval_state = 'approved',
      approved_by_name = coalesce(v_actor_name, ''),
      approval_revision_no = revision_no,
      central_price_snapshot = case when v_request.operation = 'create' or 'price' = any(v_request.matched_reasons) then v_request.central_price_snapshot else central_price_snapshot end,
      price_allowance_snapshot = case when v_request.operation = 'create' or 'price' = any(v_request.matched_reasons) then v_request.price_allowance_snapshot else price_allowance_snapshot end,
      effective_price_cap_snapshot = case when v_request.operation = 'create' or 'price' = any(v_request.matched_reasons) then v_request.effective_price_cap_snapshot else effective_price_cap_snapshot end,
      price_rule_revision_snapshot = case when v_request.operation = 'create' or 'price' = any(v_request.matched_reasons) then v_request.price_rule_revision_snapshot else price_rule_revision_snapshot end,
      rubber_price_rule_source = case when v_request.operation = 'create' or 'price' = any(v_request.matched_reasons) then v_request.rubber_price_rule_source else rubber_price_rule_source end
  where id = v_created_bill_id;

  update public.rubber_bill_approval_requests
  set request_status = 'approved', approved_by_user_id = auth.uid(),
      approved_by_name = coalesce(v_actor_name, ''), approved_by_phone = coalesce(v_actor_phone, ''),
      approved_at = now(), created_bill_id = case when operation = 'create' then v_created_bill_id else null end
  where id = p_request_id;

  return jsonb_build_object(
    'status', 'approved', 'requestId', p_request_id, 'operation', v_request.operation,
    'billId', v_created_bill_id, 'syncResult', v_result
  );
end
$$;

create or replace function public.save_rubber_max_price_allowance(
  p_max_price_allowance numeric,
  p_expected_max_price_allowance numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.rubber_bill_approval_settings%rowtype;
  v_actor public.profiles%rowtype;
  v_conflicts jsonb := '[]'::jsonb;
begin
  if not private.is_active_user() or not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active = true and p.role = 'super_admin'
  ) then
    raise exception 'FORBIDDEN: เฉพาะ super admin เท่านั้นที่ตั้งราคายางที่กำหนดสูงสุดได้';
  end if;
  if p_max_price_allowance is null or p_max_price_allowance < 0 or scale(p_max_price_allowance) > 2
     or p_max_price_allowance > 9999999999.99 then
    raise exception 'RUBBER_ALLOWANCE_INVALID: ราคายางที่กำหนดสูงสุดต้องไม่ติดลบและมีทศนิยมไม่เกิน 2 ตำแหน่ง';
  end if;
  if p_expected_max_price_allowance is null then
    raise exception 'RUBBER_ALLOWANCE_STALE: ไม่พบค่าที่กำลังยืนยัน';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('rubber-approval-policy', 0));
  select * into v_settings from public.rubber_bill_approval_settings
  where id = true for update;
  if v_settings.max_price_allowance is distinct from p_expected_max_price_allowance then
    return jsonb_build_object(
      'status', 'conflict', 'code', 'RUBBER_ALLOWANCE_STALE',
      'errorMessage', 'ราคายางที่กำหนดสูงสุดถูกแก้ไขโดยผู้ใช้อื่น กรุณาตรวจสอบค่าล่าสุดและยืนยันอีกครั้ง',
      'conflicts', '[]'::jsonb
    );
  end if;
  if v_settings.max_price_allowance = p_max_price_allowance then
    return jsonb_build_object(
      'status', 'unchanged',
      'setting', jsonb_build_object(
        'value', v_settings.max_price_allowance,
        'updatedByName', v_settings.max_price_allowance_updated_by_name,
        'updatedByPhone', v_settings.max_price_allowance_updated_by_phone,
        'updatedAt', v_settings.max_price_allowance_updated_at
      )
    );
  end if;

  select coalesce(jsonb_agg(conflict order by conflict->>'scope', conflict->>'groupId'), '[]'::jsonb)
  into v_conflicts
  from (
    select jsonb_build_object(
      'scope', 'group', 'groupId', g.id, 'locationIds', to_jsonb(array_agg(gl.location_id order by gl.location_id)),
      'allowance', g.price_allowance
    ) conflict
    from public.rubber_approval_groups g
    join public.rubber_approval_group_locations gl on gl.group_id = g.id
    where g.price_allowance > p_max_price_allowance
    group by g.id
    union all
    select jsonb_build_object(
      'scope', 'ungrouped', 'locationIds', coalesce(
        (select jsonb_agg(l.id order by l.name, l.id)
         from public.locations l
         where l.is_active = true and not exists (
           select 1 from public.rubber_approval_group_locations gl where gl.location_id = l.id
         )), '[]'::jsonb
      ),
      'allowance', v_settings.ungrouped_price_allowance
    )
    where v_settings.ungrouped_price_allowance > p_max_price_allowance
  ) conflicts;
  if jsonb_array_length(v_conflicts) > 0 then
    return jsonb_build_object(
      'status', 'conflict', 'code', 'RUBBER_ALLOWANCE_LIMIT_TOO_LOW',
      'errorMessage', 'ราคายางที่กำหนดสูงสุดต้องไม่น้อยกว่าค่าที่กลุ่มหรือสาขาที่ยังไม่จัดกลุ่มใช้อยู่',
      'conflicts', v_conflicts
    );
  end if;
  if v_settings.central_price + p_max_price_allowance > 9999999999.99 then
    raise exception 'RUBBER_EFFECTIVE_PRICE_CAP_INVALID: ราคากลางรวมส่วนต่างต้องไม่เกิน 9,999,999,999.99 บาท';
  end if;

  select * into v_actor from public.profiles p where p.id = auth.uid();
  update public.rubber_bill_approval_settings
  set max_price_allowance = p_max_price_allowance,
      max_price_allowance_updated_by_user_id = auth.uid(),
      max_price_allowance_updated_by_name = v_actor.name,
      max_price_allowance_updated_by_phone = v_actor.phone,
      max_price_allowance_updated_at = clock_timestamp()
  where id = true
  returning * into v_settings;

  return jsonb_build_object(
    'status', 'saved',
    'setting', jsonb_build_object(
      'value', v_settings.max_price_allowance,
      'updatedByName', v_settings.max_price_allowance_updated_by_name,
      'updatedByPhone', v_settings.max_price_allowance_updated_by_phone,
      'updatedAt', v_settings.max_price_allowance_updated_at
    )
  );
end
$$;

-- Detach all active consumers before removing the old resolver and quota storage.
drop function private.resolve_rubber_bill_price_policy(uuid);

drop function if exists public.preview_rubber_bill_submission(jsonb);
drop function if exists public.save_rubber_admin_quota(integer, uuid);
drop function if exists public.save_rubber_admin_quota_v2(integer, numeric, uuid);
drop function if exists private.can_use_rubber_bill_price_quota();

alter table public.rubber_bills drop constraint if exists rubber_bills_quota_use_fk;
alter table public.rubber_bills drop column if exists rubber_price_quota_use_id;
drop table public.rubber_bill_price_quota_uses;

alter table public.rubber_bill_approval_settings
  drop constraint if exists rubber_bill_approval_quota_limit_check,
  drop column quota_limit_per_admin,
  drop column quota_round_id;

revoke all on function public.save_rubber_max_price_allowance(numeric, numeric) from public, anon;
grant execute on function public.save_rubber_max_price_allowance(numeric, numeric) to authenticated;
revoke all on function private.resolve_rubber_bill_price_policy_without_quota(uuid) from public, anon, authenticated;
revoke all on function private.rubber_bill_submission_decision(jsonb) from public, anon, authenticated;
