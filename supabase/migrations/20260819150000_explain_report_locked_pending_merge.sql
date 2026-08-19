-- Preserve Report Lock while telling the UI why otherwise matching pending
-- transfers were skipped by the merge.

create or replace function public.merge_pending_money_transfers(p_location_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group record;
  v_secondary_ids uuid[];
  v_secondary_id uuid;
  v_group_total numeric(12,2);
  v_pending_count integer := 0;
  v_report_locked_count integer := 0;
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

  perform 1
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

  with pending as (
    select t.id, t.customer_id, t.account_number
    from public.money_transfers t
    where t.location_id = p_location_id
      and t.transfer_type = 'customer'
      and t.transfer_method = 'bank'
      and t.record_status = 'active'
      and t.sync_status = 'synced'
      and t.transfer_status = 'pending'
      and t.customer_id is not null
  ), duplicate_groups as (
    select p.customer_id, p.account_number
    from pending p
    group by p.customer_id, p.account_number
    having count(*) >= 2
  )
  select count(*) into v_report_locked_count
  from pending p
  join duplicate_groups g
    on g.customer_id = p.customer_id
   and g.account_number is not distinct from p.account_number
  where private.active_transfer_report_no(p.id) is not null
    or exists (
      select 1
      from public.money_transfer_items i
      where i.transfer_id = p.id
        and private.active_report_no(i.source_type, i.source_id) is not null
    );

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

    foreach v_secondary_id in array v_secondary_ids
    loop
      perform public.delete_money_transfer(v_secondary_id);
    end loop;

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
    'reportLockedTransferCount', v_report_locked_count,
    'survivorIds', pg_catalog.to_jsonb(v_survivor_ids)
  );
end;
$$;

revoke all on function public.merge_pending_money_transfers(uuid)
from public, anon;
grant execute on function public.merge_pending_money_transfers(uuid)
to authenticated;
