-- Fourth bonus metric: verified REX age, weighted by original weight.
-- No new tables or changes to existing confirmed snapshots.

create or replace function private.branch_bonus_calculate(p_location uuid,p_input jsonb,p_as_of timestamptz)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare ids uuid[]; a date; b date; cutoff timestamptz; exports jsonb; sources jsonb; gaps jsonb; changes jsonb;
  expenses numeric; purchases numeric; counts numeric; original numeric; loss numeric;
  age_weighted_hours numeric; age_days numeric; age_complete boolean; age_estimated integer;
  rate numeric; weights numeric:=0; adjustment numeric:=0; metrics jsonb:='[]'; issues jsonb:='[]';
  k text; w numeric; target numeric; actual numeric; relative numeric; tier numeric;
  base numeric; suggested numeric; fp text; overlap boolean; all_complete boolean; burden_complete boolean; count_complete boolean;
begin
  perform private.branch_bonus_require_manager(p_location);
  if p_input is null or jsonb_typeof(p_input) is distinct from 'object'
    or jsonb_typeof(p_input->'exportIds') is distinct from 'array'
    or jsonb_typeof(p_input->'excludedKeys') is distinct from 'array' or jsonb_typeof(p_input->'excludedGroups') is distinct from 'array'
    or jsonb_typeof(p_input->'metrics') is distinct from 'object'
    or jsonb_typeof(p_input->'rate') is distinct from 'number' then
    raise exception 'BONUS_INVALID: ข้อมูลประเมินไม่ครบ';
  end if;
  if jsonb_array_length(p_input->'exportIds') not between 1 and 5000
    or jsonb_array_length(p_input->'excludedKeys')>50000 or jsonb_array_length(p_input->'excludedGroups')>6
    or exists(select 1 from jsonb_array_elements(p_input->'excludedKeys') v where jsonb_typeof(v)<>'string')
    or exists(select 1 from jsonb_array_elements_text(p_input->'excludedGroups') v where v not in ('expense','withdrawal','payroll','transport','work','fee')) then
    raise exception 'BONUS_INVALID: รายการหรือการยกเว้นไม่ถูกต้อง';
  end if;
  select array_agg(distinct value::uuid order by value::uuid) into ids
    from jsonb_array_elements_text(p_input->'exportIds');
  if cardinality(ids)<>jsonb_array_length(p_input->'exportIds') then raise exception 'BONUS_INVALID: REX ซ้ำ'; end if;
  if exists(select 1 from unnest(ids) x left join public.rubber_exports e on e.id=x
    where e.id is null or e.location_id<>p_location or not private.branch_bonus_history(e.id)
      or e.current_weight is null or e.current_weight<=0 or e.current_weight>=e.original_weight_total) then
    raise exception 'BONUS_SOURCE_CHANGED: เลือกได้เฉพาะ REX ในประวัติที่มีน้ำหนักลดลงจริงและพร้อมประเมิน กรุณาโหลดรายการใหม่';
  end if;
  select min((created_at at time zone 'Asia/Bangkok')::date),max((created_at at time zone 'Asia/Bangkok')::date),
    sum(original_weight_total),sum(original_weight_total-current_weight),
    sum(original_weight_total*average_age_hours),
    bool_and(average_age_hours is not null and average_age_hours>=0 and average_age_hours<>'NaN'::numeric
      and age_cutoff_at is not null and estimated_age_item_count is not null and estimated_age_item_count>=0),
    count(*) filter(where estimated_age_item_count>0),
    jsonb_agg(jsonb_build_object('id',id,'exportNo',export_no,'createdAt',created_at,
      'originalWeight',original_weight_total,'currentWeight',current_weight,
      'averageAgeHours',average_age_hours,'ageCutoffAt',age_cutoff_at,'estimatedAgeItemCount',estimated_age_item_count,
      'lossPercent',(original_weight_total-current_weight)/original_weight_total*100) order by id)
    into a,b,original,loss,age_weighted_hours,age_complete,age_estimated,exports from public.rubber_exports where id=any(ids);
  age_days:=case when age_complete then age_weighted_hours/original/24 end;
  if b>(p_as_of at time zone 'Asia/Bangkok')::date then raise exception 'BONUS_INVALID: REX อยู่ในอนาคต'; end if;
  cutoff:=least(p_as_of, (b+1)::timestamp at time zone 'Asia/Bangkok');
  select exists(select 1 from public.branch_bonuses x where x.location_id=p_location
    and x.period_start<=b and x.period_end>=a) into overlap;
  -- One statement snapshot for every source, regardless of REST row limits.
  select coalesce(jsonb_agg(jsonb_build_object('key',r.key,'id',r.id,'kind',r.kind,
    'date',r.business_date,'occurredAt',r.occurred_at,'label',r.label,'amount',r.amount,
    'included',case when r.kind in ('purchase','count') then true else
      not (p_input->'excludedKeys' ? r.key or p_input->'excludedGroups' ? r.kind) end)
    order by r.business_date,r.kind,r.id),'[]') into sources
  from private.branch_bonus_source_rows r where r.location_id=p_location and r.business_date between a and b
    and r.recorded_at<=p_as_of and r.occurred_at<=cutoff
    and (overlap or not exists(select 1 from private.branch_bonus_sources seen where seen.location_id=p_location and seen.source_key=r.key));
  select coalesce(jsonb_agg(jsonb_build_object('kind',kind,'date',business_date) order by business_date,kind),'[]')
    into gaps from private.branch_bonus_source_gaps where location_id=p_location and business_date between a and b;
  select coalesce(sum((v->>'amount')::numeric) filter(where v->>'kind' not in ('purchase','count') and (v->>'included')::boolean),0),
    coalesce(sum((v->>'amount')::numeric) filter(where v->>'kind'='purchase'),0),
    coalesce(sum((v->>'amount')::numeric) filter(where v->>'kind'='count'),0)
    into expenses,purchases,counts from jsonb_array_elements(sources) v;
  rate:=(p_input->>'rate')::numeric;
  if rate<0 or rate>1000 or rate<>round(rate,4) then raise exception 'BONUS_INVALID: อัตราต่อกิโลกรัมไม่ถูกต้อง'; end if;
  base:=round(original*rate,2);
  if rate=0 then issues:=issues||jsonb_build_array('กรุณากำหนดอัตราโบนัสมากกว่า 0'); end if;
  all_complete:=jsonb_array_length(gaps)=0;
  burden_complete:=not exists(select 1 from jsonb_array_elements(gaps) g where g->>'kind'<>'count'
    and (g->>'kind'='purchase' or not p_input->'excludedGroups' ? (g->>'kind')));
  count_complete:=not exists(select 1 from jsonb_array_elements(gaps) g where g->>'kind'='count');
  foreach k in array array['burden','loss','counts','age'] loop
    if jsonb_typeof(p_input->'metrics'->k) is distinct from 'object' or jsonb_typeof(p_input->'metrics'->k->'weight') is distinct from 'number' then
      raise exception 'BONUS_INVALID: สัดส่วนไม่ถูกต้อง';
    end if;
    w:=(p_input->'metrics'->k->>'weight')::numeric;
    if w<0 or w>100 or w<>round(w,2) then raise exception 'BONUS_INVALID: สัดส่วนต้องอยู่ระหว่าง 0–100'; end if;
    weights:=weights+w;
    if w=0 then continue; end if; -- Do not even parse a disabled target.
    target:=null;
    if k='counts' then target:=(b-a+1);
    elsif jsonb_typeof(p_input->'metrics'->k->'target')='number' then target:=(p_input->'metrics'->k->>'target')::numeric; end if;
    actual:=case k when 'burden' then case when purchases>0 then expenses/purchases*100 end
      when 'loss' then loss/original*100 when 'age' then age_days else counts end;
    if (k='burden' and not burden_complete) or (k='counts' and not count_complete) then actual:=null; end if;
    relative:=null; tier:=null;
    if target is null or target<=0 then
      issues:=issues||jsonb_build_array('กรุณากำหนดเป้าที่ถูกต้องสำหรับ '||case k when 'burden' then 'ภาระดำเนินงาน' when 'loss' then 'น้ำหนักลดลง' when 'age' then 'อายุยาง' else 'จำนวนรายการนับเงิน' end);
    elsif actual is null then
      issues:=issues||jsonb_build_array(case when k='burden' and purchases=0 then 'ยอดซื้อเป็นศูนย์ จึงคำนวณภาระดำเนินงานไม่ได้' when k='age' then 'REX บางใบขาดอายุ ณ ตรวจสอบ กรุณาแก้ต้นทางหรือปรับสัดส่วนอายุยางเป็น 0%' else 'ข้อมูลต้นทางไม่ครบ จึงประเมินด้านนี้ไม่ได้' end);
    else
      -- Compare the weighted hours directly; do not round days before tier selection.
      relative:=case when k='age' then (age_weighted_hours-target*24*original)/(target*24*original)*100
        when k='counts' then (actual-target)/target*100 else (target-actual)/target*100 end;
      tier:=case when relative>=20 then 20 when relative>=5 then 10 when relative<=-20 then -20 when relative<=-5 then -10 else 0 end;
      adjustment:=adjustment+tier*w/100;
    end if;
    metrics:=metrics||jsonb_build_array(jsonb_build_object('key',k,'weight',w,'target',target,'actual',actual,
      'relative',relative,'adjustment',tier,'weightedAdjustment',tier*w/100));
  end loop;
  if weights<>100 then issues:=issues||jsonb_build_array('สัดส่วนรวมต้องเท่ากับ 100%'); end if;
  if overlap then issues:=issues||jsonb_build_array('ช่วงวันที่ซ้อนกับผลโบนัสที่ยืนยันแล้ว'); end if;
  suggested:=round(base*(1+adjustment/100),2);
  if suggested>9999999999.99 then issues:=issues||jsonb_build_array('ยอดโบนัสเกินขอบเขตที่ระบบรองรับ กรุณาลดอัตราต่อกิโลกรัม'); end if;
  select coalesce(jsonb_agg(to_jsonb(c) order by c.bonus_id,c.source_key),'[]') into changes from private.branch_bonus_changes(p_location) c;
  fp:=md5(jsonb_build_object('sources',sources,'exports',exports,'gaps',gaps,'changes',changes,'input',p_input,
    'start',a,'end',b,'formula','branch-bonus-v3')::text);
  return jsonb_build_object('periodStart',a,'periodEnd',b,'periodDays',b-a+1,'asOf',cutoff,'formulaVersion','branch-bonus-v3',
    'exports',exports,'allSources',sources,'observedChanges',changes,'overlap',overlap,'gaps',gaps,'complete',all_complete,'sourceFingerprint',fp,
    'weight',original,'expenseTotal',expenses,'purchaseTotal',purchases,'countTotal',counts,
    'burdenActual',case when purchases>0 and burden_complete then expenses/purchases*100 end,
    'countActual',case when count_complete then counts end,
    'ageActual',age_days,'ageEstimatedExportCount',age_estimated,
    'lossActual',loss/original*100,'metrics',metrics,'rate',rate,'base',base,'adjustment',adjustment,
    'suggestedAmount',suggested,'issues',issues,'canConfirm',jsonb_array_length(issues)=0,
    'scenarios',case when weights=100 and not exists(select 1 from jsonb_array_elements(metrics) m where m->>'adjustment' is null)
      then (select jsonb_agg(jsonb_build_object('rate',r,'base',round(original*r,2),
        'adjustmentAmount',round(original*r*(1+adjustment/100),2)-round(original*r,2),
        'amount',round(original*r*(1+adjustment/100),2)) order by r) from (values (.01::numeric),(.02::numeric),(.03::numeric)) rates(r)) else '[]'::jsonb end);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'BONUS_INVALID: รูปแบบตัวเลขหรือรายการไม่ถูกต้อง';
end $$;

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
    'averageAgeHours',average_age_hours,'ageCutoffAt',age_cutoff_at,'estimatedAgeItemCount',estimated_age_item_count,
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
    foreach k in array array['burden','loss','counts','age'] loop
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

