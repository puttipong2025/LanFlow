-- Minimal replay receipts prevent delayed confirmations resurrecting deleted bonuses.
-- No canceled snapshot or user-facing cancellation history is retained.
create table private.branch_bonus_request_receipts (
  id uuid primary key, actor_id uuid not null, location_id uuid not null,
  fingerprint text not null, bonus_id uuid references public.branch_bonuses(id) on delete set null
);
revoke all on private.branch_bonus_request_receipts from public,anon,authenticated;

create or replace function public.get_branch_bonus(p_location uuid,p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b public.branch_bonuses%rowtype;
begin
  perform private.branch_bonus_require_manager(p_location);
  select * into b from public.branch_bonuses where id=p_id and location_id=p_location;
  if not found then raise exception 'BONUS_NOT_FOUND: ไม่พบผลโบนัส'; end if;
  return private.branch_bonus_present(b.snapshot)||jsonb_build_object('id',b.id,'input',b.input,
    'createdAt',b.created_at,'createdByName',b.created_by_name);
end $$;

create or replace function public.list_branch_bonuses(p_location uuid,p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb; more boolean;
begin
  perform private.branch_bonus_require_manager(p_location);
  with page as (select * from public.branch_bonuses where location_id=p_location
    and (p_before is null or (created_at,id)<(p_before,p_before_id)) order by created_at desc,id desc limit 51),
  visible as (select * from page order by created_at desc,id desc limit 50)
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'periodStart',period_start,'periodEnd',period_end,
    'createdAt',created_at,'createdByName',created_by_name,'finalAmount',snapshot->'finalAmount',
    'suggestedAmount',snapshot->'suggestedAmount','weight',snapshot->'weight') order by created_at desc,id desc),'[]'),
    (select count(*)>50 from page) into rows,more from visible;
  return jsonb_build_object('rows',rows,'hasMore',more);
end $$;

create or replace function public.get_branch_bonus_candidates(p_location uuid,p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare rows jsonb; more boolean;
begin
  perform private.branch_bonus_require_manager(p_location);
  with page as (select e.* from public.rubber_exports e where e.location_id=p_location
    and private.branch_bonus_history(e.id)
    and (p_before is null or (e.created_at,e.id)<(p_before,p_before_id))
    order by e.created_at desc,e.id desc limit 51),
  visible as (select * from page order by created_at desc,id desc limit 50)
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'exportNo',e.export_no,'createdAt',e.created_at,
    'originalWeight',e.original_weight_total,'currentWeight',e.current_weight,
    'lossPercent',case when e.current_weight is not null then (e.original_weight_total-e.current_weight)/e.original_weight_total*100 end,
    'ready',e.current_weight>0 and e.current_weight<e.original_weight_total,
    'bonusId',(select bonus_id from private.branch_bonus_exports where export_id=e.id)) order by e.created_at desc,e.id desc),'[]'),
    (select count(*)>50 from page) into rows,more from visible e;
  return jsonb_build_object('rows',rows,'hasMore',more);
end $$;

