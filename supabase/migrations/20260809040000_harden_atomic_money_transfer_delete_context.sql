-- Replace session/role-based delete authorization with an exact private
-- transaction context. Keep the original business logic as private functions
-- and expose small public wrappers that open and close the context.

create table private.money_transfer_delete_context (
  backend_pid integer not null,
  transaction_id bigint not null,
  transfer_id uuid not null,
  primary key (backend_pid, transaction_id, transfer_id)
);

alter table private.money_transfer_delete_context enable row level security;

revoke all on table private.money_transfer_delete_context
from public, anon, authenticated, service_role;

alter function public.delete_money_transfer(uuid)
set schema private;

alter function public.merge_pending_money_transfers(uuid)
set schema private;

revoke all on function private.delete_money_transfer(uuid)
from public, anon, authenticated, service_role;

revoke all on function private.merge_pending_money_transfers(uuid)
from public, anon, authenticated, service_role;

create or replace function private.require_atomic_money_transfer_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.record_status <> 'deleted'
    and new.record_status = 'deleted'
    and not exists (
      select 1
      from private.money_transfer_delete_context c
      where c.backend_pid = pg_catalog.pg_backend_pid()
        and c.transaction_id = pg_catalog.txid_current()
        and c.transfer_id = new.id
    ) then
    raise exception 'MONEY_TRANSFER_DELETE_RPC_REQUIRED';
  end if;

  return new;
end;
$$;

revoke all on function private.require_atomic_money_transfer_delete()
from public, anon, authenticated, service_role;

create function public.delete_money_transfer(p_transfer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_backend_pid integer := pg_catalog.pg_backend_pid();
  v_transaction_id bigint := pg_catalog.txid_current();
  v_result jsonb;
begin
  insert into private.money_transfer_delete_context (
    backend_pid,
    transaction_id,
    transfer_id
  ) values (
    v_backend_pid,
    v_transaction_id,
    p_transfer_id
  );

  v_result := private.delete_money_transfer(p_transfer_id);

  delete from private.money_transfer_delete_context c
  where c.backend_pid = v_backend_pid
    and c.transaction_id = v_transaction_id
    and c.transfer_id = p_transfer_id;

  return v_result;
end;
$$;

revoke all on function public.delete_money_transfer(uuid)
from public, anon, service_role;

grant execute on function public.delete_money_transfer(uuid)
to authenticated;

create function public.merge_pending_money_transfers(p_location_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_backend_pid integer := pg_catalog.pg_backend_pid();
  v_transaction_id bigint := pg_catalog.txid_current();
  v_result jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'money-transfer-pending-merge:' || p_location_id::text,
      0
    )
  );

  insert into private.money_transfer_delete_context (
    backend_pid,
    transaction_id,
    transfer_id
  )
  select
    v_backend_pid,
    v_transaction_id,
    t.id
  from public.money_transfers t
  where t.location_id = p_location_id
    and t.transfer_type = 'customer'
    and t.transfer_method = 'bank'
    and t.record_status = 'active'
    and t.sync_status = 'synced'
    and t.transfer_status = 'pending';

  v_result := private.merge_pending_money_transfers(p_location_id);

  delete from private.money_transfer_delete_context c
  where c.backend_pid = v_backend_pid
    and c.transaction_id = v_transaction_id;

  return v_result;
end;
$$;

revoke all on function public.merge_pending_money_transfers(uuid)
from public, anon, service_role;

grant execute on function public.merge_pending_money_transfers(uuid)
to authenticated;
