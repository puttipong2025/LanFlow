-- User-confirmed: one target cash count per inclusive Bangkok assessment day.
-- The server derives this target; saved v1 snapshots keep their original goals.
create or replace function private.branch_bonus_calculate(p_location uuid,p_input jsonb,p_as_of timestamptz)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare ids uuid[]; a date; b date; cutoff timestamptz; exports jsonb; sources jsonb; gaps jsonb; changes jsonb;
  expenses numeric; purchases numeric; counts numeric; original numeric; loss numeric;
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
    jsonb_agg(jsonb_build_object('id',id,'exportNo',export_no,'createdAt',created_at,
      'originalWeight',original_weight_total,'currentWeight',current_weight,
      'lossPercent',(original_weight_total-current_weight)/original_weight_total*100) order by id)
    into a,b,original,loss,exports from public.rubber_exports where id=any(ids);
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
  foreach k in array array['burden','loss','counts'] loop
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
      when 'loss' then loss/original*100 else counts end;
    if (k='burden' and not burden_complete) or (k='counts' and not count_complete) then actual:=null; end if;
    relative:=null; tier:=null;
    if target is null or target<=0 then
      issues:=issues||jsonb_build_array('กรุณากำหนดเป้าที่ถูกต้องสำหรับ '||case k when 'burden' then 'ภาระดำเนินงาน' when 'loss' then 'น้ำหนักลดลง' else 'จำนวนรายการนับเงิน' end);
    elsif actual is null then
      issues:=issues||jsonb_build_array(case when k='burden' and purchases=0 then 'ยอดซื้อเป็นศูนย์ จึงคำนวณภาระดำเนินงานไม่ได้' else 'ข้อมูลต้นทางไม่ครบ จึงประเมินด้านนี้ไม่ได้' end);
    else
      relative:=case k when 'counts' then (actual-target)/target*100 else (target-actual)/target*100 end;
      tier:=case when relative>=20 then 20 when relative>=5 then 10 when relative<=-20 then -20 when relative<=-5 then -10 else 0 end;
      adjustment:=adjustment+tier*w/100;
    end if;
    metrics:=metrics||jsonb_build_array(jsonb_build_object('key',k,'weight',w,'target',target,'actual',actual,
      'relative',relative,'adjustment',tier));
  end loop;
  if weights<>100 then issues:=issues||jsonb_build_array('สัดส่วนรวมต้องเท่ากับ 100%'); end if;
  if overlap then issues:=issues||jsonb_build_array('ช่วงวันที่ซ้อนกับผลโบนัสที่ยืนยันแล้ว'); end if;
  suggested:=round(base*(1+adjustment/100),2);
  if suggested>9999999999.99 then issues:=issues||jsonb_build_array('ยอดโบนัสเกินขอบเขตที่ระบบรองรับ กรุณาลดอัตราต่อกิโลกรัม'); end if;
  select coalesce(jsonb_agg(to_jsonb(c) order by c.bonus_id,c.source_key),'[]') into changes from private.branch_bonus_changes(p_location) c;
  fp:=md5(jsonb_build_object('sources',sources,'exports',exports,'gaps',gaps,'changes',changes,'input',p_input,
    'start',a,'end',b,'formula','branch-bonus-v2')::text);
  return jsonb_build_object('periodStart',a,'periodEnd',b,'periodDays',b-a+1,'asOf',cutoff,'formulaVersion','branch-bonus-v2',
    'exports',exports,'allSources',sources,'observedChanges',changes,'overlap',overlap,'gaps',gaps,'complete',all_complete,'sourceFingerprint',fp,
    'weight',original,'expenseTotal',expenses,'purchaseTotal',purchases,'countTotal',counts,
    'burdenActual',case when purchases>0 and burden_complete then expenses/purchases*100 end,
    'countActual',case when count_complete then counts end,
    'lossActual',loss/original*100,'metrics',metrics,'rate',rate,'base',base,'adjustment',adjustment,
    'suggestedAmount',suggested,'issues',issues,'canConfirm',jsonb_array_length(issues)=0,
    'scenarios',case when weights=100 and not exists(select 1 from jsonb_array_elements(metrics) m where m->>'adjustment' is null)
      then (select jsonb_agg(jsonb_build_object('rate',r,'base',round(original*r,2),
        'adjustmentAmount',round(original*r*(1+adjustment/100),2)-round(original*r,2),
        'amount',round(original*r*(1+adjustment/100),2)) order by r) from (values (.01::numeric),(.02::numeric),(.03::numeric)) rates(r)) else '[]'::jsonb end);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'BONUS_INVALID: รูปแบบตัวเลขหรือรายการไม่ถูกต้อง';
end $$;

-- Selected counts label the disclosure; total source counts still drive paging.
create or replace function private.branch_bonus_present(p_snapshot jsonb)
returns jsonb language sql immutable set search_path='' as $$
  select (p_snapshot-'allSources'-'observedChanges')||jsonb_build_object(
    'periodDays',(p_snapshot->>'periodEnd')::date-(p_snapshot->>'periodStart')::date+1,
    'changeCount',jsonb_array_length(coalesce(p_snapshot->'observedChanges','[]')),
    'changes',coalesce((select jsonb_agg(v-'observed_source') from (select v from jsonb_array_elements(coalesce(p_snapshot->'observedChanges','[]')) v limit 50) x),'[]'),
    'expenses',coalesce((select jsonb_agg(v order by n) from jsonb_array_elements(p_snapshot->'allSources') with ordinality t(v,n)
      where v->>'kind' not in ('purchase','count') and n in (select n2 from jsonb_array_elements(p_snapshot->'allSources') with ordinality t2(v2,n2) where v2->>'kind' not in ('purchase','count') order by n2 limit 50)),'[]'::jsonb),
    'purchases',coalesce((select jsonb_agg(v) from (select v from jsonb_array_elements(p_snapshot->'allSources') v where v->>'kind'='purchase' limit 50) x),'[]'),
    'counts',coalesce((select jsonb_agg(v) from (select v from jsonb_array_elements(p_snapshot->'allSources') v where v->>'kind'='count' limit 50) x),'[]'),
    'sourceCounts',(select jsonb_build_object('expenses',count(*) filter(where v->>'kind' not in ('purchase','count')),
      'purchases',count(*) filter(where v->>'kind'='purchase'),'counts',count(*) filter(where v->>'kind'='count')) from jsonb_array_elements(p_snapshot->'allSources') v),
    'selectedSourceCounts',(select jsonb_build_object('expenses',count(*) filter(where v->>'kind' not in ('purchase','count') and (v->>'included')::boolean),
      'purchases',count(*) filter(where v->>'kind'='purchase' and (v->>'included')::boolean),
      'counts',count(*) filter(where v->>'kind'='count' and (v->>'included')::boolean)) from jsonb_array_elements(p_snapshot->'allSources') v),
    'expenseGroups',coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'amount',amount,'includedAmount',included))
      from (select v->>'kind' kind,sum((v->>'amount')::numeric) amount,
        sum(case when (v->>'included')::boolean then (v->>'amount')::numeric else 0 end) included
        from jsonb_array_elements(p_snapshot->'allSources') v where v->>'kind' not in ('purchase','count') group by v->>'kind') g),'[]'));
$$;

