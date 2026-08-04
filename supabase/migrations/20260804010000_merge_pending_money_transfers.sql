-- Merge eligible pending customer bank transfers per customer/account without
-- adding new parent rows. Report-locked sources and transfers are never moved.

create or replace function public.merge_pending_money_transfers(p_location_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
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

  perform pg_advisory_xact_lock(
    hashtextextended('money-transfer-pending-merge:' || p_location_id::text, 0)
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
          select 1 from public.money_transfer_slips s where s.transfer_id = t.id
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
      array_agg(e.id order by e.created_at, e.id) as transfer_ids
    from eligible e
    group by e.customer_id, e.account_number
    having count(*) >= 2
    order by min(e.created_at), min(e.id::text)
  loop
    v_secondary_ids := v_group.transfer_ids[2:array_length(v_group.transfer_ids, 1)];

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
        updated_at = now()
    where id = v_group.transfer_ids[1];

    update public.money_transfers
    set record_status = 'deleted',
        deleted_at = now(),
        deleted_by_name = v_actor.name,
        deleted_by_phone = v_actor.phone,
        revision_no = revision_no + 1,
        updated_at = now()
    where id = any(v_secondary_ids);

    v_merged_group_count := v_merged_group_count + 1;
    v_merged_transfer_count := v_merged_transfer_count + array_length(v_group.transfer_ids, 1);
    v_deleted_transfer_count := v_deleted_transfer_count + array_length(v_secondary_ids, 1);
    v_survivor_ids := array_append(v_survivor_ids, v_group.transfer_ids[1]);
  end loop;

  return jsonb_build_object(
    'mergedGroupCount', v_merged_group_count,
    'mergedTransferCount', v_merged_transfer_count,
    'deletedTransferCount', v_deleted_transfer_count,
    'skippedTransferCount', v_pending_count - v_merged_transfer_count,
    'survivorIds', to_jsonb(v_survivor_ids)
  );
end;
$$;

revoke all on function public.merge_pending_money_transfers(uuid) from public, anon;
grant execute on function public.merge_pending_money_transfers(uuid) to authenticated;
