-- The original custom-GUC guard did not survive the production PostgREST
-- execution path. Authorize soft deletion by the SECURITY DEFINER RPC's
-- execution role instead. Direct authenticated table updates still run as the
-- authenticated role and remain blocked.

create or replace function private.require_atomic_money_transfer_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_delete_rpc_owner name;
begin
  select pg_catalog.pg_get_userbyid(p.proowner)
  into v_delete_rpc_owner
  from pg_catalog.pg_proc p
  where p.oid = 'public.delete_money_transfer(uuid)'::pg_catalog.regprocedure;

  if old.record_status <> 'deleted'
    and new.record_status = 'deleted'
    and (
      v_delete_rpc_owner is null
      or current_user <> v_delete_rpc_owner
    ) then
    raise exception 'MONEY_TRANSFER_DELETE_RPC_REQUIRED';
  end if;

  return new;
end;
$$;

revoke all on function private.require_atomic_money_transfer_delete()
from public, anon, authenticated;
