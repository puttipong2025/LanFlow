-- Server-authoritative weighted rubber age. Store UTC instants; present in Asia/Bangkok.

alter table public.rubber_export_items
  add column age_source_at timestamptz,
  add column age_is_estimated boolean;

alter table public.rubber_exports
  add column age_cutoff_at timestamptz,
  add column average_age_hours numeric(14,2),
  add column oldest_age_hours numeric(14,2),
  add column estimated_age_item_count integer;

create or replace function private.rubber_export_effective_age_start(
  p_bill_date date,
  p_age_source_at timestamptz,
  p_cutoff_at timestamptz
)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select case
    when (p_age_source_at at time zone 'Asia/Bangkok')::date = p_bill_date
      then p_age_source_at
    else (p_bill_date + (p_cutoff_at at time zone 'Asia/Bangkok')::time)
      at time zone 'Asia/Bangkok'
  end;
$$;

create or replace function private.rubber_export_age_hours(
  p_bill_date date,
  p_age_source_at timestamptz,
  p_cutoff_at timestamptz
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select greatest(
    extract(epoch from (
      p_cutoff_at - private.rubber_export_effective_age_start(
        p_bill_date, p_age_source_at, p_cutoff_at
      )
    )) / 3600,
    0
  )::numeric;
$$;

create or replace function private.rubber_export_age_summary(
  p_export_id uuid,
  p_cutoff_at timestamptz
)
returns table (
  average_age_hours numeric,
  oldest_age_hours numeric,
  estimated_age_item_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(round(
      sum(i.net_weight * private.rubber_export_age_hours(
        i.bill_date, i.age_source_at, p_cutoff_at
      )) / nullif(sum(i.net_weight), 0),
      2
    ), 0),
    coalesce(round(max(private.rubber_export_age_hours(
      i.bill_date, i.age_source_at, p_cutoff_at
    )), 2), 0),
    count(*) filter (where i.age_is_estimated)::integer
  from public.rubber_export_items i
  where i.export_id = p_export_id;
$$;

update public.rubber_export_items i
set age_source_at = coalesce(b.client_created_at, b.created_at),
    age_is_estimated = b.client_created_at is null
      or (coalesce(b.client_created_at, b.created_at) at time zone 'Asia/Bangkok')::date
        <> i.bill_date
from public.rubber_bills b
where b.id = i.source_bill_id;

alter table public.rubber_export_items
  alter column age_source_at set not null,
  alter column age_is_estimated set not null;

alter table public.rubber_exports disable trigger guard_rubber_export_state;

with ages as (
  select e.id, e.verified_at, s.average_age_hours, s.oldest_age_hours,
    s.estimated_age_item_count
  from public.rubber_exports e
  cross join lateral private.rubber_export_age_summary(e.id, e.verified_at) s
  where e.status = 'verified'
     or (e.status = 'deleted' and e.previous_status = 'verified')
)
update public.rubber_exports e
set age_cutoff_at = ages.verified_at,
    average_age_hours = ages.average_age_hours,
    oldest_age_hours = ages.oldest_age_hours,
    estimated_age_item_count = ages.estimated_age_item_count
from ages
where ages.id = e.id;

set constraints all immediate;

alter table public.rubber_exports enable trigger guard_rubber_export_state;

alter table public.rubber_exports
  add constraint rubber_exports_age_snapshot_check check (
    (
      (status = 'verified' or (status = 'deleted' and previous_status = 'verified'))
      and age_cutoff_at is not null
      and average_age_hours is not null
      and oldest_age_hours is not null
      and estimated_age_item_count is not null
    )
    or
    (
      (status = 'draft' or (status = 'deleted' and previous_status = 'draft'))
      and age_cutoff_at is null
      and average_age_hours is null
      and oldest_age_hours is null
      and estimated_age_item_count is null
    )
  ),
  add constraint rubber_exports_age_values_check check (
    (average_age_hours is null or average_age_hours >= 0)
    and (oldest_age_hours is null or oldest_age_hours >= 0)
    and (estimated_age_item_count is null or estimated_age_item_count >= 0)
  );

create or replace function private.validate_rubber_export_selection(
  p_location_id uuid,
  p_selected_report_item_ids uuid[]
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_selected_count integer;
  v_candidate_count integer;
  v_invalid text;
begin
  v_selected_count := coalesce(cardinality(p_selected_report_item_ids), 0);
  if v_selected_count = 0 then
    raise exception 'RUBBER_EXPORT_SELECTION_EMPTY: กรุณาเลือกบิลอย่างน้อย 1 ใบ' using errcode = 'P0001';
  end if;
  if (select count(distinct selected_id) from unnest(p_selected_report_item_ids) selected_id)
    <> v_selected_count then
    raise exception 'RUBBER_EXPORT_SELECTION_DUPLICATE: พบบิลที่เลือกซ้ำ' using errcode = 'P0001';
  end if;

  select count(*)::integer into v_candidate_count
  from private.rubber_export_candidates(p_location_id, p_selected_report_item_ids);
  if v_candidate_count <> v_selected_count then
    raise exception 'RUBBER_EXPORT_SELECTION_STALE: บิลที่เลือกบางรายการไม่พร้อมส่งออกแล้ว'
      using errcode = 'P0001', hint = 'รีเฟรชรายการบิลแล้วเลือกใหม่';
  end if;

  select string_agg(c.bill_no, ', ' order by c.eligibility_at, c.bill_id) into v_invalid
  from private.rubber_export_candidates(p_location_id, p_selected_report_item_ids) c
  where c.net_weight <= 0 or c.paid_amount <= 0;
  if v_invalid is not null then
    raise exception 'INVALID_RUBBER_BILL:%', v_invalid
      using errcode = 'P0001', hint = 'น้ำหนักสุทธิหลังหักและยอดจ่ายจริงต้องมากกว่า 0';
  end if;

  select string_agg(c.bill_no, ', ' order by c.eligibility_at, c.bill_id) into v_invalid
  from private.rubber_export_candidates(p_location_id, p_selected_report_item_ids) c
  where c.bill_date > (clock_timestamp() at time zone 'Asia/Bangkok')::date;
  if v_invalid is not null then
    raise exception 'RUBBER_EXPORT_FUTURE_BILL:%', v_invalid
      using errcode = 'P0001', hint = 'วันที่บิลต้องไม่เกินวันที่ปัจจุบันตามประเทศไทย';
  end if;
end;
$$;

create or replace function public.get_rubber_export_available_bills(p_location_id uuid)
returns table (
  report_item_id uuid, bill_id uuid, bill_date date, bill_no text,
  customer_name text, eligibility_at timestamptz, net_weight numeric, paid_amount numeric
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_location_id is null or not private.can_manage_reports(p_location_id) then
    raise exception 'ไม่มีสิทธิ์ดูบิลส่งออกของสาขานี้';
  end if;
  return query
  select c.report_item_id, c.bill_id, c.bill_date, c.bill_no, c.customer_name,
    c.eligibility_at, c.net_weight, c.paid_amount
  from private.rubber_export_candidates(p_location_id, null) c
  where c.bill_date <= (clock_timestamp() at time zone 'Asia/Bangkok')::date;
end;
$$;

create or replace function public.preview_rubber_export(
  p_location_id uuid,
  p_selected_report_item_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
begin
  if p_location_id is null or not private.can_manage_reports(p_location_id) then
    raise exception 'ไม่มีสิทธิ์สร้างรายการส่งออกของสาขานี้';
  end if;
  perform private.validate_rubber_export_selection(p_location_id, p_selected_report_item_ids);

  with candidates as (
    select c.*, coalesce(b.client_created_at, b.created_at) age_source_at,
      b.client_created_at is null
        or (coalesce(b.client_created_at, b.created_at) at time zone 'Asia/Bangkok')::date <> c.bill_date
        as age_is_estimated
    from private.rubber_export_candidates(p_location_id, p_selected_report_item_ids) c
    join public.rubber_bills b on b.id = c.bill_id
  ), aged as (
    select c.*, private.rubber_export_age_hours(c.bill_date, c.age_source_at, v_now) age_hours
    from candidates c
  )
  select jsonb_build_object(
    'itemCount', count(*)::integer,
    'originalWeightTotal', round(sum(net_weight), 2),
    'paidTotal', round(sum(paid_amount), 2),
    'averagePrice', round(sum(paid_amount) / sum(net_weight), 2),
    'calculatedAt', v_now,
    'averageAgeHours', round(sum(net_weight * age_hours) / sum(net_weight), 2),
    'oldestAgeHours', round(max(age_hours), 2),
    'estimatedAgeItemCount', count(*) filter (where age_is_estimated)::integer,
    'items', jsonb_agg(jsonb_build_object(
      'reportItemId', report_item_id, 'billId', bill_id, 'billDate', bill_date,
      'billNo', bill_no, 'customerName', customer_name, 'eligibilityAt', eligibility_at,
      'netWeight', net_weight, 'paidAmount', paid_amount,
      'ageHours', round(age_hours, 2), 'ageIsEstimated', age_is_estimated
    ) order by eligibility_at, bill_id)
  ) into v_result
  from aged;

  if coalesce((v_result->>'itemCount')::integer, 0) = 0 then
    raise exception 'ไม่มีบิลที่พร้อมสร้างรายการส่งออก';
  end if;
  return v_result;
end;
$$;

create or replace function public.create_rubber_export(
  p_location_id uuid,
  p_selected_report_item_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_name text;
  v_actor_phone text;
  v_now timestamptz := clock_timestamp();
  v_export_date date;
  v_sequence_no integer;
  v_export_no text;
  v_export_id uuid;
  v_item_count integer;
  v_original_weight numeric;
  v_paid_total numeric;
begin
  if p_location_id is null or not private.can_manage_reports(p_location_id) then
    raise exception 'ไม่มีสิทธิ์สร้างรายการส่งออกของสาขานี้';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rubber-export:' || p_location_id::text, 0));
  perform private.validate_rubber_export_selection(p_location_id, p_selected_report_item_ids);

  select count(*)::integer, round(sum(c.net_weight), 2), round(sum(c.paid_amount), 2)
  into v_item_count, v_original_weight, v_paid_total
  from private.rubber_export_candidates(p_location_id, p_selected_report_item_ids) c;
  if coalesce(v_item_count, 0) = 0 then raise exception 'ไม่มีบิลที่พร้อมสร้างรายการส่งออก'; end if;

  select p.name, p.phone into v_actor_name, v_actor_phone
  from public.profiles p where p.id = v_actor_id;
  v_export_date := (v_now at time zone 'Asia/Bangkok')::date;
  select coalesce(max(e.sequence_no), 0) + 1 into v_sequence_no
  from public.rubber_exports e
  where e.location_id = p_location_id and e.export_date = v_export_date;
  v_export_no := 'REX-' || to_char(v_export_date, 'YYYYMMDD') || '-' || lpad(v_sequence_no::text, 3, '0');

  insert into public.rubber_exports (
    export_no, export_date, sequence_no, location_id, original_weight_total,
    paid_total, average_price, created_by_user_id, created_by_name,
    created_by_phone, created_at
  ) values (
    v_export_no, v_export_date, v_sequence_no, p_location_id, v_original_weight,
    v_paid_total, round(v_paid_total / v_original_weight, 2), v_actor_id,
    coalesce(v_actor_name, ''), coalesce(v_actor_phone, ''), v_now
  ) returning id into v_export_id;

  insert into public.rubber_export_items (
    export_id, location_id, source_report_item_id, source_bill_id, bill_date,
    bill_no, customer_name, eligibility_at, net_weight, paid_amount,
    age_source_at, age_is_estimated
  )
  select v_export_id, p_location_id, c.report_item_id, c.bill_id, c.bill_date,
    c.bill_no, c.customer_name, c.eligibility_at, c.net_weight, c.paid_amount,
    coalesce(b.client_created_at, b.created_at),
    b.client_created_at is null
      or (coalesce(b.client_created_at, b.created_at) at time zone 'Asia/Bangkok')::date <> c.bill_date
  from private.rubber_export_candidates(p_location_id, p_selected_report_item_ids) c
  join public.rubber_bills b on b.id = c.bill_id;
  get diagnostics v_item_count = row_count;
  return jsonb_build_object('id', v_export_id, 'exportNo', v_export_no, 'itemCount', v_item_count);
end;
$$;

create or replace function public.get_rubber_export_age_summaries(p_location_id uuid)
returns table (
  export_id uuid, calculated_at timestamptz, average_age_hours numeric,
  oldest_age_hours numeric, estimated_age_item_count integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare v_now timestamptz := clock_timestamp();
begin
  if p_location_id is null or not private.can_manage_reports(p_location_id) then
    raise exception 'ไม่มีสิทธิ์ดูอายุยางของสาขานี้';
  end if;
  return query
  select e.id,
    case when e.status = 'draft' then v_now else e.age_cutoff_at end,
    case when e.status = 'draft' then s.average_age_hours else e.average_age_hours end,
    case when e.status = 'draft' then s.oldest_age_hours else e.oldest_age_hours end,
    case when e.status = 'draft' then s.estimated_age_item_count else e.estimated_age_item_count end
  from public.rubber_exports e
  left join lateral private.rubber_export_age_summary(e.id, v_now) s on e.status = 'draft'
  where e.location_id = p_location_id;
end;
$$;

create or replace function public.get_rubber_export_age_detail(p_export_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_export public.rubber_exports%rowtype;
  v_cutoff timestamptz;
  v_summary record;
  v_items jsonb;
begin
  select * into v_export from public.rubber_exports where id = p_export_id;
  if v_export.id is null or not private.can_manage_reports(v_export.location_id) then
    raise exception 'ไม่มีสิทธิ์ดูอายุยางของรายการนี้';
  end if;
  v_cutoff := case
    when v_export.status = 'draft' then clock_timestamp()
    when v_export.status = 'verified' or v_export.previous_status = 'verified' then v_export.age_cutoff_at
    else null
  end;

  if v_cutoff is not null then
    select * into v_summary from private.rubber_export_age_summary(p_export_id, v_cutoff);
  end if;
  select jsonb_agg(jsonb_build_object(
    'itemId', i.id,
    'ageHours', case when v_cutoff is null then null else round(private.rubber_export_age_hours(
      i.bill_date, i.age_source_at, v_cutoff
    ), 2) end,
    'ageIsEstimated', i.age_is_estimated
  ) order by i.eligibility_at, i.source_bill_id)
  into v_items from public.rubber_export_items i where i.export_id = p_export_id;

  return jsonb_build_object(
    'calculatedAt', v_cutoff,
    'averageAgeHours', case when v_cutoff is null then null else v_summary.average_age_hours end,
    'oldestAgeHours', case when v_cutoff is null then null else v_summary.oldest_age_hours end,
    'estimatedAgeItemCount', case when v_cutoff is null then null else v_summary.estimated_age_item_count end,
    'items', coalesce(v_items, '[]'::jsonb)
  );
end;
$$;

create or replace function public.verify_rubber_export_atomic(
  p_export_id uuid, p_current_weight numeric, p_work_rate numeric,
  p_other_operating_cost numeric, p_expense_destination text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_export public.rubber_exports%rowtype;
  v_actor_name text;
  v_actor_phone text;
  v_now timestamptz := clock_timestamp();
  v_age record;
begin
  if not private.can_delete_reports() then raise exception 'เฉพาะ super_admin หรือผู้มีสิทธิ์จัดการระบบเท่านั้นที่ตรวจสอบได้'; end if;
  if p_expense_destination not in ('branch', 'external') then raise exception 'กรุณาเลือกปลายทางค่าใช้จ่าย'; end if;
  select * into v_export from public.rubber_exports where id = p_export_id for update;
  if v_export.id is null then raise exception 'ไม่พบรายการส่งออก'; end if;
  if v_export.status = 'verified' then
    if v_export.current_weight is not distinct from p_current_weight
      and v_export.work_rate is not distinct from p_work_rate
      and v_export.other_operating_cost is not distinct from p_other_operating_cost
      and v_export.expense_destination = p_expense_destination then
      return jsonb_build_object('id', p_export_id, 'status', 'verified', 'verifiedAt', v_export.verified_at);
    end if;
    raise exception 'รายการนี้ตรวจสอบแล้วด้วยข้อมูลอื่น';
  end if;
  if v_export.status <> 'draft' then raise exception 'ตรวจสอบได้เฉพาะรายการฉบับร่าง'; end if;
  if p_current_weight is null or p_current_weight <= 0 or p_current_weight > v_export.original_weight_total then
    raise exception 'น้ำหนักปัจจุบันต้องมากกว่า 0 และไม่เกินน้ำหนักเดิม';
  end if;
  if p_work_rate is null or p_work_rate < 0 then raise exception 'ค่าทำงานต้องไม่น้อยกว่า 0'; end if;
  if p_other_operating_cost is null or p_other_operating_cost < 0 then raise exception 'ค่าใช้จ่ายอื่นต้องไม่น้อยกว่า 0'; end if;

  select p.name, p.phone into v_actor_name, v_actor_phone from public.profiles p where p.id = auth.uid();
  select * into v_age from private.rubber_export_age_summary(p_export_id, v_now);
  update public.rubber_exports
  set current_weight = p_current_weight,
      work_rate = p_work_rate,
      other_operating_cost = p_other_operating_cost,
      weight_loss_percent = round((original_weight_total - p_current_weight) / original_weight_total * 100, 2),
      work_total = round(original_weight_total * p_work_rate + p_other_operating_cost, 2),
      expense_destination = p_expense_destination,
      status = 'verified',
      verified_by_user_id = auth.uid(),
      verified_by_name = coalesce(v_actor_name, ''),
      verified_by_phone = coalesce(v_actor_phone, ''),
      verified_at = v_now,
      age_cutoff_at = v_now,
      average_age_hours = v_age.average_age_hours,
      oldest_age_hours = v_age.oldest_age_hours,
      estimated_age_item_count = v_age.estimated_age_item_count
  where id = p_export_id;
  return jsonb_build_object('id', p_export_id, 'status', 'verified', 'verifiedAt', v_now);
end;
$$;

create or replace function private.guard_rubber_export_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'deleted' then raise exception 'รายการส่งออกที่ลบแล้วแก้ไขไม่ได้'; end if;
  if old.status = 'verified' and new.status <> 'deleted' then raise exception 'รายการส่งออกที่ตรวจสอบแล้วแก้ไขไม่ได้'; end if;
  if (
    new.export_no, new.export_date, new.sequence_no, new.location_id,
    new.original_weight_total, new.paid_total, new.average_price,
    new.created_by_user_id, new.created_at
  ) is distinct from (
    old.export_no, old.export_date, old.sequence_no, old.location_id,
    old.original_weight_total, old.paid_total, old.average_price,
    old.created_by_user_id, old.created_at
  ) then raise exception 'ข้อมูลสมาชิกและ snapshot ของรายการส่งออกแก้ไขไม่ได้'; end if;
  if old.status <> 'draft' and (
    new.age_cutoff_at, new.average_age_hours, new.oldest_age_hours, new.estimated_age_item_count
  ) is distinct from (
    old.age_cutoff_at, old.average_age_hours, old.oldest_age_hours, old.estimated_age_item_count
  ) then raise exception 'snapshot อายุยางหลังตรวจสอบแก้ไขไม่ได้'; end if;
  if old.status = 'draft' and new.status <> 'verified' and (
    new.age_cutoff_at is not null or new.average_age_hours is not null
    or new.oldest_age_hours is not null or new.estimated_age_item_count is not null
  ) then raise exception 'ฉบับร่างไม่มี snapshot อายุยางอย่างเป็นทางการ'; end if;
  return new;
end;
$$;

revoke all on function public.get_rubber_export_age_summaries(uuid) from public, anon;
revoke all on function public.get_rubber_export_age_detail(uuid) from public, anon;
grant execute on function public.get_rubber_export_age_summaries(uuid) to authenticated;
grant execute on function public.get_rubber_export_age_detail(uuid) to authenticated;

revoke all on function public.preview_rubber_export(uuid, uuid[]) from public, anon;
revoke all on function public.create_rubber_export(uuid, uuid[]) from public, anon;
revoke all on function public.get_rubber_export_available_bills(uuid) from public, anon;
revoke all on function public.verify_rubber_export_atomic(uuid, numeric, numeric, numeric, text) from public, anon;
grant execute on function public.preview_rubber_export(uuid, uuid[]) to authenticated;
grant execute on function public.create_rubber_export(uuid, uuid[]) to authenticated;
grant execute on function public.get_rubber_export_available_bills(uuid) to authenticated;
grant execute on function public.verify_rubber_export_atomic(uuid, numeric, numeric, numeric, text) to authenticated;

notify pgrst, 'reload schema';
