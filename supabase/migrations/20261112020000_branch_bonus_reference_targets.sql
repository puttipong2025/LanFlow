-- Automatic, system-wide, original-weight reference targets for bonus batches.
-- Reference data is read by one STABLE statement snapshot per batch, never by pages.
create or replace function private.branch_bonus_reference(p_location uuid,p_periods jsonb,p_excluded uuid[])
returns jsonb language sql stable security definer set search_path='' as $$
  with windows as materialized (
    select v->>'key' key,(v->>'periodStart')::date a,(v->>'periodEnd')::date b
    from jsonb_array_elements(p_periods) v
  ), candidates as materialized (
    select e.*,private.branch_bonus_history(e.id) history,
      exists(select 1 from public.rubber_bills b where b.source_rubber_export_id=e.id
        and b.location_id=e.location_id and b.record_status='active') self_receipt
    from public.rubber_exports e where e.status<>'deleted' and exists(
      select 1 from windows w where e.created_at>=w.a::timestamp at time zone 'Asia/Bangkok'
        and e.created_at<(w.b+1)::timestamp at time zone 'Asia/Bangkok')
  ), branches as materialized (
    select l.id,l.name,exists(select 1 from candidates e where e.location_id=l.id and not e.history) pending
    from public.locations l
  ), states as materialized (
    select *,id=p_location or (not pending and not id=any(p_excluded)) included from branches
  ), eligible as materialized (
    select e.id,e.location_id,e.created_at,e.original_weight_total,e.current_weight,e.average_age_hours,
      e.age_cutoff_at,e.estimated_age_item_count
    from candidates e join states s on s.id=e.location_id and s.included
    where e.history and not e.self_receipt and e.original_weight_total>0
      and e.current_weight>0 and e.current_weight<e.original_weight_total
  ), periods as (
    select w.key,coalesce(sum(e.original_weight_total),0) weight,count(e.id) count,
      coalesce(bool_and(e.average_age_hours is not null and e.average_age_hours>=0
        and e.average_age_hours<>'NaN'::numeric and e.age_cutoff_at is not null
        and e.estimated_age_item_count is not null and e.estimated_age_item_count>=0) filter(where e.id is not null),false) complete,
      sum(e.original_weight_total*e.average_age_hours)/nullif(sum(e.original_weight_total),0)/24 age,
      sum(e.original_weight_total-e.current_weight)/nullif(sum(e.original_weight_total),0)*100 loss,
      count(e.id) filter(where e.estimated_age_item_count>0) estimated,
      md5(coalesce(jsonb_agg(to_jsonb(e) order by e.id) filter(where e.id is not null),'[]')::text) fingerprint
    from windows w left join eligible e on e.created_at>=w.a::timestamp at time zone 'Asia/Bangkok'
      and e.created_at<(w.b+1)::timestamp at time zone 'Asia/Bangkok' group by w.key
  ) select jsonb_build_object(
    'branches',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'hasPending',pending,'included',included) order by name,id),'[]') from states),
    'scopeFingerprint',(select md5(coalesce(jsonb_agg(jsonb_build_object('id',id,'pending',pending,'included',included) order by id),'[]')::text)
      from states where not id=any(p_excluded)),
    'periods',(select coalesce(jsonb_agg(jsonb_build_object('key',key,'weight',weight,'count',count,'ageComplete',complete,
      'ageTarget',case when complete then age end,'lossTarget',loss,'estimatedCount',estimated,'fingerprint',fingerprint) order by key),'[]') from periods));
$$;

create or replace function private.branch_bonus_page_fingerprint(p_snapshot jsonb)
returns text language sql immutable set search_path='' as $$
  select md5(jsonb_build_object('exports',p_snapshot->'exports','sources',p_snapshot->'allSources',
    'changes',p_snapshot->'observedChanges','gaps',p_snapshot->'gaps',
    'start',p_snapshot->'periodStart','end',p_snapshot->'periodEnd')::text);
$$;

create or replace function private.branch_bonus_batch_calculate(p_location uuid,p_review text,p_periods jsonb,p_as_of timestamptz)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare review jsonb; part jsonb; expected jsonb; snap jsonb; snaps jsonb:='[]'; seen text[]:='{}';
  k text; w numeric; target numeric; i jsonb; excluded uuid[]:='{}'; refs jsonb; ref jsonb; effective jsonb;
