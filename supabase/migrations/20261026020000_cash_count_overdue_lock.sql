-- Reuse membership lifetime and the existing branch fence. No scheduled lock state.
alter table public.cash_count_alert_groups
  add column lock_enabled boolean not null default false,
  add column grace_hours integer check(grace_hours between 1 and 48),
  add column unlock_hours integer check(unlock_hours between 1 and 48),
  add constraint cash_count_lock_settings check(not lock_enabled or (grace_hours is not null and unlock_hours is not null));
alter table public.cash_count_alert_members
  add column unlocked_until timestamptz,
  add column unlocked_at timestamptz,
  add column unlocked_by_user_id uuid references public.profiles(id) on delete set null,
  add column unlocked_by_name text;
create index cash_count_active_cutoff on public.cash_counts(location_id,cutoff_at desc) where status='active';

create function private.cash_count_due_date(p_location_id uuid) returns date
language sql stable security definer set search_path='' as $$
 select coalesce((select (max(c.cutoff_at) at time zone 'Asia/Bangkok')::date
   from public.cash_counts c where c.location_id=m.location_id and c.status='active'),
   (m.joined_at at time zone 'Asia/Bangkok')::date)+g.due_days
 from public.cash_count_alert_members m join public.cash_count_alert_groups g on g.id=m.group_id
 where m.location_id=p_location_id
$$;
create function private.cash_count_lock_state(p_location_id uuid,p_now timestamptz) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('locationId',m.location_id,'locationName',l.name,'groupId',g.id,
   'enabled',g.lock_enabled,'dueDate',d.due_date,'lockAt',d.lock_at,
   'unlockedUntil',m.unlocked_until,'unlockedAt',m.unlocked_at,'unlockedByName',m.unlocked_by_name,
   'locked',g.lock_enabled and p_now>=d.lock_at and (m.unlocked_until is null or p_now>=m.unlocked_until))
 from public.cash_count_alert_members m join public.cash_count_alert_groups g on g.id=m.group_id
 join public.locations l on l.id=m.location_id
 cross join lateral (select private.cash_count_due_date(m.location_id) as due_date,
   ((private.cash_count_due_date(m.location_id)+1)::timestamp at time zone 'Asia/Bangkok')+make_interval(hours=>g.grace_hours) as lock_at) d
 where m.location_id=p_location_id and l.is_active
$$;
create function public.get_cash_count_overdue_status(p_location_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_now timestamptz:=statement_timestamp(); v_states jsonb; v_contacts jsonb;
begin
 if not private.is_active_user() or not exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','super_admin')) then
   raise exception 'ไม่มีสิทธิ์ดูสถานะล็อก'; end if;
 if p_location_id is not null and not public.can_access_location(p_location_id) then raise exception 'ไม่มีสิทธิ์ดูสาขา'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id),'[]'::jsonb)
 into v_contacts from public.profiles where is_active and (role='super_admin' or (role='admin' and can_access_super_admin_features));
 select coalesce(jsonb_agg(private.cash_count_lock_state(l.id,v_now)||jsonb_build_object(
   'canUnlock',public.can_access_super_admin_features(),'contacts',v_contacts) order by l.name,l.id),'[]'::jsonb)
 into v_states from public.locations l join public.cash_count_alert_members m on m.location_id=l.id
 where l.is_active and public.can_access_location(l.id) and (p_location_id is null or l.id=p_location_id);
 return jsonb_build_object('states',v_states,'serverNow',v_now);
