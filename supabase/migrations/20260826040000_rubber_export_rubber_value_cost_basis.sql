-- Forward-fix: use rubber value, never customer payable, as the Rubber Export cost basis.

begin;

lock table public.rubber_export_items, public.rubber_exports in access exclusive mode;

alter table public.rubber_export_items
  drop constraint rubber_export_items_paid_amount_check,
  add constraint rubber_export_items_paid_amount_check check (paid_amount >= 0);

alter table public.rubber_exports
  drop constraint rubber_exports_paid_total_check,
  add constraint rubber_exports_paid_total_check check (paid_total >= 0);

comment on column public.rubber_export_items.paid_amount is
  'Immutable actual customer-payable snapshot retained for reference; never a Rubber Export cost basis.';
comment on column public.rubber_exports.paid_total is
  'Immutable actual customer-payable total retained for reference; never a Rubber Export cost basis.';
comment on column public.rubber_exports.average_price is
  'Immutable average rubber cost: rubber_value_total divided by original_weight_total.';

alter table public.rubber_exports disable trigger guard_rubber_export_state;
alter table public.rubber_exports disable trigger report_lock_rubber_exports;

update public.rubber_exports e
set average_price = round(e.rubber_value_total / e.original_weight_total, 2)
where e.average_price is distinct from round(e.rubber_value_total / e.original_weight_total, 2);

alter table public.rubber_exports enable trigger guard_rubber_export_state;
alter table public.rubber_exports enable trigger report_lock_rubber_exports;

do $$
begin
  if exists (
    select 1
    from public.rubber_exports e
    where e.average_price is distinct from round(e.rubber_value_total / e.original_weight_total, 2)
  ) then
    raise exception 'RUBBER_EXPORT_RUBBER_AVERAGE_BACKFILL_INCOMPLETE';
  end if;

  if (
    select count(*)
    from pg_trigger
    where tgrelid = 'public.rubber_exports'::regclass
      and tgname in ('guard_rubber_export_state', 'report_lock_rubber_exports')
      and tgenabled = 'O'
  ) <> 2 then
    raise exception 'RUBBER_EXPORT_COST_BASIS_TRIGGER_STATE_INVALID';
  end if;
end;
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
  where c.net_weight is null or c.net_weight <= 0
    or c.paid_amount is null or c.paid_amount < 0
    or c.rubber_value_amount is null or c.rubber_value_amount <= 0;
  if v_invalid is not null then
    raise exception 'INVALID_RUBBER_BILL:%', v_invalid
      using errcode = 'P0001', hint = 'น้ำหนักสุทธิและมูลค่ายางต้องมากกว่า 0 และยอดจ่ายจริงต้องไม่ติดลบ';
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
    'rubberValueTotal', round(sum(rubber_value_amount), 2),
    'averagePrice', round(sum(rubber_value_amount) / sum(net_weight), 2),
    'calculatedAt', v_now,
    'averageAgeHours', round(sum(net_weight * age_hours) / sum(net_weight), 2),
    'oldestAgeHours', round(max(age_hours), 2),
    'estimatedAgeItemCount', count(*) filter (where age_is_estimated)::integer,
    'items', jsonb_agg(jsonb_build_object(
      'reportItemId', report_item_id, 'billId', bill_id, 'billDate', bill_date,
      'billNo', bill_no, 'customerName', customer_name, 'eligibilityAt', eligibility_at,
      'netWeight', net_weight, 'paidAmount', paid_amount,
      'rubberValueAmount', rubber_value_amount,
      'ageHours', round(age_hours, 2), 'ageIsEstimated', age_is_estimated
    ) order by eligibility_at, bill_id)
  ) into v_result from aged;
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
  v_actor_id uuid := auth.uid(); v_actor_name text; v_actor_phone text;
  v_now timestamptz := clock_timestamp(); v_export_date date; v_sequence_no integer;
  v_export_no text; v_export_id uuid; v_item_count integer;
  v_original_weight numeric; v_paid_total numeric; v_rubber_value_total numeric;
