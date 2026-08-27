-- Legacy true inter-branch rows remain historical read-only records.

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

  if v_transfer.transfer_type = 'branch'
    and v_transfer.target_location_id is distinct from v_transfer.location_id
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

revoke all on function public.delete_money_transfer(uuid, integer) from public, anon;
grant execute on function public.delete_money_transfer(uuid, integer) to authenticated;

notify pgrst, 'reload schema';
