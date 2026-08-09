-- Make ordinary money-transfer deletion atomic and prevent direct soft deletes.
-- Cash transfers keep using their dedicated receive/cancel workflow.

create or replace function private.require_atomic_money_transfer_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.record_status <> 'deleted'
    and new.record_status = 'deleted'
    and coalesce(
      pg_catalog.current_setting('app.money_transfer_delete_rpc', true),
      'false'
    ) <> 'true' then
    raise exception 'MONEY_TRANSFER_DELETE_RPC_REQUIRED';
  end if;

  return new;
end;
$$;

revoke all on function private.require_atomic_money_transfer_delete()
from public, anon, authenticated;

drop trigger if exists enforce_atomic_money_transfer_delete
on public.money_transfers;

create trigger enforce_atomic_money_transfer_delete
before update of record_status on public.money_transfers
for each row
execute function private.require_atomic_money_transfer_delete();

create or replace function public.delete_money_transfer(p_transfer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles%rowtype;
  v_transfer public.money_transfers%rowtype;
  v_released_item_count integer := 0;
begin
  if p_transfer_id is null
    or not private.can_access_money_transfer_module() then
    raise exception 'MONEY_TRANSFER_DELETE_FORBIDDEN';
  end if;

  select *
  into v_transfer
  from public.money_transfers t
  where t.id = p_transfer_id
  for update;

  if not found then
    raise exception 'MONEY_TRANSFER_NOT_FOUND';
  end if;

  if not private.can_access_location(v_transfer.location_id) then
    raise exception 'MONEY_TRANSFER_DELETE_FORBIDDEN';
  end if;

  if v_transfer.transfer_type = 'cash'
    or v_transfer.transfer_method = 'cash' then
    raise exception 'MONEY_TRANSFER_CASH_DELETE_REQUIRES_DEDICATED_WORKFLOW';
  end if;

  select *
  into v_actor
  from public.profiles p
  where p.id = auth.uid()
    and p.is_active = true;

  if not found then
    raise exception 'MONEY_TRANSFER_DELETE_FORBIDDEN';
  end if;

  -- Delete relations first so their existing report-lock trigger can abort the
  -- whole transaction before the parent is hidden.
  delete from public.money_transfer_items i
  where i.transfer_id = p_transfer_id;

  get diagnostics v_released_item_count = row_count;

  if v_transfer.record_status = 'deleted' then
    return pg_catalog.jsonb_build_object(
      'transferId', p_transfer_id,
      'status', 'deleted',
      'idempotent', true,
      'releasedItemCount', v_released_item_count
    );
  end if;

  perform pg_catalog.set_config(
    'app.money_transfer_delete_rpc',
    'true',
    true
  );

  update public.money_transfers
  set record_status = 'deleted',
      deleted_at = pg_catalog.now(),
      deleted_by_name = v_actor.name,
      deleted_by_phone = v_actor.phone,
      revision_no = revision_no + 1,
      updated_at = pg_catalog.now()
  where id = p_transfer_id;

  return pg_catalog.jsonb_build_object(
    'transferId', p_transfer_id,
    'status', 'deleted',
    'idempotent', false,
    'releasedItemCount', v_released_item_count
  );
end;
$$;

revoke all on function public.delete_money_transfer(uuid)
from public, anon;
grant execute on function public.delete_money_transfer(uuid)
to authenticated;

-- Preserve the existing merge behavior through the new soft-delete guard.
create or replace function public.merge_pending_money_transfers(p_location_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles%rowtype;
  v_group record;
  v_secondary_ids uuid[];
  v_group_total numeric(12,2);
  v_pending_count integer := 0;
  v_merged_group_count integer := 0;
  v_merged_transfer_count integer := 0;
  v_deleted_transfer_count integer := 0;
  v_survivor_ids uuid[] := array[]::uuid[];
begin
  if p_location_id is null
    or not private.can_access_money_transfer_module()
    or not private.can_access_location(p_location_id) then
    raise exception 'ไม่มีสิทธิ์รวมรายการโอนเงินของสาขานี้';
  end if;

  select * into v_actor
  from public.profiles
  where id = auth.uid() and is_active = true;

  if not found then
    raise exception 'ไม่พบบัญชีผู้ใช้งานที่เปิดใช้งาน';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'money-transfer-pending-merge:' || p_location_id::text,
      0
    )
  );

  -- Parent locks serialize concurrent child/slip writes through their FKs.
  perform 1
  from public.money_transfers t
  where t.location_id = p_location_id
    and t.transfer_type = 'customer'
    and t.transfer_method = 'bank'
    and t.record_status = 'active'
    and t.sync_status = 'synced'
    and t.transfer_status = 'pending'
  order by t.created_at, t.id
  for update;

  select count(*) into v_pending_count
  from public.money_transfers t
  where t.location_id = p_location_id
    and t.transfer_type = 'customer'
    and t.transfer_method = 'bank'
    and t.record_status = 'active'
    and t.sync_status = 'synced'
    and t.transfer_status = 'pending';

  for v_group in
    with eligible as (
      select t.id, t.customer_id, t.account_number, t.created_at
      from public.money_transfers t
      where t.location_id = p_location_id
        and t.transfer_type = 'customer'
        and t.transfer_method = 'bank'
        and t.record_status = 'active'
        and t.sync_status = 'synced'
        and t.transfer_status = 'pending'
        and t.customer_id is not null
        and not exists (
          select 1
          from public.money_transfer_slips s
          where s.transfer_id = t.id
        )
        and private.active_transfer_report_no(t.id) is null
        and not exists (
          select 1
          from public.money_transfer_items i
          where i.transfer_id = t.id
            and private.active_report_no(i.source_type, i.source_id) is not null
        )
    )
    select
      e.customer_id,
      e.account_number,
      pg_catalog.array_agg(e.id order by e.created_at, e.id) as transfer_ids
    from eligible e
    group by e.customer_id, e.account_number
    having count(*) >= 2
    order by min(e.created_at), min(e.id::text)
  loop
    v_secondary_ids := v_group.transfer_ids[
      2:pg_catalog.array_length(v_group.transfer_ids, 1)
    ];

    update public.money_transfer_items
    set transfer_id = v_group.transfer_ids[1]
    where transfer_id = any(v_secondary_ids);

    select coalesce(sum(i.amount), 0)::numeric(12,2)
    into v_group_total
    from public.money_transfer_items i
    where i.transfer_id = v_group.transfer_ids[1];

    update public.money_transfers
    set net_amount_to_pay = v_group_total,
        revision_no = revision_no + 1,
        updated_at = pg_catalog.now()
    where id = v_group.transfer_ids[1];

    perform pg_catalog.set_config(
      'app.money_transfer_delete_rpc',
      'true',
      true
    );

    update public.money_transfers
    set record_status = 'deleted',
        deleted_at = pg_catalog.now(),
        deleted_by_name = v_actor.name,
        deleted_by_phone = v_actor.phone,
        revision_no = revision_no + 1,
        updated_at = pg_catalog.now()
    where id = any(v_secondary_ids);

    v_merged_group_count := v_merged_group_count + 1;
    v_merged_transfer_count := v_merged_transfer_count
      + pg_catalog.array_length(v_group.transfer_ids, 1);
    v_deleted_transfer_count := v_deleted_transfer_count
      + pg_catalog.array_length(v_secondary_ids, 1);
    v_survivor_ids := pg_catalog.array_append(
      v_survivor_ids,
      v_group.transfer_ids[1]
    );
  end loop;

  return pg_catalog.jsonb_build_object(
    'mergedGroupCount', v_merged_group_count,
    'mergedTransferCount', v_merged_transfer_count,
    'deletedTransferCount', v_deleted_transfer_count,
    'skippedTransferCount', v_pending_count - v_merged_transfer_count,
    'survivorIds', pg_catalog.to_jsonb(v_survivor_ids)
  );
end;
$$;

revoke all on function public.merge_pending_money_transfers(uuid)
from public, anon;
grant execute on function public.merge_pending_money_transfers(uuid)
to authenticated;
