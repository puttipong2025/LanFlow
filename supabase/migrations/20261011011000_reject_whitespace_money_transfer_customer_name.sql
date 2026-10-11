-- Match the form's trim semantics at the public RPC boundary. PostgreSQL
-- btrim() removes ordinary spaces only. POSIX space covers the remaining
-- control/Unicode whitespace except the ECMAScript-trimmed BOM (U+FEFF).
-- Reject non-object payloads here so malformed JSON cannot reach scalar
-- operators in the delegated writer and leak PostgreSQL implementation errors.

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
begin
  -- Keep authorization ahead of every public validation branch, including
  -- checks owned by the delegated branch-transfer writer.
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
    -- Preserve the delegated writer's canonical replay/conflict behavior for
    -- legacy rows that were committed before this validation existed.
    if v_operation = 'create'
      and v_idempotency_key is not null
      and exists (
        select 1
        from public.money_transfers transfer
        where transfer.idempotency_key = v_idempotency_key
          and transfer.record_status <> 'deleted'
      ) then
      return public.save_money_transfer_before_customer_name_validation(p_payload);
    end if;
    raise exception 'MT_CUSTOMER_NAME_REQUIRED: กรุณาระบุชื่อผู้รับโอน';
  end if;

  return public.save_money_transfer_before_customer_name_validation(p_payload);
exception
  -- The delegated writers cast UUID, numeric and timestamp payload fields in
  -- their declaration/validation paths. Keep malformed client data inside the
  -- public RPC error contract instead of leaking PostgreSQL cast diagnostics.
  when data_exception then
    raise exception 'MT_INVALID_PAYLOAD: รูปแบบข้อมูลรายการโอนไม่ถูกต้อง';
end;
$$;

revoke all on function public.save_money_transfer(jsonb) from public, anon;
grant execute on function public.save_money_transfer(jsonb) to authenticated;

notify pgrst, 'reload schema';