create or replace function public.confirm_branch_bonus(p_location uuid,p_id uuid,p_input jsonb,p_expected text,p_final_amount numeric default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare snap jsonb; receipt private.branch_bonus_request_receipts%rowtype; fingerprint text; actor_name text;
begin
  perform private.branch_bonus_require_manager(p_location);
  if p_id is null or p_expected is null or p_expected !~ '^[a-f0-9]{32}$' then raise exception 'BONUS_INVALID: ข้อมูลยืนยันไม่ครบ'; end if;
  fingerprint:=md5(jsonb_build_object('input',p_input,'expected',p_expected,'final',p_final_amount)::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('branch-bonus-request:'||p_id::text,0));
  select * into receipt from private.branch_bonus_request_receipts where id=p_id;
  if found then
    if receipt.actor_id<>auth.uid() or receipt.location_id<>p_location or receipt.fingerprint<>fingerprint then
      raise exception 'BONUS_CONFLICT: คำขอเดิมมีข้อมูลต่างกัน';
    end if;
    if receipt.bonus_id is null then raise exception 'BONUS_CONFLICT: ผลโบนัสนี้ถูกลบแล้ว กรุณาเริ่มรายการใหม่'; end if;
    return public.get_branch_bonus(p_location,receipt.bonus_id);
  end if;
  perform private.lock_report_locations(array[p_location]);
  snap:=private.branch_bonus_calculate(p_location,p_input,clock_timestamp());
  if exists(select 1 from public.branch_bonuses where location_id=p_location
    and period_start<=(snap->>'periodEnd')::date and period_end>=(snap->>'periodStart')::date) then
    raise exception 'BONUS_CONFLICT: ช่วงวันที่ซ้อนกับผลโบนัสที่ยืนยันแล้ว';
  end if;
  if snap->>'sourceFingerprint'<>p_expected then
    raise exception 'BONUS_SOURCE_CHANGED: ข้อมูลเปลี่ยนแล้ว กรุณาคำนวณและตรวจยอดใหม่ก่อนยืนยัน';
  end if;
  if not (snap->>'canConfirm')::boolean then
    raise exception 'BONUS_INVALID: %', (select string_agg(value,'; ') from jsonb_array_elements_text(snap->'issues'));
  end if;
  if p_final_amount is not null and (p_final_amount::text in ('NaN','Infinity','-Infinity')
    or p_final_amount<0 or p_final_amount>9999999999.99 or p_final_amount<>round(p_final_amount,2)) then
    raise exception 'BONUS_INVALID: ยอดสุดท้ายไม่ถูกต้อง';
  end if;
  snap:=snap||jsonb_build_object('finalAmount',coalesce(p_final_amount,(snap->>'suggestedAmount')::numeric));
  select name into actor_name from public.profiles where id=auth.uid() and is_active;
  insert into public.branch_bonuses(id,location_id,period_start,period_end,input,request_fingerprint,snapshot,created_by_user_id,created_by_name)
  values(p_id,p_location,(snap->>'periodStart')::date,(snap->>'periodEnd')::date,p_input,fingerprint,snap,auth.uid(),actor_name);
  insert into private.branch_bonus_exports(bonus_id,export_id)
    select p_id,(v->>'id')::uuid from jsonb_array_elements(snap->'exports') v;
  insert into private.branch_bonus_observations(bonus_id,origin_bonus_id,source_key,observed_source)
    select p_id,(v->>'bonus_id')::uuid,v->>'source_key',nullif(v->'observed_source','null'::jsonb)
    from jsonb_array_elements(snap->'observedChanges') v where not (v->>'unknown')::boolean;
  insert into private.branch_bonus_sources(bonus_id,origin_bonus_id,location_id,source_key)
    select p_id,p_id,p_location,v->>'key' from jsonb_array_elements(snap->'allSources') v;
  -- Late arrivals considered through differences also become considered sources.
  insert into private.branch_bonus_sources(bonus_id,origin_bonus_id,location_id,source_key)
    select p_id,(v->>'bonus_id')::uuid,p_location,v->>'source_key' from jsonb_array_elements(snap->'observedChanges') v
    where not (v->>'unknown')::boolean on conflict(location_id,source_key) do nothing;
  insert into private.branch_bonus_request_receipts values(p_id,auth.uid(),p_location,fingerprint,p_id);
  return public.get_branch_bonus(p_location,p_id);
end $$;

create or replace function public.delete_branch_bonus(p_location uuid,p_id uuid)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
  perform private.branch_bonus_require_manager(p_location);
  perform private.lock_report_locations(array[p_location]);
  delete from public.branch_bonuses where id=p_id and location_id=p_location;
  return jsonb_build_object('id',p_id,'deleted',true);
end $$;

-- Lock source branches before receipt relationships change. Try-lock avoids
-- deadlock when a destination-side writer already holds its own branch lock.
create or replace function private.lock_branch_bonus_history_change()
returns trigger language plpgsql security definer set search_path='' as $$
declare ids uuid[]:='{}'; j jsonb; loc uuid;
begin
  for j in select value from jsonb_array_elements(jsonb_build_array(
    case when tg_op<>'INSERT' then to_jsonb(old) end,
    case when tg_op<>'DELETE' then to_jsonb(new) end)) where value<>'null'::jsonb loop
    if j->>'source_rubber_export_id' is not null then
      select location_id into loc from public.rubber_exports where id=(j->>'source_rubber_export_id')::uuid;
      -- Existing cash_count_movement_guard already serializes the own branch.
      -- Only a cross-branch receipt needs this additional source-branch fence.
      if loc is distinct from (j->>'location_id')::uuid then ids:=array_append(ids,loc); end if;
    end if;
  end loop;
  for loc in select distinct x from unnest(ids) x where x is not null order by x loop
    if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(loc::text,0)) then
      raise exception 'BONUS_SOURCE_CHANGED: รายการกำลังถูกใช้งาน กรุณาลองอีกครั้ง';
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