begin
  if p_location_id is null or not private.can_manage_reports(p_location_id) then
    raise exception 'ไม่มีสิทธิ์สร้างรายการส่งออกของสาขานี้';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rubber-export:' || p_location_id::text, 0));
  perform private.validate_rubber_export_selection(p_location_id, p_selected_report_item_ids);
  select count(*)::integer, round(sum(c.net_weight), 2), round(sum(c.paid_amount), 2),
    round(sum(c.rubber_value_amount), 2)
  into v_item_count, v_original_weight, v_paid_total, v_rubber_value_total
  from private.rubber_export_candidates(p_location_id, p_selected_report_item_ids) c;
  if coalesce(v_item_count, 0) = 0 then raise exception 'ไม่มีบิลที่พร้อมสร้างรายการส่งออก'; end if;
  select p.name, p.phone into v_actor_name, v_actor_phone from public.profiles p where p.id = v_actor_id;
  v_export_date := (v_now at time zone 'Asia/Bangkok')::date;
  v_sequence_no := private.next_document_sequence('REX', p_location_id, v_export_date);
  v_export_no := 'REX-' || to_char(v_export_date, 'YYYYMMDD') || '-' || lpad(v_sequence_no::text, 3, '0');
  insert into public.rubber_exports (
    export_no, export_date, sequence_no, location_id, original_weight_total,
    paid_total, rubber_value_total, average_price, created_by_user_id,
    created_by_name, created_by_phone, created_at
  ) values (
    v_export_no, v_export_date, v_sequence_no, p_location_id, v_original_weight,
    v_paid_total, v_rubber_value_total, round(v_rubber_value_total / v_original_weight, 2),
    v_actor_id, coalesce(v_actor_name, ''), coalesce(v_actor_phone, ''), v_now
  ) returning id into v_export_id;
  insert into public.rubber_export_items (
    export_id, location_id, source_report_item_id, source_bill_id, bill_date,
    bill_no, customer_name, eligibility_at, net_weight, paid_amount,
    rubber_value_amount, age_source_at, age_is_estimated, carried_age_hours
  )
  select v_export_id, p_location_id, c.report_item_id, c.bill_id, c.bill_date,
    c.bill_no, c.customer_name, c.eligibility_at, c.net_weight, c.paid_amount,
    c.rubber_value_amount,
    case when b.source_rubber_export_id is not null then b.received_at else coalesce(b.client_created_at, b.created_at) end,
    case when b.source_rubber_export_id is not null then b.received_age_is_estimated
      else b.client_created_at is null
        or (coalesce(b.client_created_at, b.created_at) at time zone 'Asia/Bangkok')::date <> c.bill_date end,
    case when b.source_rubber_export_id is not null then b.received_age_hours else null end
  from private.rubber_export_candidates(p_location_id, p_selected_report_item_ids) c
  join public.rubber_bills b on b.id = c.bill_id;
  get diagnostics v_item_count = row_count;
  return jsonb_build_object('id', v_export_id, 'exportNo', v_export_no, 'itemCount', v_item_count);
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
  v_export public.rubber_exports%rowtype; v_item_count integer;
  v_original_weight numeric; v_paid_total numeric; v_rubber_value_total numeric;
begin
  select * into v_export from public.rubber_exports e where e.id = p_export_id for update;
  if v_export.id is null or not private.can_manage_reports(v_export.location_id) then
    raise exception 'ไม่มีสิทธิ์แก้ไขรายการส่งออกนี้';
  end if;
  if v_export.status <> 'draft' then raise exception 'แก้ไขสมาชิกได้เฉพาะรายการฉบับร่าง'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rubber-export:' || v_export.location_id::text, 0));
  perform private.validate_rubber_export_selection(v_export.location_id, p_selected_report_item_ids, v_export.id);
  delete from public.rubber_export_items i where i.export_id = v_export.id;
  insert into public.rubber_export_items (
    export_id, location_id, source_report_item_id, source_bill_id, bill_date,
    bill_no, customer_name, eligibility_at, net_weight, paid_amount,
    rubber_value_amount, age_source_at, age_is_estimated, carried_age_hours
  )
  select v_export.id, v_export.location_id, c.report_item_id, c.bill_id, c.bill_date,
    c.bill_no, c.customer_name, c.eligibility_at, c.net_weight, c.paid_amount,
    c.rubber_value_amount,
    case when b.source_rubber_export_id is not null then b.received_at else coalesce(b.client_created_at, b.created_at) end,
    case when b.source_rubber_export_id is not null then b.received_age_is_estimated
      else b.client_created_at is null
        or (coalesce(b.client_created_at, b.created_at) at time zone 'Asia/Bangkok')::date <> c.bill_date end,
    case when b.source_rubber_export_id is not null then b.received_age_hours else null end
  from private.rubber_export_candidates(v_export.location_id, p_selected_report_item_ids, v_export.id) c
  join public.rubber_bills b on b.id = c.bill_id;
  select count(*)::integer, round(sum(i.net_weight), 2), round(sum(i.paid_amount), 2),
    round(sum(i.rubber_value_amount), 2)
  into v_item_count, v_original_weight, v_paid_total, v_rubber_value_total
  from public.rubber_export_items i where i.export_id = v_export.id;
  update public.rubber_exports set original_weight_total = v_original_weight,
    paid_total = v_paid_total, rubber_value_total = v_rubber_value_total,
    average_price = round(v_rubber_value_total / v_original_weight, 2), current_weight = null,
    weight_loss_percent = null, work_rate = null, other_operating_cost = 0, work_total = null
  where id = v_export.id;
  return jsonb_build_object('id', v_export.id, 'status', 'draft', 'itemCount', v_item_count,
    'originalWeightTotal', v_original_weight, 'paidTotal', v_paid_total,
    'rubberValueTotal', v_rubber_value_total);
end;
$$;

comment on function public.replace_rubber_export_items(uuid,uuid[]) is
  'Atomically replaces draft members, retains actual-paid snapshots, and recomputes rubber-value cost snapshots.';

notify pgrst, 'reload schema';

commit;
