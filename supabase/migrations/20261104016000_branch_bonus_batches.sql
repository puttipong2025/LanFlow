-- Required branch inventory, independent periods, and one atomic confirmation.
create table private.branch_bonus_batches (
  id uuid primary key, actor_id uuid not null, location_id uuid not null,
  fingerprint text not null, result_ids uuid[] not null
);
revoke all on private.branch_bonus_batches from public,anon,authenticated;

create or replace function private.branch_bonus_review(p_location uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare inventory jsonb; periods jsonb;
begin
  perform private.branch_bonus_require_manager(p_location);
  with classified as (
    select e.*,old.id old_bonus,
      exists(select 1 from public.rubber_bills b where b.source_rubber_export_id=e.id
        and b.location_id=e.location_id and b.record_status='active') self_receipt,
      private.branch_bonus_history(e.id) history,
      (select count(*) from public.branch_bonuses b where b.location_id=p_location
        and b.period_end<(e.created_at at time zone 'Asia/Bangkok')::date) window_key
    from public.rubber_exports e left join lateral (
      select b.id from public.branch_bonuses b where b.location_id=p_location
        and (e.created_at at time zone 'Asia/Bangkok')::date between b.period_start and b.period_end
      order by b.period_start,b.id limit 1
    ) old on true
    where e.location_id=p_location and not exists(select 1 from private.branch_bonus_exports x where x.export_id=e.id)
  ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'exportNo',export_no,'createdAt',created_at,
    'originalWeight',original_weight_total,'currentWeight',current_weight,
    'lossPercent',case when original_weight_total>0 then (original_weight_total-current_weight)/original_weight_total*100 end,
    'history',history,'bonusId',old_bonus,'windowKey',window_key,
    'kind',case when self_receipt then 'self' when old_bonus is not null then 'leftover' else 'required' end,
    'issues',case when self_receipt or old_bonus is not null then '[]'::jsonb else
      (case when history then '[]'::jsonb else '["ยังไม่อยู่ในประวัติ"]'::jsonb end)||
      (case when original_weight_total>0 and current_weight>0 and current_weight<original_weight_total
        then '[]'::jsonb else '["น้ำหนักที่ลดลงต้องมากกว่า 0 และน้ำหนักปัจจุบันต้องพร้อม"]'::jsonb end) end)
    order by created_at desc,id desc),'[]') into inventory from classified;
  if (select count(*) from jsonb_array_elements(inventory) v where v->>'kind'='required')>5000 then
    raise exception 'BONUS_INVALID: มี REX รอตรวจเกิน 5,000 รายการ กรุณาติดต่อผู้ดูแลก่อนดำเนินการ';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('key',window_key::text,'exportIds',ids,'periodStart',a,'periodEnd',b,'periodDays',b-a+1)
    order by a),'[]') into periods from (
    select v->>'windowKey' window_key,jsonb_agg(v->>'id' order by v->>'id') ids,
      min(((v->>'createdAt')::timestamptz at time zone 'Asia/Bangkok')::date) a,
      max(((v->>'createdAt')::timestamptz at time zone 'Asia/Bangkok')::date) b
    from jsonb_array_elements(inventory) v where v->>'kind'='required' group by v->>'windowKey'
  ) groups;
  return jsonb_build_object('rows',inventory,'periods',periods,
    'requiredCount',(select count(*) from jsonb_array_elements(inventory) v where v->>'kind'='required'),
    'blockedCount',(select count(*) from jsonb_array_elements(inventory) v where v->>'kind'='required' and jsonb_array_length(v->'issues')>0),
    'fingerprint',md5(jsonb_build_object('rows',inventory,'periods',periods)::text));
end $$;

