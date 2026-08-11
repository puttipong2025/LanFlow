-- Branch receipts carry both the rubber purchase cost and export work cost.

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
    round(e.paid_total + e.work_total, 2),
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
    and e.work_total is not null
    and e.work_total >= 0
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
  v_rubber_value numeric;
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
     or v_source.work_total is null
     or v_source.work_total < 0
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
  v_rubber_value := round(v_source.paid_total + v_source.work_total, 2);
  v_average_price := round(v_rubber_value / v_source.current_weight, 2);

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
    v_rubber_value, v_average_price, v_rubber_value, 0,
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
      v_source.current_weight, 'kg', v_average_price, v_rubber_value, 1
    ),
    (
      v_bill_id, 'debt', v_debt_description,
      null, null, null, null, null, null, v_rubber_value, 2
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
