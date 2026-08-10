-- Receive one verified Rubber Export from another active branch as a read-only
-- Rubber Bill while carrying current weight, purchase cost and weighted age.

alter table public.rubber_bills
  add column source_rubber_export_id uuid references public.rubber_exports(id),
  add column source_export_no text,
  add column received_at timestamptz,
  add column received_age_hours numeric(14,6),
  add column received_age_is_estimated boolean;

alter table public.rubber_bills
  add constraint rubber_bills_branch_receipt_shape_check check (
    (
      source_rubber_export_id is null
      and source_export_no is null
      and received_at is null
      and received_age_hours is null
      and received_age_is_estimated is null
    )
    or
    (
      source_rubber_export_id is not null
      and nullif(btrim(source_export_no), '') is not null
      and received_at is not null
      and received_age_hours is not null
      and received_age_hours >= 0
      and received_age_is_estimated is not null
      and net_total = 0
      and rubber_value > 0
      and deduction_total = net_rubber_value
    )
  );

create unique index rubber_bills_one_active_branch_receipt
  on public.rubber_bills(source_rubber_export_id)
  where source_rubber_export_id is not null and record_status = 'active';

create index rubber_bills_branch_receipt_source_lookup
  on public.rubber_bills(source_rubber_export_id, record_status);

alter table public.rubber_export_items
  add column carried_age_hours numeric(14,6);

alter table public.rubber_export_items
  add constraint rubber_export_items_carried_age_check check (
    carried_age_hours is null or carried_age_hours >= 0
  );

