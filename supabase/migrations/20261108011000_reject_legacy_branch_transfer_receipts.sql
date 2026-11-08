create or replace function public.receive_branch_money_transfer(
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
  v_actor_name text;
  v_target_location_id uuid;
begin
  if not private.is_active_user() then
    raise exception 'MT_ACCESS_DENIED: ไม่มีสิทธิ์ยืนยันรับเงิน';
  end if;
  if p_transfer_id is null or p_expected_revision is null then
    raise exception 'MT_INVALID_PAYLOAD: ข้อมูลยืนยันรับเงินไม่ครบ';
  end if;

  select transfer.target_location_id into v_target_location_id
  from public.money_transfers transfer
  where transfer.id = p_transfer_id;
  if v_target_location_id is null then
    raise exception 'MT_NOT_FOUND: ไม่พบรายการโอนเงินรอยืนยัน';
  end if;
  if not private.can_access_location(v_target_location_id) then
    raise exception 'MT_LOCATION_DENIED: ไม่มีสิทธิ์เข้าถึงสาขาผู้รับ';
  end if;
  perform private.lock_report_locations(array[v_target_location_id]);

  select * into v_transfer
  from public.money_transfers transfer
  where transfer.id = p_transfer_id
  for update;

  if v_transfer.id is null or v_transfer.record_status = 'deleted'
    or v_transfer.transfer_type <> 'branch'
    or v_transfer.branch_receipt_contract_version is distinct from 1 then
    raise exception 'MT_NOT_FOUND: ไม่พบรายการโอนเงินรอยืนยัน';
  end if;
  if v_transfer.target_location_id is distinct from v_target_location_id then
    raise exception 'MT_REVISION_CONFLICT: ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดใหม่';
  end if;
  if not private.can_access_location(v_transfer.target_location_id) then
    raise exception 'MT_LOCATION_DENIED: ไม่มีสิทธิ์เข้าถึงสาขาผู้รับ';
  end if;
  if v_transfer.location_id is distinct from v_transfer.target_location_id then
    raise exception 'MT_BRANCH_TARGET_MISMATCH: รายการโอนให้สาขาต้องเป็นของสาขาผู้รับ';
  end if;
  if not exists (
    select 1
    from public.money_transfer_slips slip
    where slip.transfer_id = v_transfer.id
  ) then
    raise exception 'MT_SLIP_REQUIRED: ต้องมีสลิปอย่างน้อยหนึ่งใบก่อนยืนยันรับเงิน';
  end if;

  if v_transfer.branch_receipt_status = 'received' then
    return public.get_branch_money_transfer_detail(v_transfer.id)
      || jsonb_build_object('idempotentReplay', true);
  end if;
  if v_transfer.revision_no <> p_expected_revision then
    raise exception 'MT_REVISION_CONFLICT: ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดใหม่';
  end if;

  -- Use the same whitespace as String.trim() in the receipt route.
  select nullif(btrim(
    profile.name,
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'
  ), '') into v_actor_name
  from public.profiles profile
  where profile.id = auth.uid();

  update public.money_transfers transfer set
    branch_receipt_status = 'received',
    branch_received_by_user_id = auth.uid(),
    branch_received_by_name = coalesce(v_actor_name, 'ผู้ใช้งาน'),
    branch_received_at = statement_timestamp(),
    accounting_date = (statement_timestamp() at time zone 'Asia/Bangkok')::date,
    revision_no = transfer.revision_no + 1,
    updated_at = statement_timestamp()
  where transfer.id = v_transfer.id;

  return public.get_branch_money_transfer_detail(v_transfer.id)
    || jsonb_build_object('idempotentReplay', false);
end;
$$;