begin
  if jsonb_typeof(p_periods)='object' then
    if exists(select 1 from jsonb_object_keys(p_periods) fields(field) where field not in ('periods','excludedLocationIds'))
      or jsonb_typeof(p_periods->'excludedLocationIds') is distinct from 'array'
      or jsonb_array_length(p_periods->'excludedLocationIds')>5000 then raise exception 'BONUS_INVALID: สาขาอ้างอิงไม่ถูกต้อง'; end if;
    select coalesce(array_agg(value::uuid order by value::uuid),'{}') into excluded from jsonb_array_elements_text(p_periods->'excludedLocationIds');
    if cardinality(excluded)<>(select count(distinct x) from unnest(excluded) x)
      or p_location=any(excluded) or exists(select 1 from unnest(excluded) x where not exists(select 1 from public.locations where id=x)) then
      raise exception 'BONUS_INVALID: สาขาอ้างอิงซ้ำ ไม่พบสาขา หรือละเว้นสาขาตนเอง'; end if;
    p_periods:=p_periods->'periods';
  end if;
  review:=private.branch_bonus_review(p_location);
  if review->>'fingerprint' is distinct from p_review then raise exception 'BONUS_SOURCE_CHANGED: ชุด REX เปลี่ยนแล้ว กรุณาตรวจใหม่'; end if;
  if (review->>'requiredCount')::integer=0 or (review->>'blockedCount')::integer>0 then
    raise exception 'BONUS_SOURCE_CHANGED: ต้องตรวจ REX ทุกใบให้อยู่ในประวัติและมีน้ำหนักลดลงก่อน';
  end if;
  if jsonb_typeof(p_periods) is distinct from 'array' or jsonb_array_length(p_periods)<>jsonb_array_length(review->'periods')
    or jsonb_array_length(p_periods)>100 then raise exception 'BONUS_INVALID: ช่วงประเมินไม่ครบหรือเกิน 100 ช่วง'; end if;
  if exists(select 1 from jsonb_array_elements(p_periods) v where jsonb_typeof(v) is distinct from 'object'
    or jsonb_typeof(v->'input') is distinct from 'object' or jsonb_typeof(v->'input'->'excludedKeys') is distinct from 'array') then
    raise exception 'BONUS_INVALID: ข้อมูลแต่ละช่วงไม่ถูกต้อง'; end if;
  if (select coalesce(sum(jsonb_array_length(v->'input'->'excludedKeys')),0) from jsonb_array_elements(p_periods) v)>50000 then
    raise exception 'BONUS_INVALID: รายการยกเว้นรวมเกินขอบเขต'; end if;
  refs:=private.branch_bonus_reference(p_location,review->'periods',excluded);
  for part in select value from jsonb_array_elements(p_periods) loop
    if part->>'key'=any(seen) then raise exception 'BONUS_INVALID: ช่วงประเมินซ้ำ'; end if;
    select value into expected from jsonb_array_elements(review->'periods') where value->>'key'=part->>'key';
    i:=part->'input';
    if expected is null or i->'exportIds' is distinct from expected->'exportIds' then
      raise exception 'BONUS_SOURCE_CHANGED: ต้องรวม REX ทุกใบของแต่ละช่วง'; end if;
    seen:=array_append(seen,part->>'key');
    if jsonb_typeof(i->'rate') is distinct from 'number' or (i->>'rate')::numeric<>round((i->>'rate')::numeric,2) then
      raise exception 'BONUS_INVALID: อัตราต่อกิโลกรัมใช้ทศนิยมไม่เกิน 2 ตำแหน่ง'; end if;
    foreach k in array array['burden','loss','counts','age'] loop
      if jsonb_typeof(i->'metrics'->k->'weight') is distinct from 'number' then raise exception 'BONUS_INVALID: สัดส่วนไม่ถูกต้อง'; end if;
      w:=(i->'metrics'->k->>'weight')::numeric;
      if w<>trunc(w) then raise exception 'BONUS_INVALID: สัดส่วนต้องเป็นจำนวนเต็ม'; end if;
      if w>0 and k='burden' and jsonb_typeof(i->'metrics'->k->'target')='number' then
        target:=(i->'metrics'->k->>'target')::numeric;
        if target<0 or target>99999999999 or target<>round(target,2) then raise exception 'BONUS_INVALID: เป้าใช้ทศนิยมไม่เกิน 2 ตำแหน่ง'; end if;
      end if;
    end loop;
    select value into ref from jsonb_array_elements(refs->'periods') where value->>'key'=part->>'key';
    if coalesce((ref->>'weight')::numeric,0)<=0 then raise exception 'BONUS_SOURCE_CHANGED: ไม่มี REX อ้างอิงที่พร้อม กรุณาตรวจใหม่'; end if;
    effective:=jsonb_set(jsonb_set(i,'{metrics,loss,target}',ref->'lossTarget'),'{metrics,age,target}',ref->'ageTarget');
    snap:=private.branch_bonus_calculate(p_location,effective,p_as_of);
    if (i->'metrics'->'age'->>'weight')::numeric>0 and (not (ref->>'ageComplete')::boolean or (ref->>'ageTarget')::numeric=0) then
      snap:=jsonb_set(snap,'{issues}',(select jsonb_agg(case when v='"กรุณากำหนดเป้าที่ถูกต้องสำหรับ อายุยาง"'::jsonb then
        to_jsonb(case when not (ref->>'ageComplete')::boolean then 'REX อ้างอิงบางใบขาดอายุ ณ ตรวจสอบ กรุณาละเว้นสาขานั้นหรือปรับสัดส่วนอายุยางเป็น 0%'
        else 'เป้าอายุเฉลี่ยเป็น 0 วัน กรุณาปรับสัดส่วนอายุยางเป็น 0%' end) else v end) from jsonb_array_elements(snap->'issues') v));
    end if;
    snap:=snap||jsonb_build_object('requestVersion','batch-v1','formulaVersion','branch-bonus-v4',
      'pageFingerprint',private.branch_bonus_page_fingerprint(snap),
      'reference',(ref-'key'-'fingerprint')||jsonb_build_object('branches',refs->'branches'),
      'sourceFingerprint',md5(jsonb_build_object('page',private.branch_bonus_page_fingerprint(snap),'input',i,
        'reference',ref->'fingerprint','scope',refs->'scopeFingerprint','excluded',to_jsonb(excluded),'formula','branch-bonus-v4')::text));
    snaps:=snaps||jsonb_build_array(jsonb_build_object('key',part->>'key','input',i,'snapshot',snap));
  end loop;
  return snaps;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'BONUS_INVALID: ข้อมูลประเมินไม่ถูกต้อง';