create or replace function private.branch_receipt_age_hours(
  p_source_age_hours numeric,
  p_verified_at timestamptz,
  p_received_at timestamptz
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select greatest(coalesce(p_source_age_hours, 0), 0)
    + greatest(extract(epoch from (p_received_at - p_verified_at)) / 3600, 0)::numeric;
$$;

create or replace function private.rubber_bill_is_branch_receipt_reportable(p_bill_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.rubber_bills b
    where b.id = p_bill_id
      and b.source_rubber_export_id is not null
      and b.record_status = 'active'
      and b.sync_status = 'synced'
      and b.server_bill_no is not null
      and b.received_at is not null
      and b.received_age_hours >= 0
      and b.rubber_value > 0
      and b.deduction_total = b.net_rubber_value
      and b.net_total = 0
      and exists (
        select 1 from public.rubber_bill_items i
        where i.bill_id = b.id
          and i.item_type = 'weigh'
          and coalesce(i.net_weight, 0) > 0
          and coalesce(i.price, 0) > 0
      )
  );
$$;

revoke all on function private.branch_receipt_age_hours(numeric, timestamptz, timestamptz)
  from public, anon, authenticated;
revoke all on function private.rubber_bill_is_branch_receipt_reportable(uuid)
  from public, anon, authenticated;

create or replace function public.get_receivable_rubber_exports(p_destination_location_id uuid)
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
    e.average_age_hours,
    round(private.branch_receipt_age_hours(
      e.average_age_hours, e.verified_at, v_now
    ), 6),
    coalesce(e.estimated_age_item_count, 0) > 0
  from public.rubber_exports e
  join public.locations l on l.id = e.location_id and l.is_active = true
  where e.location_id <> p_destination_location_id
    and e.status = 'verified'
    and e.verified_at is not null
    and e.current_weight > 0
    and e.paid_total > 0
    and e.average_age_hours is not null
    and not exists (
      select 1 from public.rubber_bills b
      where b.source_rubber_export_id = e.id
        and b.record_status = 'active'
    )
  order by e.verified_at desc, e.export_no, e.id;
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

  if v_source.id is null then
    raise exception 'BRANCH_RECEIPT_SOURCE_NOT_FOUND';
  end if;

  if exists (
    select 1 from public.rubber_bills b
    where b.source_rubber_export_id = v_source.id
      and b.record_status = 'active'
  ) then
    raise exception 'BRANCH_RECEIPT_ALREADY_EXISTS:%', v_source.export_no using errcode = 'P0001';
  end if;

  if v_source.location_id = p_destination_location_id
     or v_source.status <> 'verified'
     or v_source.verified_at is null
     or v_source.current_weight is null
     or v_source.current_weight <= 0
     or v_source.paid_total <= 0
     or v_source.average_age_hours is null
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
  v_customer_name := 'รับยางจากสาขา ' || v_source_location_name;
  v_age_hours := round(private.branch_receipt_age_hours(
    v_source.average_age_hours, v_source.verified_at, v_now
  ), 6);
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
    coalesce(v_source.estimated_age_item_count, 0) > 0
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
      v_bill_id, 'debt', 'หักมูลค่ายางรับจากสาขา ' || v_source_location_name,
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

revoke all on function public.get_receivable_rubber_exports(uuid) from public, anon;
revoke all on function public.receive_rubber_export(uuid, uuid) from public, anon;
grant execute on function public.get_receivable_rubber_exports(uuid) to authenticated;
grant execute on function public.receive_rubber_export(uuid, uuid) to authenticated;

create or replace function private.guard_branch_receipt_bill()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.source_rubber_export_id is null then return new; end if;
  if new.source_rubber_export_id is distinct from old.source_rubber_export_id
     or new.source_export_no is distinct from old.source_export_no
     or new.received_at is distinct from old.received_at
     or new.received_age_hours is distinct from old.received_age_hours
     or new.received_age_is_estimated is distinct from old.received_age_is_estimated then
    raise exception 'บิลรับยางจากสาขาแก้ไขข้อมูลต้นทางไม่ได้';
  end if;
  if old.record_status = 'active' and new.record_status = 'active' then
    raise exception 'บิลรับยางจากสาขาไม่มีปุ่มแก้ไข';
  end if;
  return new;
end;
$$;

create trigger guard_branch_receipt_bill
  before update on public.rubber_bills
  for each row execute function private.guard_branch_receipt_bill();

create or replace function private.guard_received_rubber_export_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt record;
begin
  if old.status <> 'deleted' and new.status = 'deleted' then
    select b.server_bill_no, l.name as destination_name
    into v_receipt
    from public.rubber_bills b
    join public.locations l on l.id = b.location_id
    where b.source_rubber_export_id = old.id
      and b.record_status = 'active'
    limit 1;
    if found then
      raise exception 'BRANCH_RECEIPT_SOURCE_LOCKED:%', old.export_no
        using errcode = 'P0001',
          hint = 'รับเข้าแล้วที่ ' || v_receipt.destination_name || ' · ' || v_receipt.server_bill_no || ' กรุณาลบบิลรับก่อน';
    end if;
  end if;
  return new;
end;
$$;

create trigger guard_received_rubber_export_delete
  before update of status on public.rubber_exports
  for each row execute function private.guard_received_rubber_export_delete();

do $$
declare
  v_definition text;
  v_old text := 'and private.rubber_bill_is_payable(b.id)';
  v_new text := 'and (private.rubber_bill_is_payable(b.id) or private.rubber_bill_is_branch_receipt_reportable(b.id))';
begin
  select pg_get_functiondef('private.reportable_items(uuid,timestamptz)'::regprocedure)
  into v_definition;
  if strpos(v_definition, v_old) = 0 then
    raise exception 'Unable to locate Rubber Bill reportability predicate';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$$;

create or replace function private.guard_pending_rubber_bill_relation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill_id uuid;
begin
  if tg_table_name = 'report_items' then
    if new.entity_type <> 'rubber_bill' or new.active <> true then return new; end if;
    v_bill_id := new.entity_id;
  else
    if new.source_type <> 'rubber_bill' then return new; end if;
    v_bill_id := new.source_id;
  end if;

  perform pg_advisory_xact_lock(hashtext('rubber-bill-approval:' || v_bill_id::text));
  if private.rubber_bill_has_pending_approval(v_bill_id) then
    raise exception 'บิลยางกำลังรออนุมัติ จึงนำไปทำรายงานหรือโอนเงินไม่ได้';
  end if;
  if tg_table_name = 'report_items'
     and private.rubber_bill_is_branch_receipt_reportable(v_bill_id) then
    return new;
  end if;
  if not private.rubber_bill_is_payable(v_bill_id) then
    raise exception 'บิลยางยังมีรายการราคา 0 หรือยอดสุทธิไม่มากกว่า 0 จึงนำไปทำรายงานหรือโอนเงินไม่ได้';
  end if;
  return new;
end;
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
      select 1 from public.rubber_export_items x
      where x.location_id = p_location_id
        and x.source_bill_id = b.id
        and x.active = true
    )
  order by i.eligibility_at, b.id;
$$;

