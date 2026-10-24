create table public.cash_count_alert_groups (
  id uuid primary key default gen_random_uuid(),
  due_days integer not null check(due_days between 1 and 5),
  created_at timestamptz not null default now()
);
create table public.cash_count_alert_members (
  location_id uuid primary key references public.locations(id),
  group_id uuid not null references public.cash_count_alert_groups(id) on delete cascade,
  joined_at timestamptz not null default now()
);
alter table public.cash_count_alert_groups enable row level security;
alter table public.cash_count_alert_members enable row level security;
revoke all on public.cash_count_alert_groups,public.cash_count_alert_members from public,anon,authenticated;
grant all on public.cash_count_alert_groups,public.cash_count_alert_members to service_role;

create function public.list_cash_count_alert_groups() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.is_active_user() or not private.can_access_super_admin_features() then raise exception 'FORBIDDEN'; end if;
  select jsonb_build_object('groups',coalesce((select jsonb_agg(jsonb_build_object(
    'id',g.id,'dueDays',g.due_days,'locationIds',coalesce((select jsonb_agg(m.location_id order by m.location_id)
      from public.cash_count_alert_members m where m.group_id=g.id),'[]'::jsonb)) order by g.created_at,g.id)
      from public.cash_count_alert_groups g),'[]'::jsonb),
    'availableLocationIds',coalesce((select jsonb_agg(id order by name,id) from public.locations l
      where is_active and not exists(select 1 from public.cash_count_alert_members m where m.location_id=l.id)),'[]'::jsonb)) into result;
  return result;
end $$;

create function public.save_cash_count_alert_group(p_group_id uuid,p_location_ids uuid[],p_due_days integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_id uuid:=coalesce(p_group_id,gen_random_uuid());
begin
  if not private.is_active_user() or not private.can_access_super_admin_features() then raise exception 'FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended('cash-count-alert-groups',0));
  if p_due_days is null or p_due_days not between 1 and 5 or coalesce(cardinality(p_location_ids),0)=0
    or exists(select 1 from unnest(p_location_ids) x where x is null)
    or (select count(distinct x) from unnest(p_location_ids) x)<>cardinality(p_location_ids) then
    raise exception 'เกณฑ์ต้องเป็น 1–5 วัน และต้องเลือกสาขาไม่ซ้ำอย่างน้อยหนึ่งสาขา'; end if;
  if p_group_id is not null and not exists(select 1 from public.cash_count_alert_groups where id=p_group_id) then raise exception 'ไม่พบกลุ่ม'; end if;
  if exists(select 1 from unnest(p_location_ids) x left join public.locations l on l.id=x where l.id is null
    or (not l.is_active and not exists(select 1 from public.cash_count_alert_members where group_id=v_id and location_id=x))) then
    raise exception 'ไม่พบสาขาที่เปิดใช้งาน'; end if;
  if exists(select 1 from public.cash_count_alert_members where location_id=any(p_location_ids) and group_id<>v_id) then
    raise exception 'สาขาอยู่ในกลุ่มอื่นแล้ว กรุณานำออกจากกลุ่มเดิมก่อน'; end if;
  insert into public.cash_count_alert_groups(id,due_days) values(v_id,p_due_days)
    on conflict(id) do update set due_days=excluded.due_days;
  -- Retained members preserve their join date. Removed/re-added members begin a new membership.
  delete from public.cash_count_alert_members where group_id=v_id and not(location_id=any(p_location_ids));
  insert into public.cash_count_alert_members(group_id,location_id)
    select v_id,x from unnest(p_location_ids) x on conflict(location_id) do nothing;
  return jsonb_build_object('id',v_id);
end $$;
create function public.delete_cash_count_alert_group(p_group_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not private.is_active_user() or not private.can_access_super_admin_features() then raise exception 'FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended('cash-count-alert-groups',0));
  delete from public.cash_count_alert_groups where id=p_group_id;
  return jsonb_build_object('id',p_group_id);
end $$;

alter function public.get_branch_threshold_alert_check() rename to get_money_weight_threshold_alert_check;
alter function public.get_money_weight_threshold_alert_check() set schema private;
revoke all on function private.get_money_weight_threshold_alert_check() from public,anon,authenticated;
create function public.get_branch_threshold_alert_check() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare base jsonb; extra jsonb; configured integer;
begin
  base:=private.get_money_weight_threshold_alert_check();
  with groups as (
    select *,row_number() over(order by created_at,id)::integer as group_order from public.cash_count_alert_groups
  ), due as (
    select g.*,l.id as location_id,l.name,
      coalesce((select (max(c.cutoff_at) at time zone 'Asia/Bangkok')::date from public.cash_counts c
        where c.location_id=l.id and c.status='active'),(m.joined_at at time zone 'Asia/Bangkok')::date)+g.due_days as due_date
    from groups g join public.cash_count_alert_members m on m.group_id=g.id
    join public.locations l on l.id=m.location_id where l.is_active and public.can_access_location(l.id)
  ) select count(*),coalesce(jsonb_agg(jsonb_build_object('kind','count','locationId',location_id,
      'locationName',name,'groupId',id,'groupOrder',group_order,'threshold',due_days,
      'value',(current_timestamp at time zone 'Asia/Bangkok')::date-due_date,
      'calculatedAt',current_timestamp,'dueDate',due_date)
      order by group_order,due_date,name,location_id) filter(where due_date<(current_timestamp at time zone 'Asia/Bangkok')::date),'[]'::jsonb)
    into configured,extra from due;
  return base || jsonb_build_object('candidates',(base->'candidates')||extra,
    'configuredCount',(base->>'configuredCount')::integer+configured,
    'checkedCount',(base->>'checkedCount')::integer+configured);
end $$;
revoke all on function public.list_cash_count_alert_groups(),public.save_cash_count_alert_group(uuid,uuid[],integer),
 public.delete_cash_count_alert_group(uuid),public.get_branch_threshold_alert_check() from public,anon;
grant execute on function public.list_cash_count_alert_groups(),public.save_cash_count_alert_group(uuid,uuid[],integer),
 public.delete_cash_count_alert_group(uuid),public.get_branch_threshold_alert_check() to authenticated;
