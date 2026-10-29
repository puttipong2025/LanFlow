-- Reuse the single all-branch badge query; background jobs never raise alerts.
alter function public.get_actionable_badge_counts() rename to get_actionable_badge_counts_before_rubber_queue;
revoke all on function public.get_actionable_badge_counts_before_rubber_queue() from public,anon,authenticated;
create function public.get_actionable_badge_counts()
returns table(location_id uuid,module_id text,item_count bigint)
language sql stable security definer set search_path='' as $$
  with counts as (
    select * from public.get_actionable_badge_counts_before_rubber_queue()
    union all
    select j.location_id,'rubber'::text,count(*)::bigint
    from private.rubber_queue_jobs j
    where j.state<>'done' and private.can_access_business_modules() and public.can_access_location(j.location_id)
      and exists(select 1 from public.locations l where l.id=j.location_id and l.is_active)
      and not exists(
        select 1 from private.rubber_bill_current_work_items(j.location_id) w
        where (w.work_kind='unpriced' or (private.can_access_super_admin_features() and w.work_kind='pending_approval'))
          and (w.bill_id in(select b.id from public.rubber_bills b where b.location_id=j.location_id and b.client_temp_id=j.client_temp_id)
            or (j.target_request_id is not null and w.work_identity like '%'||j.target_request_id::text)))
    group by j.location_id
  )
  select counts.location_id,counts.module_id,sum(counts.item_count)::bigint
  from counts group by counts.location_id,counts.module_id order by counts.location_id,counts.module_id
$$;
revoke all on function public.get_actionable_badge_counts() from public,anon;
grant execute on function public.get_actionable_badge_counts() to authenticated;