create or replace function private.rubber_export_item_age_hours(
  p_bill_date date,
  p_age_source_at timestamptz,
  p_carried_age_hours numeric,
  p_cutoff_at timestamptz
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_carried_age_hours, 0)
    + private.rubber_export_age_hours(p_bill_date, p_age_source_at, p_cutoff_at);
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
    coalesce(round(sum(i.net_weight * private.rubber_export_item_age_hours(
      i.bill_date, i.age_source_at, i.carried_age_hours, p_cutoff_at
    )) / nullif(sum(i.net_weight), 0), 2), 0),
    coalesce(round(max(private.rubber_export_item_age_hours(
      i.bill_date, i.age_source_at, i.carried_age_hours, p_cutoff_at
    )), 2), 0),
    count(*) filter (where i.age_is_estimated)::integer
  from public.rubber_export_items i
  where i.export_id = p_export_id;
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
    select c.*,
      case when b.source_rubber_export_id is not null then b.received_at
        else coalesce(b.client_created_at, b.created_at) end as age_source_at,
      case when b.source_rubber_export_id is not null then b.received_age_hours
        else null end as carried_age_hours,
      case when b.source_rubber_export_id is not null then b.received_age_is_estimated
        else b.client_created_at is null
          or (coalesce(b.client_created_at, b.created_at) at time zone 'Asia/Bangkok')::date <> c.bill_date
        end as age_is_estimated
    from private.rubber_export_candidates(p_location_id, p_selected_report_item_ids) c
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
    age_source_at, age_is_estimated, carried_age_hours
  )
  select v_export_id, p_location_id, c.report_item_id, c.bill_id, c.bill_date,
    c.bill_no, c.customer_name, c.eligibility_at, c.net_weight, c.paid_amount,
    case when b.source_rubber_export_id is not null then b.received_at
      else coalesce(b.client_created_at, b.created_at) end,
    case when b.source_rubber_export_id is not null then b.received_age_is_estimated
      else b.client_created_at is null
        or (coalesce(b.client_created_at, b.created_at) at time zone 'Asia/Bangkok')::date <> c.bill_date
      end,
    case when b.source_rubber_export_id is not null then b.received_age_hours else null end
  from private.rubber_export_candidates(p_location_id, p_selected_report_item_ids) c
  join public.rubber_bills b on b.id = c.bill_id;
  get diagnostics v_item_count = row_count;
  return jsonb_build_object('id', v_export_id, 'exportNo', v_export_no, 'itemCount', v_item_count);
end;
$$;

drop function public.get_rubber_export_age_summaries(uuid);
create function public.get_rubber_export_age_summaries(p_location_id uuid)
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
    case when e.status = 'draft' then v_now else e.age_cutoff_at end,
    case when e.status = 'draft' then s.average_age_hours else e.average_age_hours end,
    case when e.status = 'draft' then s.oldest_age_hours else e.oldest_age_hours end,
    case when e.status = 'draft' then s.estimated_age_item_count else e.estimated_age_item_count end,
    receipt.id, receipt.server_bill_no, receipt.location_name
  from public.rubber_exports e
  left join lateral private.rubber_export_age_summary(e.id, v_now) s on e.status = 'draft'
  left join lateral (
    select b.id, b.server_bill_no, l.name as location_name
    from public.rubber_bills b
    join public.locations l on l.id = b.location_id
    where b.source_rubber_export_id = e.id and b.record_status = 'active'
    limit 1
  ) receipt on true
  where e.location_id = p_location_id;
end;
$$;

revoke all on function public.get_rubber_export_age_summaries(uuid) from public, anon;
grant execute on function public.get_rubber_export_age_summaries(uuid) to authenticated, service_role;

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
  v_receipt jsonb;
begin
  select * into v_export from public.rubber_exports where id = p_export_id;
  if v_export.id is null or not private.can_manage_reports(v_export.location_id) then
    raise exception 'ไม่มีสิทธิ์ดูอายุยางของรายการนี้';
  end if;
  v_cutoff := case
    when v_export.status = 'draft' then clock_timestamp()
    when v_export.status = 'verified' or v_export.previous_status = 'verified' then v_export.age_cutoff_at
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

  select jsonb_build_object(
    'billId', b.id, 'billNo', b.server_bill_no, 'locationName', l.name
  ) into v_receipt
  from public.rubber_bills b
  join public.locations l on l.id = b.location_id
  where b.source_rubber_export_id = p_export_id and b.record_status = 'active'
  limit 1;

  return jsonb_build_object(
    'calculatedAt', v_cutoff,
    'averageAgeHours', v_average_age_hours,
    'oldestAgeHours', v_oldest_age_hours,
    'estimatedAgeItemCount', v_estimated_age_item_count,
    'receivedBy', v_receipt,
    'items', coalesce(v_items, '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_rubber_export_age_detail(uuid) from public, anon;
grant execute on function public.get_rubber_export_age_detail(uuid) to authenticated, service_role;

comment on column public.rubber_bills.received_age_hours is
  'Weighted average age at received_at, including verified-to-received transit time.';
comment on column public.rubber_export_items.carried_age_hours is
  'Nullable base age carried by a branch-receipt bill; null keeps the normal bill-date formula.';

notify pgrst, 'reload schema';
