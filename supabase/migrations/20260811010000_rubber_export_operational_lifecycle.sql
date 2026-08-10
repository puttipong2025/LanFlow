alter table public.rubber_exports
  add column sold_out_at timestamptz,
  add column sold_out_by_user_id uuid references public.profiles(id),
  add column sold_out_by_name text;

alter table public.rubber_exports
  add constraint rubber_exports_sold_out_snapshot_check check (
    (sold_out_at is null and sold_out_by_user_id is null and sold_out_by_name is null)
    or (
      status = 'verified'
      and sold_out_at is not null
      and sold_out_by_user_id is not null
      and nullif(btrim(sold_out_by_name), '') is not null
    )
  );

create or replace function private.rubber_export_raw_age_summary(
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
    coalesce(sum(i.net_weight * private.rubber_export_item_age_hours(
      i.bill_date, i.age_source_at, i.carried_age_hours, p_cutoff_at
    )) / nullif(sum(i.net_weight), 0), 0),
    coalesce(max(private.rubber_export_item_age_hours(
      i.bill_date, i.age_source_at, i.carried_age_hours, p_cutoff_at
    )), 0),
    count(*) filter (where i.age_is_estimated)::integer
  from public.rubber_export_items i
  where i.export_id = p_export_id;
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
    round(s.average_age_hours, 2),
    round(s.oldest_age_hours, 2),
    s.estimated_age_item_count
  from private.rubber_export_raw_age_summary(p_export_id, p_cutoff_at) s;
$$;

create or replace function private.rubber_export_candidates(
  p_location_id uuid,
  p_selected_report_item_ids uuid[],
  p_current_export_id uuid
)
returns table (
  report_item_id uuid, bill_id uuid, bill_date date, bill_no text,
  customer_name text, eligibility_at timestamptz, net_weight numeric,
  paid_amount numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.id,
    b.id,
    b.bill_date,
    coalesce(b.server_bill_no, nullif(b.local_bill_no, ''), nullif(b.bill_no, ''), left(b.id::text, 8)),
    coalesce(b.customer_name, ''),
    i.eligibility_at,
    b.net_weight,
    round(case when b.source_rubber_export_id is not null then b.rubber_value else b.net_total end, 2)
  from public.report_items i
  join public.report_batches r on r.id = i.report_id
  join public.rubber_bills b on b.id = i.entity_id
  where i.location_id = p_location_id
    and i.entity_type = 'rubber_bill'
    and i.active = true
    and (p_selected_report_item_ids is null or i.id = any(p_selected_report_item_ids))
    and r.status = 'active'
    and b.location_id = p_location_id
    and b.record_status = 'active'
    and not exists (
      select 1
      from public.rubber_export_items x
      where x.location_id = p_location_id
        and x.source_bill_id = b.id
        and x.active = true
        and (p_current_export_id is null or x.export_id <> p_current_export_id)
    )
  order by i.eligibility_at, b.id;
$$;

create or replace function private.rubber_export_candidates(
  p_location_id uuid,
  p_selected_report_item_ids uuid[]
)
returns table (
  report_item_id uuid, bill_id uuid, bill_date date, bill_no text,
  customer_name text, eligibility_at timestamptz, net_weight numeric,
  paid_amount numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  select *
  from private.rubber_export_candidates(
    p_location_id, p_selected_report_item_ids, null::uuid
  );
$$;

create or replace function private.validate_rubber_export_selection(
  p_location_id uuid,
  p_selected_report_item_ids uuid[],
  p_current_export_id uuid
)
returns void
language plpgsql
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
    raise exception 'RUBBER_EXPORT_SELECTION_EMPTY: กรุณาเลือกบิลอย่างน้อย 1 ใบ'
      using errcode = 'P0001';
  end if;
  if (select count(distinct selected_id) from unnest(p_selected_report_item_ids) selected_id)
    <> v_selected_count then
    raise exception 'RUBBER_EXPORT_SELECTION_DUPLICATE: พบบิลที่เลือกซ้ำ'
      using errcode = 'P0001';
  end if;

  select count(*)::integer into v_candidate_count
  from private.rubber_export_candidates(
    p_location_id, p_selected_report_item_ids, p_current_export_id
  );
  if v_candidate_count <> v_selected_count then
    raise exception 'RUBBER_EXPORT_SELECTION_STALE: บิลที่เลือกบางรายการไม่พร้อมส่งออกแล้ว'
      using errcode = 'P0001', hint = 'รีเฟรชรายการบิลแล้วเลือกใหม่';
  end if;

  select string_agg(c.bill_no, ', ' order by c.eligibility_at, c.bill_id)
  into v_invalid
  from private.rubber_export_candidates(
    p_location_id, p_selected_report_item_ids, p_current_export_id
  ) c
  where c.net_weight <= 0 or c.paid_amount <= 0;
  if v_invalid is not null then
    raise exception 'INVALID_RUBBER_BILL:%', v_invalid
      using errcode = 'P0001', hint = 'น้ำหนักสุทธิหลังหักและยอดจ่ายจริงต้องมากกว่า 0';
  end if;

  select string_agg(c.bill_no, ', ' order by c.eligibility_at, c.bill_id)
  into v_invalid
  from private.rubber_export_candidates(
    p_location_id, p_selected_report_item_ids, p_current_export_id
  ) c
  where c.bill_date > (clock_timestamp() at time zone 'Asia/Bangkok')::date;
  if v_invalid is not null then
    raise exception 'RUBBER_EXPORT_FUTURE_BILL:%', v_invalid
      using errcode = 'P0001', hint = 'วันที่บิลต้องไม่เกินวันที่ปัจจุบันตามประเทศไทย';
  end if;
end;
$$;

create or replace function private.validate_rubber_export_selection(
  p_location_id uuid,
  p_selected_report_item_ids uuid[]
)
returns void
language sql
security definer
set search_path = ''
as $$
  select private.validate_rubber_export_selection(
    p_location_id, p_selected_report_item_ids, null::uuid
  );
$$;

create or replace function public.preview_rubber_export(
  p_location_id uuid,
  p_selected_report_item_ids uuid[],
  p_current_export_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
  v_current public.rubber_exports%rowtype;
begin
  if p_location_id is null or not private.can_manage_reports(p_location_id) then
    raise exception 'ไม่มีสิทธิ์สร้างรายการส่งออกของสาขานี้';
  end if;
  if p_current_export_id is not null then
    select * into v_current
    from public.rubber_exports e
    where e.id = p_current_export_id;
    if v_current.id is null or v_current.location_id <> p_location_id then
      raise exception 'ไม่พบรายการส่งออกฉบับร่าง';
    end if;
    if v_current.status <> 'draft' then
      raise exception 'แก้ไขสมาชิกได้เฉพาะรายการฉบับร่าง';
    end if;
  end if;

  perform private.validate_rubber_export_selection(
    p_location_id, p_selected_report_item_ids, p_current_export_id
  );

  with candidates as (
    select c.*,
      case when b.source_rubber_export_id is not null then b.received_at
        else coalesce(b.client_created_at, b.created_at) end as age_source_at,
      case when b.source_rubber_export_id is not null then b.received_age_hours
        else null end as carried_age_hours,
      case when b.source_rubber_export_id is not null then b.received_age_is_estimated
        else b.client_created_at is null
          or (coalesce(b.client_created_at, b.created_at) at time zone 'Asia/Bangkok')::date <> c.bill_date
        end as age_is_estimated
    from private.rubber_export_candidates(
      p_location_id, p_selected_report_item_ids, p_current_export_id
    ) c
    join public.rubber_bills b on b.id = c.bill_id
  ), aged as (
    select c.*, private.rubber_export_item_age_hours(
      c.bill_date, c.age_source_at, c.carried_age_hours, v_now
    ) age_hours
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
  ) into v_result from aged;
  if coalesce((v_result->>'itemCount')::integer, 0) = 0 then
    raise exception 'ไม่มีบิลที่พร้อมสร้างรายการส่งออก';
  end if;
  return v_result;
end;
$$;

create or replace function public.preview_rubber_export(
  p_location_id uuid,
  p_selected_report_item_ids uuid[]
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.preview_rubber_export(
    p_location_id, p_selected_report_item_ids, null::uuid
  );
$$;

create or replace function private.guard_rubber_export_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status = 'deleted' then
    raise exception 'รายการส่งออกที่ลบแล้วแก้ไขไม่ได้';
  end if;
  if old.status = 'verified' and new.status <> 'deleted'
     and (to_jsonb(new) - array['sold_out_at', 'sold_out_by_user_id', 'sold_out_by_name'])
       is distinct from
       (to_jsonb(old) - array['sold_out_at', 'sold_out_by_user_id', 'sold_out_by_name']) then
    raise exception 'รายการส่งออกที่ตรวจสอบแล้วแก้ไขไม่ได้';
  end if;
  if (
    new.export_no, new.export_date, new.sequence_no, new.location_id,
    new.created_by_user_id, new.created_at
  ) is distinct from (
    old.export_no, old.export_date, old.sequence_no, old.location_id,
    old.created_by_user_id, old.created_at
  ) then
    raise exception 'ข้อมูลระบุตัวตนของรายการส่งออกแก้ไขไม่ได้';
  end if;
  if (old.status <> 'draft' or new.status <> 'draft') and (
    new.original_weight_total, new.paid_total, new.average_price
  ) is distinct from (
    old.original_weight_total, old.paid_total, old.average_price
  ) then
    raise exception 'snapshot สมาชิกของรายการส่งออกแก้ไขไม่ได้';
  end if;
  if old.status <> 'draft' and (
    new.age_cutoff_at, new.average_age_hours, new.oldest_age_hours,
    new.estimated_age_item_count
  ) is distinct from (
    old.age_cutoff_at, old.average_age_hours, old.oldest_age_hours,
    old.estimated_age_item_count
  ) then
    raise exception 'snapshot อายุยางหลังตรวจสอบแก้ไขไม่ได้';
  end if;
  if old.status = 'draft' and new.status <> 'verified' and (
    new.age_cutoff_at is not null or new.average_age_hours is not null
    or new.oldest_age_hours is not null or new.estimated_age_item_count is not null
  ) then
    raise exception 'ฉบับร่างไม่มี snapshot อายุยางอย่างเป็นทางการ';
  end if;
  return new;
end;
$$;

create or replace function private.guard_reported_entity()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'private'
as $$
declare
  v_id uuid;
  v_report_no text;
begin
  if tg_table_name = 'rubber_exports' and tg_op = 'UPDATE'
     and (to_jsonb(new) - array['sold_out_at', 'sold_out_by_user_id', 'sold_out_by_name'])
       = (to_jsonb(old) - array['sold_out_at', 'sold_out_by_user_id', 'sold_out_by_name']) then
    return new;
  end if;
  v_id := case when tg_op = 'DELETE' then old.id else new.id end;
  v_report_no := private.active_report_no(tg_argv[0], v_id);
  if v_report_no is not null then
    perform private.raise_report_lock(v_report_no);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.replace_rubber_export_items(
  p_export_id uuid,
  p_selected_report_item_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_export public.rubber_exports%rowtype;
  v_item_count integer;
  v_original_weight numeric;
  v_paid_total numeric;
begin
  select * into v_export
  from public.rubber_exports e
  where e.id = p_export_id
  for update;
  if v_export.id is null or not private.can_manage_reports(v_export.location_id) then
    raise exception 'ไม่มีสิทธิ์แก้ไขรายการส่งออกนี้';
  end if;
  if v_export.status <> 'draft' then
    raise exception 'แก้ไขสมาชิกได้เฉพาะรายการฉบับร่าง';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('rubber-export:' || v_export.location_id::text, 0)
  );
  perform private.validate_rubber_export_selection(
    v_export.location_id, p_selected_report_item_ids, v_export.id
  );

  delete from public.rubber_export_items i
  where i.export_id = v_export.id;

  insert into public.rubber_export_items (
    export_id, location_id, source_report_item_id, source_bill_id, bill_date,
    bill_no, customer_name, eligibility_at, net_weight, paid_amount,
    age_source_at, age_is_estimated, carried_age_hours
  )
  select
    v_export.id, v_export.location_id, c.report_item_id, c.bill_id, c.bill_date,
    c.bill_no, c.customer_name, c.eligibility_at, c.net_weight, c.paid_amount,
    case when b.source_rubber_export_id is not null then b.received_at
      else coalesce(b.client_created_at, b.created_at) end,
    case when b.source_rubber_export_id is not null then b.received_age_is_estimated
      else b.client_created_at is null
        or (coalesce(b.client_created_at, b.created_at) at time zone 'Asia/Bangkok')::date <> c.bill_date
      end,
    case when b.source_rubber_export_id is not null then b.received_age_hours else null end
  from private.rubber_export_candidates(
    v_export.location_id, p_selected_report_item_ids, v_export.id
  ) c
  join public.rubber_bills b on b.id = c.bill_id;

  select count(*)::integer, round(sum(i.net_weight), 2), round(sum(i.paid_amount), 2)
  into v_item_count, v_original_weight, v_paid_total
  from public.rubber_export_items i
  where i.export_id = v_export.id;

  update public.rubber_exports
  set original_weight_total = v_original_weight,
      paid_total = v_paid_total,
      average_price = round(v_paid_total / v_original_weight, 2),
      current_weight = null,
      weight_loss_percent = null,
      work_rate = null,
      other_operating_cost = 0,
      work_total = null
  where id = v_export.id;

  return jsonb_build_object(
    'id', v_export.id,
    'status', 'draft',
    'itemCount', v_item_count,
    'originalWeightTotal', v_original_weight,
    'paidTotal', v_paid_total
  );
end;
$$;

create or replace function public.set_rubber_export_sold_out(
  p_export_id uuid,
  p_sold_out boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_export public.rubber_exports%rowtype;
  v_actor_name text;
  v_now timestamptz := clock_timestamp();
begin
  if p_sold_out is null then
    raise exception 'กรุณาระบุสถานะขายยางออก';
  end if;
  select * into v_export
  from public.rubber_exports e
  where e.id = p_export_id
  for update;
  if v_export.id is null or not private.can_manage_reports(v_export.location_id) then
    raise exception 'ไม่มีสิทธิ์จัดการการขายรายการส่งออกนี้';
  end if;
  if v_export.status <> 'verified' then
    raise exception 'ขายยางออกได้เฉพาะรายการตรวจสอบแล้ว';
  end if;

  if p_sold_out then
    if exists (
      select 1 from public.rubber_bills b
      where b.source_rubber_export_id = v_export.id
        and b.record_status = 'active'
    ) then
      raise exception 'BRANCH_RECEIPT_SOURCE_LOCKED:%', v_export.export_no
        using errcode = 'P0001';
    end if;
    if v_export.sold_out_at is null then
      select p.name into v_actor_name
      from public.profiles p
      where p.id = auth.uid() and p.is_active = true;
      if v_actor_name is null then raise exception 'บัญชีผู้ใช้ไม่พร้อมใช้งาน'; end if;
      update public.rubber_exports
      set sold_out_at = v_now,
          sold_out_by_user_id = auth.uid(),
          sold_out_by_name = v_actor_name
      where id = v_export.id;
    else
      v_now := v_export.sold_out_at;
      v_actor_name := v_export.sold_out_by_name;
    end if;
  else
    update public.rubber_exports
    set sold_out_at = null,
        sold_out_by_user_id = null,
        sold_out_by_name = null
    where id = v_export.id;
    v_now := null;
    v_actor_name := null;
  end if;

  return jsonb_build_object(
    'id', v_export.id,
    'status', case when p_sold_out then 'sold_out' else 'verified' end,
    'soldOutAt', v_now,
    'soldOutByName', v_actor_name
  );
end;
$$;

create or replace function public.get_receivable_rubber_exports(
  p_destination_location_id uuid
)
returns table (
  source_rubber_export_id uuid,
  source_export_no text,
  source_location_id uuid,
  source_location_name text,
  verified_at timestamptz,
  current_weight numeric,
  rubber_value numeric,
  source_average_age_hours numeric,
  received_age_hours numeric,
  age_is_estimated boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  if p_destination_location_id is null
     or not public.can_access_location(p_destination_location_id)
     or not exists (
       select 1 from public.locations l
       where l.id = p_destination_location_id and l.is_active = true
     ) then
    raise exception 'ไม่มีสิทธิ์รับยางเข้าสาขานี้';
  end if;

  return query
  select
    e.id,
    e.export_no,
    e.location_id,
    l.name,
    e.verified_at,
    e.current_weight,
    e.paid_total,
    round(age.average_age_hours, 2),
    round(age.average_age_hours, 6),
    age.estimated_age_item_count > 0
  from public.rubber_exports e
  join public.locations l on l.id = e.location_id and l.is_active = true
  cross join lateral private.rubber_export_raw_age_summary(e.id, v_now) age
  where e.status = 'verified'
    and e.sold_out_at is null
    and e.verified_at is not null
    and e.current_weight > 0
    and e.paid_total > 0
    and exists (select 1 from public.rubber_export_items i where i.export_id = e.id)
    and not exists (
      select 1 from public.rubber_bills b
      where b.source_rubber_export_id = e.id
        and b.record_status = 'active'
    )
  order by (e.location_id = p_destination_location_id) desc,
    e.verified_at desc, e.export_no, e.id;
end;
$$;

create or replace function public.receive_rubber_export(
  p_destination_location_id uuid,
  p_source_rubber_export_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.rubber_exports%rowtype;
  v_source_location_name text;
  v_actor_name text;
  v_actor_phone text;
  v_now timestamptz := clock_timestamp();
  v_bill_date date;
  v_date_key text;
  v_next_seq integer;
  v_bill_no text;
  v_bill_id uuid;
  v_client_temp_id text;
  v_customer_name text;
  v_debt_description text;
  v_age record;
  v_age_hours numeric;
  v_average_price numeric;
begin
  if p_destination_location_id is null
     or p_source_rubber_export_id is null
     or not public.can_access_location(p_destination_location_id)
     or not exists (
       select 1 from public.locations l
       where l.id = p_destination_location_id and l.is_active = true
     ) then
    raise exception 'ไม่มีสิทธิ์รับยางเข้าสาขานี้';
  end if;

  select * into v_source
  from public.rubber_exports e
  where e.id = p_source_rubber_export_id
  for update;
  if v_source.id is null then raise exception 'BRANCH_RECEIPT_SOURCE_NOT_FOUND'; end if;
  if exists (
    select 1 from public.rubber_bills b
    where b.source_rubber_export_id = v_source.id
      and b.record_status = 'active'
  ) then
    raise exception 'BRANCH_RECEIPT_ALREADY_EXISTS:%', v_source.export_no using errcode = 'P0001';
  end if;
  if v_source.status <> 'verified'
     or v_source.sold_out_at is not null
     or v_source.verified_at is null
     or v_source.current_weight is null
     or v_source.current_weight <= 0
     or v_source.paid_total <= 0
     or not exists (select 1 from public.rubber_export_items i where i.export_id = v_source.id)
     or not exists (
       select 1 from public.locations l
       where l.id = v_source.location_id and l.is_active = true
     ) then
    raise exception 'BRANCH_RECEIPT_SOURCE_STALE:%', v_source.export_no
      using errcode = 'P0001', hint = 'รีเฟรชรายการแล้วเลือกใหม่';
  end if;

  select l.name into v_source_location_name
  from public.locations l where l.id = v_source.location_id;
  select p.name, p.phone into v_actor_name, v_actor_phone
  from public.profiles p where p.id = auth.uid() and p.is_active = true;
  if v_actor_name is null then raise exception 'บัญชีผู้ใช้ไม่พร้อมใช้งาน'; end if;

  select * into v_age
  from private.rubber_export_raw_age_summary(v_source.id, v_now);
  v_age_hours := round(v_age.average_age_hours, 6);
  v_bill_date := (v_now at time zone 'Asia/Bangkok')::date;
  v_date_key := to_char(v_bill_date, 'YYMMDD');
  perform pg_advisory_xact_lock(hashtext(p_destination_location_id::text || v_date_key));
  select count(*) + 1 into v_next_seq
  from public.rubber_bills b
  where b.location_id = p_destination_location_id
    and to_char(b.bill_date, 'YYMMDD') = v_date_key
    and b.server_bill_no is not null;

  v_bill_no := v_date_key || lpad(v_next_seq::text, 4, '0');
  v_client_temp_id := 'branch-receipt:' || v_source.id::text || ':' || gen_random_uuid()::text;
  if v_source.location_id = p_destination_location_id then
    v_customer_name := 'ยางคงเหลือภายในสาขา';
    v_debt_description := 'หักมูลค่ายางคงเหลือภายในสาขา';
  else
    v_customer_name := 'รับยางจากสาขา ' || v_source_location_name;
    v_debt_description := 'หักมูลค่ายางรับจากสาขา ' || v_source_location_name;
  end if;
  v_average_price := round(v_source.paid_total / v_source.current_weight, 2);

  insert into public.rubber_bills (
    client_temp_id, local_bill_no, server_bill_no, idempotency_key,
    sync_status, record_status, location_id, bill_no, bill_date,
    customer_id, customer_name, bill_type, deduct_weight, weight,
    rubber_value, average_price, deduction_total, net_total,
    acid_pack_count, client_recorded_at, client_created_at,
    server_received_at, revision_no, created_by_user_id,
    created_by_name, created_by_phone, source_rubber_export_id,
    source_export_no, received_at, received_age_hours,
    received_age_is_estimated
  ) values (
    v_client_temp_id, v_bill_no, v_bill_no, v_client_temp_id,
    'synced', 'active', p_destination_location_id, v_bill_no, v_bill_date,
    null, v_customer_name, 'บิลเครื่องชั่งเล็ก', 0, v_source.current_weight,
    v_source.paid_total, v_average_price, v_source.paid_total, 0,
    0, v_now, v_now, v_now, 1, auth.uid(),
    coalesce(v_actor_name, ''), coalesce(v_actor_phone, ''), v_source.id,
    v_source.export_no, v_now, v_age_hours,
    v_age.estimated_age_item_count > 0
  ) returning id into v_bill_id;

  insert into public.rubber_bill_items (
    bill_id, item_type, description, weight_in, weight_out, net_weight,
    quantity, unit, price, total, sequence_no
  ) values
    (
      v_bill_id, 'weigh', v_customer_name,
      v_source.current_weight, 0, v_source.current_weight,
      v_source.current_weight, 'kg', v_average_price, v_source.paid_total, 1
    ),
    (
      v_bill_id, 'debt', v_debt_description,
      null, null, null, null, null, null, v_source.paid_total, 2
    );

  return jsonb_build_object(
    'status', 'received',
    'billId', v_bill_id,
    'billNo', v_bill_no,
    'sourceExportId', v_source.id,
    'sourceExportNo', v_source.export_no,
    'receivedAt', v_now,
    'receivedAgeHours', v_age_hours
  );
exception
  when unique_violation then
    raise exception 'BRANCH_RECEIPT_ALREADY_EXISTS:%', coalesce(v_source.export_no, '')
      using errcode = 'P0001';
end;
$$;

create or replace function public.get_rubber_export_age_summaries(p_location_id uuid)
returns table (
  export_id uuid, calculated_at timestamptz, average_age_hours numeric,
  oldest_age_hours numeric, estimated_age_item_count integer,
  receipt_bill_id uuid, receipt_bill_no text, receipt_location_name text
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
    case when e.status = 'draft'
      or (e.status = 'verified' and e.sold_out_at is null and receipt.id is null)
      then v_now else e.age_cutoff_at end,
    case when e.status = 'draft'
      or (e.status = 'verified' and e.sold_out_at is null and receipt.id is null)
      then s.average_age_hours else e.average_age_hours end,
    case when e.status = 'draft'
      or (e.status = 'verified' and e.sold_out_at is null and receipt.id is null)
      then s.oldest_age_hours else e.oldest_age_hours end,
    case when e.status = 'draft'
      or (e.status = 'verified' and e.sold_out_at is null and receipt.id is null)
      then s.estimated_age_item_count else e.estimated_age_item_count end,
    receipt.id, receipt.server_bill_no, receipt.location_name
  from public.rubber_exports e
  left join lateral (
    select b.id, b.server_bill_no, l.name as location_name
    from public.rubber_bills b
    join public.locations l on l.id = b.location_id
    where b.source_rubber_export_id = e.id and b.record_status = 'active'
    limit 1
  ) receipt on true
  left join lateral private.rubber_export_age_summary(e.id, v_now) s
    on e.status = 'draft'
      or (e.status = 'verified' and e.sold_out_at is null and receipt.id is null)
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
  v_average_age_hours numeric;
  v_oldest_age_hours numeric;
  v_estimated_age_item_count integer;
  v_items jsonb;
  v_official_items jsonb;
  v_receipt jsonb;
begin
  select * into v_export from public.rubber_exports where id = p_export_id;
  if v_export.id is null or not private.can_manage_reports(v_export.location_id) then
    raise exception 'ไม่มีสิทธิ์ดูอายุยางของรายการนี้';
  end if;
  select jsonb_build_object(
    'billId', b.id, 'billNo', b.server_bill_no, 'locationName', l.name
  ) into v_receipt
  from public.rubber_bills b
  join public.locations l on l.id = b.location_id
  where b.source_rubber_export_id = p_export_id and b.record_status = 'active'
  limit 1;

  v_cutoff := case
    when v_export.status = 'draft' then clock_timestamp()
    when v_export.status = 'verified'
      and v_export.sold_out_at is null
      and v_receipt is null then clock_timestamp()
    when v_export.status = 'verified' or v_export.previous_status = 'verified'
      then v_export.age_cutoff_at
    else null end;
  if v_cutoff is not null then
    select s.average_age_hours, s.oldest_age_hours, s.estimated_age_item_count
    into v_average_age_hours, v_oldest_age_hours, v_estimated_age_item_count
    from private.rubber_export_age_summary(p_export_id, v_cutoff) s;
  end if;
  select jsonb_agg(jsonb_build_object(
    'itemId', i.id,
    'ageHours', case when v_cutoff is null then null else round(private.rubber_export_item_age_hours(
      i.bill_date, i.age_source_at, i.carried_age_hours, v_cutoff
    ), 2) end,
    'ageIsEstimated', i.age_is_estimated
  ) order by i.eligibility_at, i.source_bill_id)
  into v_items from public.rubber_export_items i where i.export_id = p_export_id;

  if v_export.status = 'verified' and v_export.age_cutoff_at is not null then
    select jsonb_agg(jsonb_build_object(
      'itemId', i.id,
      'ageHours', round(private.rubber_export_item_age_hours(
        i.bill_date, i.age_source_at, i.carried_age_hours, v_export.age_cutoff_at
      ), 2),
      'ageIsEstimated', i.age_is_estimated
    ) order by i.eligibility_at, i.source_bill_id)
    into v_official_items
    from public.rubber_export_items i
    where i.export_id = p_export_id;
  end if;

  return jsonb_build_object(
    'calculatedAt', v_cutoff,
    'averageAgeHours', v_average_age_hours,
    'oldestAgeHours', v_oldest_age_hours,
    'estimatedAgeItemCount', v_estimated_age_item_count,
    'receivedBy', v_receipt,
    'items', coalesce(v_items, '[]'::jsonb),
    'officialItems', coalesce(v_official_items, '[]'::jsonb)
  );
end;
$$;

create or replace function public.delete_rubber_export(p_export_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_export public.rubber_exports%rowtype;
  v_audit public.document_deletion_audits%rowtype;
  v_report_no text;
  v_receipt_no text;
  v_actor_name text;
  v_now timestamptz := clock_timestamp();
begin
  if not private.can_delete_reports() then
    raise exception 'เฉพาะ super_admin หรือผู้มีสิทธิ์จัดการระบบเท่านั้นที่ลบได้';
  end if;
  select * into v_export
  from public.rubber_exports
  where id = p_export_id
  for update;
  if v_export.id is null then
    select * into v_audit
    from public.document_deletion_audits
    where document_kind = 'rubber_export' and source_id = p_export_id;
    if v_audit.id is not null then
      return jsonb_build_object(
        'id', p_export_id, 'exportNo', v_audit.document_no, 'status', 'deleted'
      );
    end if;
    raise exception 'ไม่พบรายการส่งออก';
  end if;
  if v_export.sold_out_at is not null then
    raise exception 'RUBBER_EXPORT_SOLD_OUT:%', v_export.export_no
      using errcode = 'P0001', hint = 'กรุณายกเลิกขายก่อนลบรายการ';
  end if;
  v_report_no := private.active_report_no('rubber_export', p_export_id);
  if v_report_no is not null then perform private.raise_report_lock(v_report_no); end if;
  select coalesce(b.server_bill_no, b.local_bill_no, b.bill_no)
  into v_receipt_no
  from public.rubber_bills b
  where b.source_rubber_export_id = p_export_id and b.record_status = 'active'
  limit 1;
  if v_receipt_no is not null then
    raise exception 'BRANCH_RECEIPT_SOURCE_LOCKED:%', v_export.export_no
      using hint = 'กรุณาลบบิลรับ ' || v_receipt_no || ' ก่อน';
  end if;
  select p.name into v_actor_name from public.profiles p where p.id = auth.uid();
  insert into public.document_deletion_audits (
    document_kind, source_id, document_no, location_id, previous_status,
    deleted_by_user_id, deleted_by_name, deleted_at
  ) values (
    'rubber_export', v_export.id, v_export.export_no, v_export.location_id,
    v_export.status, auth.uid(), coalesce(v_actor_name, ''), v_now
  );
  delete from public.rubber_export_items where export_id = v_export.id;
  delete from public.rubber_exports where id = v_export.id;
  return jsonb_build_object(
    'id', v_export.id, 'exportNo', v_export.export_no, 'status', 'deleted'
  );
end;
$$;

-- Existing receipt snapshots are intentionally immutable through normal writes and
-- may already be report-locked. Hold the table lock while bypassing only those two
-- guards for this one forward backfill; transactional DDL restores both on failure.
begin;
lock table public.rubber_bills in access exclusive mode;
alter table public.rubber_bills disable trigger guard_branch_receipt_bill;
alter table public.rubber_bills disable trigger report_lock_rubber_bills;

update public.rubber_bills b
set received_age_hours = round((
      select s.average_age_hours
      from private.rubber_export_raw_age_summary(b.source_rubber_export_id, b.received_at) s
    ), 6),
    received_age_is_estimated = (
      select s.estimated_age_item_count > 0
      from private.rubber_export_raw_age_summary(b.source_rubber_export_id, b.received_at) s
    )
where b.record_status = 'active'
  and b.source_rubber_export_id is not null
  and b.received_at is not null
  and exists (
    select 1 from public.rubber_export_items source_item
    where source_item.export_id = b.source_rubber_export_id
  );

set constraints all immediate;
alter table public.rubber_bills enable trigger report_lock_rubber_bills;
alter table public.rubber_bills enable trigger guard_branch_receipt_bill;

update public.rubber_export_items i
set age_source_at = b.received_at,
    carried_age_hours = b.received_age_hours,
    age_is_estimated = b.received_age_is_estimated
from public.rubber_exports e, public.rubber_bills b
where i.export_id = e.id
  and e.status = 'draft'
  and i.source_bill_id = b.id
  and b.record_status = 'active'
  and b.source_rubber_export_id is not null;

commit;

drop function private.branch_receipt_age_hours(numeric, timestamptz, timestamptz);

revoke all on function public.preview_rubber_export(uuid, uuid[], uuid) from public, anon;
revoke all on function public.replace_rubber_export_items(uuid, uuid[]) from public, anon;
revoke all on function public.set_rubber_export_sold_out(uuid, boolean) from public, anon;
grant execute on function public.preview_rubber_export(uuid, uuid[], uuid) to authenticated;
grant execute on function public.replace_rubber_export_items(uuid, uuid[]) to authenticated;
grant execute on function public.set_rubber_export_sold_out(uuid, boolean) to authenticated;

comment on column public.rubber_exports.sold_out_at is
  'Current reversible sold-out marker; null means the verified export remains receivable.';
comment on function public.replace_rubber_export_items(uuid, uuid[]) is
  'Atomically replaces the full member set of one draft and resets derived operational inputs.';
comment on function private.rubber_export_raw_age_summary(uuid, timestamptz) is
  'Unrounded weighted age used before receipt/downstream snapshot rounding.';

notify pgrst, 'reload schema';
