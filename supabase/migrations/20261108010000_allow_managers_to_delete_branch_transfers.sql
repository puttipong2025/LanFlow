-- Keep legacy branch transfers read-only through every delete path.
create or replace function public.delete_money_transfer_before_branch_receipt(
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

  if v_transfer.transfer_type = 'branch'
    and v_transfer.branch_receipt_contract_version is distinct from 1
  then
    raise exception 'MT_LEGACY_BRANCH_READ_ONLY: รายการโอนระหว่างสาขารุ่นเดิมลบไม่ได้';
  end if;

  if v_transfer.record_status <> 'deleted'
    and v_transfer.revision_no <> p_expected_revision
  then
    raise exception 'MT_REVISION_CONFLICT: ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดใหม่';
  end if;

  return public.delete_money_transfer(p_transfer_id);
end;
$$;

create or replace function public.decide_branch_transfer_delete_request(
  p_request_id uuid,
  p_decision text,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.branch_transfer_delete_requests%rowtype;
  v_transfer public.money_transfers;
  v_decider_name text;
  v_decider_phone text;
  v_locked_location_id uuid;
  v_locked_transfer_id uuid;
  v_locked_target_location_id uuid;
  v_comment text := nullif(btrim(p_comment), '');
begin
  if not private.is_active_user() or not private.can_access_super_admin_features() then
    raise exception 'เฉพาะผู้จัดการระบบเท่านั้นที่อนุมัติหรือปฏิเสธได้';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'คำตัดสินไม่ถูกต้อง';
  end if;
  if char_length(v_comment) > 500 then
    raise exception 'เหตุผลยาวเกินไป';
  end if;

  if p_decision = 'approved' then
    select request.location_id, request.transfer_id, transfer.target_location_id
    into v_locked_location_id, v_locked_transfer_id, v_locked_target_location_id
    from public.branch_transfer_delete_requests request
    join public.money_transfers transfer on transfer.id = request.transfer_id
    where request.id = p_request_id;
    if v_locked_location_id is null or v_locked_transfer_id is null then
      raise exception 'ไม่พบคำขอลบรายการโอนเงิน';
    end if;
    perform private.lock_report_locations(array[v_locked_location_id, v_locked_target_location_id]);
  end if;

  select * into v_request
  from public.branch_transfer_delete_requests request
  where request.id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'ไม่พบคำขอลบรายการโอนเงิน';
  end if;
  if v_request.request_status <> 'pending' then
    raise exception 'คำขอนี้ถูกดำเนินการแล้ว';
  end if;

  if p_decision = 'approved' then
    if v_request.location_id is distinct from v_locked_location_id
      or v_request.transfer_id is distinct from v_locked_transfer_id then
      raise exception 'คำขอลบถูกแก้ไขแล้ว กรุณาลองใหม่';
    end if;
    select * into v_transfer
    from public.money_transfers transfer
    where transfer.id = v_request.transfer_id
    for update;

    if v_transfer.id is null or v_transfer.record_status = 'deleted' then
      raise exception 'ไม่พบรายการโอนเงินต้นทาง';
    end if;
    if v_transfer.location_id is distinct from v_locked_location_id
      or v_transfer.target_location_id is distinct from v_locked_target_location_id then
      raise exception 'คำขอลบถูกแก้ไขแล้ว กรุณาลองใหม่';
    end if;
    if public.report_lock_no(v_transfer) is not null then
      raise exception 'MT_REPORT_LOCKED: รายการถูกล็อกโดยรายงาน';
    end if;

    perform public.delete_money_transfer_before_branch_receipt(v_transfer.id, v_transfer.revision_no);
  end if;

  select profile.name, profile.phone into v_decider_name, v_decider_phone
  from public.profiles profile
  where profile.id = auth.uid();

  update public.branch_transfer_delete_requests request set
    request_status = p_decision,
    decided_by_user_id = auth.uid(),
    decided_by_name = coalesce(v_decider_name, ''),
    decided_by_phone = coalesce(v_decider_phone, ''),
    decided_at = statement_timestamp(),
    decision_comment = v_comment,
    updated_at = statement_timestamp()
  where request.id = p_request_id;

  return jsonb_build_object('status', p_decision, 'requestId', p_request_id);
end;
$$;

create or replace function public.request_branch_money_transfer_delete(
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
  v_requires_approval boolean;
  v_existing_request_id uuid;
  v_request_id uuid;
  v_actor_name text;
  v_actor_phone text;
  v_locked_location_id uuid;
  v_locked_target_location_id uuid;
  v_report_no text;
  v_can_manage boolean;
begin
  if not private.is_active_user() or not private.can_access_money_transfer_module() then
    raise exception 'MT_ACCESS_DENIED: ไม่มีสิทธิ์ลบรายการโอนเงิน';
  end if;
  if p_transfer_id is null or p_expected_revision is null then
    raise exception 'MT_INVALID_PAYLOAD: ข้อมูลลบรายการโอนไม่ครบ';
  end if;

  select transfer.location_id, transfer.target_location_id
  into v_locked_location_id, v_locked_target_location_id
  from public.money_transfers transfer
  where transfer.id = p_transfer_id
    and transfer.record_status <> 'deleted'
    and transfer.transfer_type = 'branch'
    and private.can_access_location(transfer.location_id);
  if v_locked_location_id is null then
    raise exception 'MT_NOT_FOUND: ไม่พบรายการโอนเงิน';
  end if;
  perform private.lock_report_locations(array[v_locked_location_id, v_locked_target_location_id]);

  select * into v_transfer
  from public.money_transfers transfer
  where transfer.id = p_transfer_id
    and private.can_access_location(transfer.location_id)
  for update;

  if v_transfer.id is null or v_transfer.record_status = 'deleted'
    or v_transfer.transfer_type <> 'branch' then
    raise exception 'MT_NOT_FOUND: ไม่พบรายการโอนเงิน';
  end if;
  if v_transfer.location_id is distinct from v_locked_location_id
    or v_transfer.target_location_id is distinct from v_locked_target_location_id
    or v_transfer.revision_no <> p_expected_revision then
    raise exception 'MT_REVISION_CONFLICT: ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดใหม่';
  end if;
  if v_transfer.branch_receipt_contract_version is distinct from 1 then
    raise exception 'MT_LEGACY_BRANCH_READ_ONLY: รายการรุ่นเดิมดูได้อย่างเดียว';
  end if;
  v_can_manage := private.can_access_super_admin_features();
  if v_transfer.created_by_user_id is null
    or (v_transfer.created_by_user_id is distinct from auth.uid() and not v_can_manage) then
    raise exception 'MT_DELETE_CREATOR_ONLY: เฉพาะผู้สร้างรายการเท่านั้นที่ลบได้';
  end if;
  v_report_no := public.report_lock_no(v_transfer);
  if v_report_no is not null then
    raise exception 'MT_REPORT_LOCKED:%', v_report_no;
  end if;

  if v_transfer.branch_receipt_status = 'pending_receipt' then
    return public.delete_money_transfer_before_branch_receipt(v_transfer.id, v_transfer.revision_no);
  end if;

  select request.id into v_existing_request_id
  from public.branch_transfer_delete_requests request
  where request.transfer_id = v_transfer.id
    and request.request_status = 'pending'
  for update;

  if v_can_manage and v_transfer.branch_receipt_status = 'received' then
    if v_existing_request_id is not null then
      perform public.decide_branch_transfer_delete_request(v_existing_request_id, 'approved', null);
      return jsonb_build_object('transferId', v_transfer.id, 'status', 'deleted');
    end if;
    return public.delete_money_transfer_before_branch_receipt(v_transfer.id, v_transfer.revision_no);
  end if;

  if v_existing_request_id is not null then
    return jsonb_build_object(
      'id', v_transfer.id,
      'status', 'pending_approval',
      'requestId', v_existing_request_id
    );
  end if;

  select coalesce(setting.cash_transfer_delete_requires_approval, true)
  into v_requires_approval
  from public.income_expense_approval_settings setting
  where setting.id = true;

  if not coalesce(v_requires_approval, true) then
    return public.delete_money_transfer_before_branch_receipt(v_transfer.id, v_transfer.revision_no);
  end if;

  select profile.name, profile.phone into v_actor_name, v_actor_phone
  from public.profiles profile
  where profile.id = auth.uid();

  insert into public.branch_transfer_delete_requests (
    transfer_id, location_id, location_name, transfer_display_no, amount, received_at,
    requested_by_user_id, requested_by_name, requested_by_phone
  ) values (
    v_transfer.id,
    v_transfer.location_id,
    coalesce(v_transfer.target_location_name, 'ไม่ทราบสาขา'),
    'TR-' || left(v_transfer.id::text, 8),
    v_transfer.net_amount_to_pay,
    coalesce(v_transfer.branch_received_at, v_transfer.updated_at, v_transfer.created_at),
    auth.uid(),
    coalesce(v_actor_name, ''),
    coalesce(v_actor_phone, '')
  ) returning id into v_request_id;

  return jsonb_build_object(
    'id', v_transfer.id,
    'status', 'pending_approval',
    'requestId', v_request_id
  );
end;
$$;

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
  v_locked_location_id uuid;
begin
  if not private.is_active_user() or not private.can_access_money_transfer_module() then
    raise exception 'MONEY_TRANSFER_DELETE_FORBIDDEN';
  end if;
  if p_transfer_id is null or p_expected_revision is null then
    raise exception 'MT_INVALID_PAYLOAD: ข้อมูลลบรายการโอนไม่ครบ';
  end if;

  select transfer.location_id into v_locked_location_id
  from public.money_transfers transfer
  where transfer.id = p_transfer_id
    and private.can_access_location(transfer.location_id);
  if not found then
    raise exception 'MONEY_TRANSFER_DELETE_FORBIDDEN';
  end if;
  perform private.lock_report_locations(array[v_locked_location_id]);

  select * into v_transfer
  from public.money_transfers transfer
  where transfer.id = p_transfer_id
    and private.can_access_location(transfer.location_id)
  for update;
  if not found then
    raise exception 'MONEY_TRANSFER_DELETE_FORBIDDEN';
  end if;
  if v_transfer.location_id is distinct from v_locked_location_id then
    raise exception 'MT_REVISION_CONFLICT: ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดใหม่';
  end if;

  if v_transfer.record_status <> 'deleted'
    and v_transfer.transfer_type = 'branch'
    and v_transfer.branch_receipt_contract_version = 1
    and v_transfer.branch_receipt_status = 'pending_receipt'
    and v_transfer.created_by_user_id is distinct from auth.uid()
    and (v_transfer.created_by_user_id is null or not private.can_access_super_admin_features()) then
    raise exception 'MT_DELETE_CREATOR_ONLY: เฉพาะผู้สร้างรายการเท่านั้นที่ลบได้';
  end if;

  if v_transfer.record_status <> 'deleted'
    and v_transfer.transfer_type = 'branch'
    and v_transfer.branch_receipt_contract_version = 1
    and v_transfer.branch_receipt_status is distinct from 'pending_receipt' then
    raise exception 'MT_BRANCH_DELETE_REQUEST_REQUIRED: รายการที่รับเงินแล้วต้องส่งคำขอลบให้ผู้จัดการระบบ';
  end if;

  return public.delete_money_transfer_before_branch_receipt(p_transfer_id, p_expected_revision);
end;
$$;