create or replace function public.review_branch_bonus(p_location uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select private.branch_bonus_review(p_location);
$$;

create or replace function private.branch_bonus_batch_calculate(p_location uuid,p_review text,p_periods jsonb,p_as_of timestamptz)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare review jsonb; part jsonb; expected jsonb; snap jsonb; snaps jsonb:='[]'; seen text[]:='{}';
  k text; w numeric; target numeric; i jsonb;
begin
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
  for part in select value from jsonb_array_elements(p_periods) loop
    if part->>'key'=any(seen) then raise exception 'BONUS_INVALID: ช่วงประเมินซ้ำ'; end if;
    select value into expected from jsonb_array_elements(review->'periods') where value->>'key'=part->>'key';
    i:=part->'input';
    if expected is null or i->'exportIds' is distinct from expected->'exportIds' then
      raise exception 'BONUS_SOURCE_CHANGED: ต้องรวม REX ทุกใบของแต่ละช่วง'; end if;
    seen:=array_append(seen,part->>'key');
    if jsonb_typeof(i->'rate') is distinct from 'number' or (i->>'rate')::numeric<>round((i->>'rate')::numeric,2) then
      raise exception 'BONUS_INVALID: อัตราต่อกิโลกรัมใช้ทศนิยมไม่เกิน 2 ตำแหน่ง'; end if;
    foreach k in array array['burden','loss','counts'] loop
      if jsonb_typeof(i->'metrics'->k->'weight') is distinct from 'number' then raise exception 'BONUS_INVALID: สัดส่วนไม่ถูกต้อง'; end if;
      w:=(i->'metrics'->k->>'weight')::numeric;
      if w<>trunc(w) then raise exception 'BONUS_INVALID: สัดส่วนต้องเป็นจำนวนเต็ม'; end if;
      if w>0 and k<>'counts' and jsonb_typeof(i->'metrics'->k->'target')='number' then
        target:=(i->'metrics'->k->>'target')::numeric;
        if target<0 or target>99999999999 or target<>round(target,2) then raise exception 'BONUS_INVALID: เป้าใช้ทศนิยมไม่เกิน 2 ตำแหน่ง'; end if;
      end if;
    end loop;
    snap:=private.branch_bonus_calculate(p_location,i,p_as_of)||jsonb_build_object('requestVersion','batch-v1');
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
  return jsonb_build_object('periods',(select jsonb_agg(jsonb_build_object('key',v->>'key',
    'preview',private.branch_bonus_present(v->'snapshot')) order by v->>'key') from jsonb_array_elements(snaps) v));
end $$;

create or replace function public.get_branch_bonus_batch(p_location uuid,p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare batch private.branch_bonus_batches%rowtype;
begin
  perform private.branch_bonus_require_manager(p_location);
  select * into batch from private.branch_bonus_batches where id=p_id and location_id=p_location and actor_id=auth.uid();
  if not found then raise exception 'BONUS_NOT_FOUND: ไม่พบคำขอเดิม'; end if;
  return jsonb_build_object('id',batch.id,'results',coalesce((select jsonb_agg(public.get_branch_bonus(p_location,x) order by n)
    from unnest(batch.result_ids) with ordinality t(x,n) where exists(select 1 from public.branch_bonuses b where b.id=x)),'[]'),
    'deletedIds',coalesce((select jsonb_agg(x order by n) from unnest(batch.result_ids) with ordinality t(x,n)
      where not exists(select 1 from public.branch_bonuses b where b.id=x)),'[]'));
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
    select value into expected from jsonb_array_elements(p_periods) where value->>'key'=part->>'key';
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
    select value into expected from jsonb_array_elements(p_periods) where value->>'key'=part->>'key';
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

-- Old requests can only resolve a previously committed receipt; never create.
create or replace function public.confirm_branch_bonus(p_location uuid,p_id uuid,p_input jsonb,p_expected text,p_final_amount numeric default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare receipt private.branch_bonus_request_receipts%rowtype; fingerprint text;
begin
  perform private.branch_bonus_require_manager(p_location);
  fingerprint:=md5(jsonb_build_object('input',p_input,'expected',p_expected,'final',p_final_amount)::text);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('branch-bonus-request:'||p_id::text,0));
  select * into receipt from private.branch_bonus_request_receipts where id=p_id;
  if not found then raise exception 'BONUS_SOURCE_CHANGED: คำขอเดิมยังไม่ได้บันทึก กรุณาตรวจ REX ทั้งหมดใหม่'; end if;
  if receipt.actor_id<>auth.uid() or receipt.location_id<>p_location or receipt.fingerprint<>fingerprint then
    raise exception 'BONUS_CONFLICT: คำขอเดิมมีข้อมูลต่างกัน'; end if;
  if receipt.bonus_id is null then raise exception 'BONUS_CONFLICT: ผลโบนัสนี้ถูกลบแล้ว กรุณาเริ่มรายการใหม่'; end if;
  return public.get_branch_bonus(p_location,receipt.bonus_id);
end $$;

revoke all on function private.branch_bonus_review(uuid),private.branch_bonus_batch_calculate(uuid,text,jsonb,timestamptz) from public,anon,authenticated;
revoke all on function public.review_branch_bonus(uuid),public.preview_branch_bonus_batch(uuid,text,jsonb),
  public.confirm_branch_bonus_batch(uuid,uuid,text,jsonb),public.get_branch_bonus_batch(uuid,uuid) from public,anon;
grant execute on function public.review_branch_bonus(uuid),public.preview_branch_bonus_batch(uuid,text,jsonb),
  public.confirm_branch_bonus_batch(uuid,uuid,text,jsonb),public.get_branch_bonus_batch(uuid,uuid) to authenticated;
