-- Scope branch edits to accessible transfers and preserve read-only legacy records.
create or replace function public.save_money_transfer_before_customer_name_validation(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(p_payload->>'id', '')::uuid;
  v_operation text := coalesce(p_payload->>'operation', 'create');
  v_transfer_type text := coalesce(p_payload->>'transferType', 'customer');
  v_contract_version integer := nullif(p_payload->>'receiptContractVersion', '')::integer;
  v_requested_target_id uuid := nullif(p_payload->>'targetLocationId', '')::uuid;
  v_existing public.money_transfers;
  v_locked_location_id uuid;
  v_target_name text;
  v_delegate_payload jsonb := p_payload;
  v_result jsonb;
begin
  if v_transfer_type <> 'branch' then
    return public.save_money_transfer_before_branch_receipt(p_payload);
  end if;
  if v_contract_version is distinct from 1 then
    raise exception 'MT_CLIENT_REFRESH_REQUIRED: กรุณารีเฟรชหน้าจอก่อนสร้างหรือแก้ไขรายการโอนให้สาขา';
  end if;
  if v_id is null or v_requested_target_id is null then
    raise exception 'MT_INVALID_PAYLOAD: ข้อมูลรายการโอนไม่ครบ';
  end if;
  if not private.is_active_user() or not private.can_access_money_transfer_module() then
    raise exception 'MT_ACCESS_DENIED: ไม่มีสิทธิ์ใช้งานรายการโอนเงิน';
  end if;
  if not private.can_access_location(v_requested_target_id) then
    raise exception 'MT_TARGET_LOCATION_DENIED: ไม่มีสิทธิ์โอนให้สาขานี้';
  end if;

  select location.name into v_target_name
  from public.locations location
  where location.id = v_requested_target_id
    and location.is_active = true;
  if v_target_name is null then
    raise exception 'MT_TARGET_LOCATION_INACTIVE: สาขาผู้รับไม่เปิดใช้งาน';
  end if;

  if v_operation = 'update' then
    select * into v_existing
    from public.money_transfers transfer
    where transfer.id = v_id
      and private.can_access_location(transfer.location_id);

    if v_existing.id is null or v_existing.record_status = 'deleted'
      or v_existing.transfer_type <> 'branch' then
      raise exception 'MT_NOT_FOUND: ไม่พบรายการโอนเงิน';
    end if;
    if v_existing.branch_receipt_contract_version is distinct from 1 then
      raise exception 'MT_LEGACY_BRANCH_READ_ONLY: รายการรุ่นเดิมดูได้อย่างเดียว';
    end if;
    if v_existing.branch_receipt_status is distinct from 'pending_receipt' then
      raise exception 'MT_BRANCH_RECEIVED_IMMUTABLE: รายการที่ยืนยันรับแล้วแก้ไขไม่ได้';
    end if;
    v_locked_location_id := v_existing.location_id;
    perform private.lock_report_locations(array[v_locked_location_id, v_requested_target_id]);

    select * into v_existing
    from public.money_transfers transfer
    where transfer.id = v_id
      and private.can_access_location(transfer.location_id)
    for update;

    if v_existing.id is null or v_existing.record_status = 'deleted'
      or v_existing.transfer_type <> 'branch' then
      raise exception 'MT_NOT_FOUND: ไม่พบรายการโอนเงิน';
    end if;
    if v_existing.location_id is distinct from v_locked_location_id then
      raise exception 'MT_REVISION_CONFLICT: ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดใหม่';
    end if;
    if v_existing.branch_receipt_contract_version is distinct from 1 then
      raise exception 'MT_LEGACY_BRANCH_READ_ONLY: รายการรุ่นเดิมดูได้อย่างเดียว';
    end if;
    if v_existing.branch_receipt_status is distinct from 'pending_receipt' then
      raise exception 'MT_BRANCH_RECEIVED_IMMUTABLE: รายการที่ยืนยันรับแล้วแก้ไขไม่ได้';
    end if;
    -- The legacy writer owns slip/source validation. Keep its same-location
    -- invariant intact, then move the still-pending branch row atomically.
    v_delegate_payload := jsonb_set(v_delegate_payload, '{locationId}', to_jsonb(v_existing.location_id::text), true);
    v_delegate_payload := jsonb_set(v_delegate_payload, '{targetLocationId}', to_jsonb(v_existing.location_id::text), true);

    update public.money_transfers transfer set
      branch_receipt_contract_version = null,
      branch_receipt_status = null,
      branch_received_by_user_id = null,
      branch_received_by_name = null,
      branch_received_at = null
    where transfer.id = v_existing.id;
  else
    perform private.lock_report_locations(array[v_requested_target_id]);
  end if;

  v_result := public.save_money_transfer_before_branch_receipt(v_delegate_payload);

  if v_operation = 'create' and coalesce((v_result->>'idempotentReplay')::boolean, false) then
    return public.get_money_transfer_detail(v_id)
      || jsonb_build_object('idempotentReplay', true, 'changedSources', '[]'::jsonb);
  end if;

  update public.money_transfers transfer set
    location_id = v_requested_target_id,
    target_location_id = v_requested_target_id,
    target_location_name = v_target_name,
    branch_receipt_contract_version = 1,
    branch_receipt_status = 'pending_receipt',
    branch_received_by_user_id = null,
    branch_received_by_name = null,
    branch_received_at = null,
    accounting_date = null,
    updated_at = statement_timestamp()
  where transfer.id = v_id;

  return public.get_money_transfer_detail(v_id)
    || jsonb_build_object(
      'idempotentReplay', false,
      'changedSources', coalesce(v_result->'changedSources', '[]'::jsonb),
      'virtualStatus', 'branch_pending_receipt'
    );
end;
$$;
