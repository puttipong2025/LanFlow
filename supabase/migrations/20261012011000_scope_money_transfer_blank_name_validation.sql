-- Keep blank-recipient validation behind the caller's location boundary.
-- The legacy replay exception must only inspect transfers in a location the
-- caller can access; otherwise the definer-rights wrapper becomes a
-- cross-location idempotency-key oracle.

create or replace function public.save_money_transfer(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer_type text;
  v_operation text;
  v_idempotency_key text;
  v_location_id uuid;
begin
  if not private.is_active_user() or not private.can_access_money_transfer_module() then
    raise exception 'MT_ACCESS_DENIED: ไม่มีสิทธิ์ใช้งานรายการโอนเงิน';
  end if;

  if pg_catalog.jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'MT_INVALID_PAYLOAD: ข้อมูลรายการโอนไม่ครบ';
  end if;

  v_transfer_type := coalesce(p_payload->>'transferType', 'customer');
  v_operation := coalesce(p_payload->>'operation', 'create');
  v_idempotency_key := nullif(p_payload->>'idempotencyKey', '');

  if v_transfer_type = 'customer'
    and (
      pg_catalog.jsonb_typeof(p_payload->'customerName') is distinct from 'string'
      or nullif(
        pg_catalog.regexp_replace(
          pg_catalog.replace(coalesce(p_payload->>'customerName', ''), pg_catalog.chr(65279), ''),
          '[[:space:]]',
          '',
          'g'
        ),
        ''
      ) is null
    ) then
    v_location_id := nullif(p_payload->>'locationId', '')::uuid;
    if v_location_id is null then
      raise exception 'MT_INVALID_PAYLOAD: ข้อมูลรายการโอนไม่ครบ';
    end if;
    if not private.can_access_location(v_location_id) then
      raise exception 'MT_LOCATION_DENIED: ไม่มีสิทธิ์เข้าถึงสาขา';
    end if;

    -- Preserve replay/conflict semantics only for a legacy row in the
    -- requested location. Rows in other locations are outside this caller's
    -- validation boundary and must not influence the response.
    if v_operation = 'create'
      and v_idempotency_key is not null
      and exists (
        select 1
        from public.money_transfers transfer
        where transfer.idempotency_key = v_idempotency_key
          and transfer.location_id = v_location_id
          and transfer.record_status <> 'deleted'
      ) then
      return public.save_money_transfer_before_customer_name_validation(p_payload);
    end if;
    raise exception 'MT_CUSTOMER_NAME_REQUIRED: กรุณาระบุชื่อผู้รับโอน';
  end if;

  return public.save_money_transfer_before_customer_name_validation(p_payload);
exception
  when data_exception or integrity_constraint_violation then
    raise exception 'MT_INVALID_PAYLOAD: รูปแบบข้อมูลรายการโอนไม่ถูกต้อง';
end;
$$;

revoke all on function public.save_money_transfer(jsonb) from public, anon;
grant execute on function public.save_money_transfer(jsonb) to authenticated;

notify pgrst, 'reload schema';