end $$;

create or replace function public.preview_branch_bonus_batch(p_location uuid,p_review text,p_periods jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare snaps jsonb;
begin
  perform private.branch_bonus_require_manager(p_location);
  perform private.lock_report_locations(array[p_location]);
  snaps:=private.branch_bonus_batch_calculate(p_location,p_review,p_periods,clock_timestamp());
  return jsonb_build_object('referenceBranches',snaps->0->'snapshot'->'reference'->'branches','periods',(select jsonb_agg(jsonb_build_object('key',v->>'key',
    'preview',private.branch_bonus_present(v->'snapshot')) order by v->>'key') from jsonb_array_elements(snaps) v));
end $$;

create or replace function public.confirm_branch_bonus_batch(p_location uuid,p_id uuid,p_review text,p_periods jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare fingerprint text; batch private.branch_bonus_batches%rowtype; snaps jsonb; part jsonb; snap jsonb; expected jsonb;
  result_ids uuid[]:='{}'; result_id uuid; actor_name text; changes_saved boolean:=false;
begin
  perform private.branch_bonus_require_manager(p_location);
  if p_id is null then raise exception 'BONUS_INVALID: ไม่มีรหัสคำขอ'; end if;
  fingerprint:=md5(jsonb_build_object('review',p_review,'periods',p_periods)::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('branch-bonus-batch:'||p_id::text,0));
  select * into batch from private.branch_bonus_batches where id=p_id;
  if found then
    if batch.actor_id<>auth.uid() or batch.location_id<>p_location or batch.fingerprint<>fingerprint then
      raise exception 'BONUS_CONFLICT: คำขอเดิมมีข้อมูลต่างกัน'; end if;
    return public.get_branch_bonus_batch(p_location,p_id);
  end if;
  perform private.lock_report_locations(array[p_location]);
  -- Calculate ALL snapshots before the first write changes the observations.
  snaps:=private.branch_bonus_batch_calculate(p_location,p_review,p_periods,clock_timestamp());
  for part in select value from jsonb_array_elements(snaps) loop
    snap:=part->'snapshot';
    select value into expected from jsonb_array_elements(case when jsonb_typeof(p_periods)='object' then p_periods->'periods' else p_periods end) where value->>'key'=part->>'key';
    if snap->>'sourceFingerprint' is distinct from expected->>'expected' then
      raise exception 'BONUS_SOURCE_CHANGED: ข้อมูลเปลี่ยนแล้ว กรุณาตรวจยอดทุกช่วงใหม่'; end if;
    if not (snap->>'canConfirm')::boolean then raise exception 'BONUS_INVALID: ทุกช่วงต้องกำหนดเป้าและสัดส่วนให้ครบ'; end if;
    if expected->'finalAmount' is not null and expected->'finalAmount'<>'null'::jsonb and (
      jsonb_typeof(expected->'finalAmount')<>'number' or (expected->>'finalAmount')::numeric<0
      or (expected->>'finalAmount')::numeric>9999999999.99
      or (expected->>'finalAmount')::numeric<>round((expected->>'finalAmount')::numeric,2)) then
      raise exception 'BONUS_INVALID: ยอดโบนัสสุดท้ายไม่ถูกต้อง'; end if;
  end loop;
  select name into actor_name from public.profiles where id=auth.uid() and is_active;
  for part in select value from jsonb_array_elements(snaps) loop
    snap:=part->'snapshot';result_id:=gen_random_uuid();result_ids:=array_append(result_ids,result_id);
    select value into expected from jsonb_array_elements(case when jsonb_typeof(p_periods)='object' then p_periods->'periods' else p_periods end) where value->>'key'=part->>'key';
    snap:=snap||jsonb_build_object('finalAmount',coalesce((expected->>'finalAmount')::numeric,(snap->>'suggestedAmount')::numeric));
    insert into public.branch_bonuses(id,location_id,period_start,period_end,input,request_fingerprint,snapshot,created_by_user_id,created_by_name)
      values(result_id,p_location,(snap->>'periodStart')::date,(snap->>'periodEnd')::date,part->'input',fingerprint,snap,auth.uid(),actor_name);
    insert into private.branch_bonus_exports(bonus_id,export_id)
      select result_id,(v->>'id')::uuid from jsonb_array_elements(snap->'exports') v;
    insert into private.branch_bonus_sources(bonus_id,origin_bonus_id,location_id,source_key)
      select result_id,result_id,p_location,v->>'key' from jsonb_array_elements(snap->'allSources') v;
    -- Shared old differences are acknowledged once, owned by the first result.
    if not changes_saved then
      insert into private.branch_bonus_observations(bonus_id,origin_bonus_id,source_key,observed_source)
        select result_id,(v->>'bonus_id')::uuid,v->>'source_key',nullif(v->'observed_source','null'::jsonb)
        from jsonb_array_elements(snap->'observedChanges') v where not (v->>'unknown')::boolean;
      insert into private.branch_bonus_sources(bonus_id,origin_bonus_id,location_id,source_key)
        select result_id,(v->>'bonus_id')::uuid,p_location,v->>'source_key' from jsonb_array_elements(snap->'observedChanges') v
        where not (v->>'unknown')::boolean on conflict(location_id,source_key) do nothing;
      changes_saved:=true;
    end if;
  end loop;
  insert into private.branch_bonus_batches values(p_id,auth.uid(),p_location,fingerprint,result_ids);
  return public.get_branch_bonus_batch(p_location,p_id);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'BONUS_INVALID: ข้อมูลยืนยันไม่ถูกต้อง';
end $$;

create or replace function public.get_branch_bonus_source_page(p_location uuid,p_input jsonb,p_section text,p_offset integer default 0,p_bonus_id uuid default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare snap jsonb; result jsonb;
begin
  perform private.branch_bonus_require_manager(p_location);
  if p_section not in ('expenses','purchases','counts','changes') or p_offset<0 then raise exception 'BONUS_INVALID: หน้ารายการไม่ถูกต้อง'; end if;
  if p_bonus_id is null then snap:=private.branch_bonus_calculate(p_location,p_input,clock_timestamp());
  else select snapshot into snap from public.branch_bonuses where id=p_bonus_id and location_id=p_location; end if;
  if p_bonus_id is null then snap:=snap||jsonb_build_object('pageFingerprint',private.branch_bonus_page_fingerprint(snap)); end if;
  if snap is null then raise exception 'BONUS_NOT_FOUND: ไม่พบผลโบนัส'; end if;
  if p_section='changes' then
    return jsonb_build_object('sourceFingerprint',snap->>'sourceFingerprint','pageFingerprint',snap->>'pageFingerprint','rows',coalesce((select jsonb_agg(v-'observed_source')
      from (select v from jsonb_array_elements(coalesce(snap->'observedChanges','[]')) v offset p_offset limit 50) x),'[]'));
  end if;
  select jsonb_build_object('rows',coalesce(jsonb_agg(v order by n),'[]'),'sourceFingerprint',snap->>'sourceFingerprint','pageFingerprint',snap->>'pageFingerprint') into result
  from (select v,n from jsonb_array_elements(snap->'allSources') with ordinality t(v,n)
    where case p_section when 'purchases' then v->>'kind'='purchase' when 'counts' then v->>'kind'='count'
      else v->>'kind' not in ('purchase','count') end order by n offset p_offset limit 50) x;
  return result;
end $$;

revoke all on function private.branch_bonus_reference(uuid,jsonb,uuid[]),private.branch_bonus_page_fingerprint(jsonb) from public,anon,authenticated;
-- Existing public RPC signatures and ACLs are preserved by CREATE OR REPLACE.