end $$;
create function public.unlock_cash_count_overdue(p_location_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_now timestamptz; v_hours integer; v_state jsonb;
begin
 if not private.is_active_user() or not public.can_access_super_admin_features() or not public.can_access_location(p_location_id) then
   raise exception 'ไม่มีสิทธิ์ปลดล็อกสาขา'; end if;
 perform private.lock_report_locations(array[p_location_id]);
 v_now:=clock_timestamp();
 v_state:=private.cash_count_lock_state(p_location_id,v_now);
 -- A lost response or concurrent click returns the existing grant, never extends it.
 if coalesce((v_state->>'locked')::boolean,false) then
   select g.unlock_hours into v_hours from public.cash_count_alert_members m
     join public.cash_count_alert_groups g on g.id=m.group_id where m.location_id=p_location_id;
   update public.cash_count_alert_members set unlocked_until=v_now+make_interval(hours=>v_hours),
     unlocked_at=v_now,unlocked_by_user_id=auth.uid(),unlocked_by_name=(select name from public.profiles where id=auth.uid())
     where location_id=p_location_id;
 end if;
 return public.get_cash_count_overdue_status(p_location_id);
end $$;

-- Preserve the old RPC contract; omitted new settings mean keep the current settings.
alter function public.save_cash_count_alert_group(uuid,uuid[],integer) rename to save_cash_count_alert_group_base;
alter function public.save_cash_count_alert_group_base(uuid,uuid[],integer) set schema private;
revoke all on function private.save_cash_count_alert_group_base(uuid,uuid[],integer) from public,anon,authenticated;
create function public.save_cash_count_alert_group(p_group_id uuid,p_location_ids uuid[],p_due_days integer,
 p_lock_enabled boolean,p_grace_hours integer,p_unlock_hours integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_id uuid:=coalesce(p_group_id,gen_random_uuid()); v_ids uuid[]; v_result jsonb;
begin
 if not private.is_active_user() or not public.can_access_super_admin_features() then raise exception 'FORBIDDEN'; end if;
 perform pg_advisory_xact_lock(hashtextextended('cash-count-alert-groups',0));
 select array_agg(distinct x) into v_ids from unnest(coalesce(p_location_ids,'{}'::uuid[])||
   coalesce((select array_agg(location_id) from public.cash_count_alert_members where group_id=v_id),'{}'::uuid[])) x;
 perform private.lock_report_locations(v_ids);
 if (p_grace_hours is not null and p_grace_hours not between 1 and 48)
   or (p_unlock_hours is not null and p_unlock_hours not between 1 and 48) then raise exception 'ชั่วโมงต้องเป็น 1–48'; end if;
 v_result:=private.save_cash_count_alert_group_base(p_group_id,p_location_ids,p_due_days);
 v_id:=(v_result->>'id')::uuid;
 update public.cash_count_alert_groups set lock_enabled=coalesce(p_lock_enabled,lock_enabled),
   grace_hours=coalesce(p_grace_hours,grace_hours),unlock_hours=coalesce(p_unlock_hours,unlock_hours) where id=v_id;
 if p_lock_enabled=false then
   update public.cash_count_alert_members set unlocked_until=null,unlocked_at=null,unlocked_by_user_id=null,unlocked_by_name=null where group_id=v_id;
 end if;
 return v_result;
end $$;
create function public.save_cash_count_alert_group(p_group_id uuid,p_location_ids uuid[],p_due_days integer) returns jsonb
language sql security definer set search_path='' as $$
 select public.save_cash_count_alert_group(p_group_id,p_location_ids,p_due_days,null,null,null)
$$;
create or replace function public.delete_cash_count_alert_group(p_group_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not private.is_active_user() or not public.can_access_super_admin_features() then raise exception 'FORBIDDEN'; end if;
 perform pg_advisory_xact_lock(hashtextextended('cash-count-alert-groups',0));
 perform private.lock_report_locations(array(select location_id from public.cash_count_alert_members where group_id=p_group_id));
 delete from public.cash_count_alert_groups where id=p_group_id;
 return jsonb_build_object('id',p_group_id);
end $$;
create or replace function public.list_cash_count_alert_groups() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.is_active_user() or not public.can_access_super_admin_features() then raise exception 'FORBIDDEN'; end if;
 select jsonb_build_object('groups',coalesce((select jsonb_agg(jsonb_build_object(
   'id',g.id,'dueDays',g.due_days,'lockEnabled',g.lock_enabled,'graceHours',g.grace_hours,'unlockHours',g.unlock_hours,
   'locationIds',coalesce((select jsonb_agg(m.location_id order by m.location_id) from public.cash_count_alert_members m where m.group_id=g.id),'[]'::jsonb)) order by g.created_at,g.id)
   from public.cash_count_alert_groups g),'[]'::jsonb),'availableLocationIds',coalesce((select jsonb_agg(id order by name,id) from public.locations l
     where is_active and not exists(select 1 from public.cash_count_alert_members m where m.location_id=l.id)),'[]'::jsonb)) into result;
 return result;
end $$;

-- Reuse the old trigger's branch discovery and active-count guard verbatim.
do $$ declare definition text; updated text; begin
 select pg_get_functiondef('private.guard_cash_count_movement()'::regprocedure) into definition;
 updated:=replace(definition,'  end loop;'||chr(10)||'  if tg_op=',
   '    if coalesce((private.cash_count_lock_state(loc,clock_timestamp())->>''locked'')::boolean,false) then'||chr(10)||
   '      raise exception ''CASH_COUNT_OVERDUE_LOCKED: สาขาเกินกำหนดนับเงิน กรุณานับเงินหรือปลดล็อกชั่วคราว'';'||chr(10)||
   '    end if;'||chr(10)||'  end loop;'||chr(10)||'  if tg_op=');
 if updated=definition then raise exception 'cash count movement guard signature changed'; end if;
 execute updated;
end $$;
create function private.clear_cash_count_unlock_on_submit() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 update public.cash_count_alert_members set unlocked_until=null,unlocked_at=null,unlocked_by_user_id=null,unlocked_by_name=null
   where location_id=new.location_id;
 return new;
end $$;
create trigger clear_cash_count_unlock_after_submit after update of status on public.cash_count_sessions
 for each row when(new.status='submitted' and old.status is distinct from new.status)
 execute function private.clear_cash_count_unlock_on_submit();

-- The alert list and write guard share exactly the same due date calculation.
create or replace function public.get_branch_threshold_alert_check() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare base jsonb; extra jsonb; configured integer;
begin
 base:=private.get_money_weight_threshold_alert_check();
 with groups as (select *,row_number() over(order by created_at,id)::integer as group_order from public.cash_count_alert_groups),
 due as (select g.*,l.id as location_id,l.name,private.cash_count_due_date(l.id) as due_date
   from groups g join public.cash_count_alert_members m on m.group_id=g.id
   join public.locations l on l.id=m.location_id where l.is_active and public.can_access_location(l.id))
 select count(*),coalesce(jsonb_agg(jsonb_build_object('kind','count','locationId',location_id,'locationName',name,
   'groupId',id,'groupOrder',group_order,'threshold',due_days,'value',(current_timestamp at time zone 'Asia/Bangkok')::date-due_date,
   'calculatedAt',current_timestamp,'dueDate',due_date) order by group_order,due_date,name,location_id)
   filter(where due_date<(current_timestamp at time zone 'Asia/Bangkok')::date),'[]'::jsonb) into configured,extra from due;
 return base||jsonb_build_object('candidates',(base->'candidates')||extra,
   'configuredCount',(base->>'configuredCount')::integer+configured,'checkedCount',(base->>'checkedCount')::integer+configured);
end $$;
revoke all on function private.cash_count_due_date(uuid),private.cash_count_lock_state(uuid,timestamptz),
 private.clear_cash_count_unlock_on_submit() from public,anon,authenticated;
revoke all on function public.get_cash_count_overdue_status(uuid),public.unlock_cash_count_overdue(uuid),
 public.save_cash_count_alert_group(uuid,uuid[],integer,boolean,integer,integer) from public,anon;
grant execute on function public.get_cash_count_overdue_status(uuid),public.unlock_cash_count_overdue(uuid),
 public.save_cash_count_alert_group(uuid,uuid[],integer,boolean,integer,integer) to authenticated;
notify pgrst,'reload schema';
