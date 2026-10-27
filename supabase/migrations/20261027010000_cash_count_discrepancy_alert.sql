alter table public.cash_count_alert_groups add column discrepancy_threshold numeric;
alter table public.cash_count_alert_groups add constraint cash_count_discrepancy_threshold_valid
 check(discrepancy_threshold is null or (discrepancy_threshold>=0 and discrepancy_threshold<=9999999999.99
 and discrepancy_threshold=round(discrepancy_threshold,2)));

-- Existing three/six argument callers retain their settings and grants.
create function public.save_cash_count_alert_group(p_group_id uuid,p_location_ids uuid[],p_due_days integer,
 p_lock_enabled boolean,p_grace_hours integer,p_unlock_hours integer,
 p_update_discrepancy_threshold boolean,p_discrepancy_threshold numeric) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=public.save_cash_count_alert_group(p_group_id,p_location_ids,p_due_days,p_lock_enabled,p_grace_hours,p_unlock_hours);
 if p_update_discrepancy_threshold is true then
   update public.cash_count_alert_groups set discrepancy_threshold=p_discrepancy_threshold where id=(result->>'id')::uuid;
 end if;
 return result;
end $$;
create or replace function public.list_cash_count_alert_groups() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.is_active_user() or not public.can_access_super_admin_features() then raise exception 'FORBIDDEN'; end if;
 select jsonb_build_object('groups',coalesce((select jsonb_agg(jsonb_build_object(
   'id',g.id,'dueDays',g.due_days,'lockEnabled',g.lock_enabled,'graceHours',g.grace_hours,'unlockHours',g.unlock_hours,
   'discrepancyThreshold',g.discrepancy_threshold,
   'locationIds',coalesce((select jsonb_agg(m.location_id order by m.location_id) from public.cash_count_alert_members m where m.group_id=g.id),'[]'::jsonb)) order by g.created_at,g.id)
   from public.cash_count_alert_groups g),'[]'::jsonb),'availableLocationIds',coalesce((select jsonb_agg(id order by name,id) from public.locations l
     where is_active and not exists(select 1 from public.cash_count_alert_members m where m.location_id=l.id)),'[]'::jsonb)) into result;
 return result;
end $$;
create or replace function public.get_branch_threshold_alert_check() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare base jsonb; extra jsonb; configured integer;
begin
 base:=private.get_money_weight_threshold_alert_check();
 with groups as (select *,row_number() over(order by created_at,id)::integer as group_order from public.cash_count_alert_groups),
 due as (select g.*,l.id as location_id,l.name,private.cash_count_due_date(l.id) as due_date,
   c.id as count_id,c.cutoff_at,c.difference_total,c.system_balance
   from groups g join public.cash_count_alert_members m on m.group_id=g.id
   join public.locations l on l.id=m.location_id
   left join lateral(select id,cutoff_at,difference_total,system_balance from public.cash_counts
     where location_id=l.id and status='active' order by created_at desc,id desc limit 1) c on true
   where l.is_active and public.can_access_location(l.id)),
 results as(select *,greatest(0,(current_timestamp at time zone 'Asia/Bangkok')::date-due_date) as overdue_days,
   discrepancy_threshold is not null and system_balance is not null and abs(difference_total)>discrepancy_threshold as discrepancy_alert
   from due)
 select count(*),coalesce(jsonb_agg(jsonb_build_object('kind','count','locationId',location_id,'locationName',name,
   'groupId',id,'groupOrder',group_order,'threshold',due_days,'value',overdue_days,
   'calculatedAt',current_timestamp,'dueDate',due_date,'discrepancyThreshold',discrepancy_threshold,
   'discrepancyUnavailable',discrepancy_threshold is not null and count_id is not null and system_balance is null,
   'discrepancy',case when discrepancy_alert then jsonb_build_object('countId',count_id,'amount',difference_total,'countedAt',cutoff_at) else null end)
   order by group_order,due_date,name,location_id)
   filter(where overdue_days>0 or discrepancy_alert),'[]'::jsonb) into configured,extra from results;
 return base||jsonb_build_object('candidates',(base->'candidates')||extra,
   'configuredCount',(base->>'configuredCount')::integer+configured,'checkedCount',(base->>'checkedCount')::integer+configured);
end $$;
revoke all on function public.save_cash_count_alert_group(uuid,uuid[],integer,boolean,integer,integer,boolean,numeric) from public,anon;
grant execute on function public.save_cash_count_alert_group(uuid,uuid[],integer,boolean,integer,integer,boolean,numeric) to authenticated;
notify pgrst,'reload schema';