create or replace function private.guard_branch_bonus_history()
returns trigger language plpgsql security definer set search_path='' as $$
declare ids uuid[]:='{}'; j jsonb; v_export_id uuid;
begin
  for j in select value from jsonb_array_elements(jsonb_build_array(
    case when tg_op<>'INSERT' then to_jsonb(old) end,
    case when tg_op<>'DELETE' then to_jsonb(new) end)) where value<>'null'::jsonb loop
    ids:=array_append(ids,case tg_table_name when 'rubber_exports' then (j->>'id')::uuid else (j->>'source_rubber_export_id')::uuid end);
  end loop;
  foreach v_export_id in array ids loop
    if v_export_id is not null and exists(select 1 from private.branch_bonus_exports x where x.export_id=v_export_id)
      and not private.branch_bonus_history(v_export_id) then
      raise exception 'BONUS_HISTORY_LOCKED: รายการนี้ใช้ในผลโบนัสแล้ว กรุณาลบผลโบนัสที่เกี่ยวข้องก่อนนำออกจากประวัติ';
    end if;
  end loop;
  return null;
end $$;

create trigger aa_branch_bonus_history_lock before insert or update or delete on public.rubber_bills
  for each row execute function private.lock_branch_bonus_history_change();
create constraint trigger branch_bonus_history_guard after insert or update or delete on public.rubber_exports
  deferrable initially immediate for each row execute function private.guard_branch_bonus_history();
create constraint trigger branch_bonus_history_guard after insert or update or delete on public.rubber_bills
  deferrable initially immediate for each row execute function private.guard_branch_bonus_history();

-- Old snapshots are evidence; differences do not enter current-period metrics.
create or replace function public.get_branch_bonus_changes(p_location uuid,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.branch_bonus_require_manager(p_location);
  if p_offset<0 then raise exception 'BONUS_INVALID: หน้ารายการไม่ถูกต้อง'; end if;
  with changes as (select * from private.branch_bonus_changes(p_location))
  select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(c)-'observed_source'),'[]'),
      'hasMore',(select count(*)>p_offset+50 from changes)) into result
    from (select * from changes order by bonus_id,source_key offset p_offset limit 50) c;
  return result;
end $$;

revoke all on function private.lock_branch_bonus_history_change(),private.guard_branch_bonus_history() from public,anon,authenticated;
revoke all on function public.get_branch_bonus(uuid,uuid),public.list_branch_bonuses(uuid,timestamptz,uuid),
  public.get_branch_bonus_candidates(uuid,timestamptz,uuid),public.confirm_branch_bonus(uuid,uuid,jsonb,text,numeric),
  public.delete_branch_bonus(uuid,uuid),public.get_branch_bonus_changes(uuid,integer) from public,anon;
grant execute on function public.get_branch_bonus(uuid,uuid),public.list_branch_bonuses(uuid,timestamptz,uuid),
  public.get_branch_bonus_candidates(uuid,timestamptz,uuid),public.confirm_branch_bonus(uuid,uuid,jsonb,text,numeric),
  public.delete_branch_bonus(uuid,uuid),public.get_branch_bonus_changes(uuid,integer) to authenticated;
