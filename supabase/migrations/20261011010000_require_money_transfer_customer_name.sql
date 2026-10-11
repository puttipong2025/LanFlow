-- Keep the public RPC boundary consistent with the customer-transfer form:
-- customer transfers accept free-form recipient text, but never a blank name.

alter function public.save_money_transfer(jsonb)
  rename to save_money_transfer_before_customer_name_validation;

revoke all on function public.save_money_transfer_before_customer_name_validation(jsonb)
  from public, anon, authenticated;

create or replace function public.save_money_transfer(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer_type text := coalesce(p_payload->>'transferType', 'customer');
begin
  if v_transfer_type = 'customer'
    and nullif(pg_catalog.btrim(coalesce(p_payload->>'customerName', '')), '') is null then
    raise exception 'MT_CUSTOMER_NAME_REQUIRED: กรุณาระบุชื่อผู้รับโอน';
  end if;

  return public.save_money_transfer_before_customer_name_validation(p_payload);
end;
$$;

revoke all on function public.save_money_transfer(jsonb) from public, anon;
grant execute on function public.save_money_transfer(jsonb) to authenticated;

notify pgrst, 'reload schema';
