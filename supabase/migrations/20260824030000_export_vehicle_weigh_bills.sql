begin;

alter table private.document_number_counters
  drop constraint document_number_counters_document_kind_check;
alter table private.document_number_counters
  add constraint document_number_counters_document_kind_check
  check (document_kind in ('RPT', 'REX', 'WEX'));

create or replace function private.next_document_sequence(
  p_document_kind text,
  p_location_id uuid,
  p_document_date date
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sequence integer;
begin
  if p_document_kind not in ('RPT', 'REX', 'WEX')
     or p_location_id is null
     or p_document_date is null then
    raise exception 'Invalid document sequence request';
  end if;

  insert into private.document_number_counters (
    document_kind, location_id, document_date, last_sequence_no, updated_at
  )
  values (p_document_kind, p_location_id, p_document_date, 1, clock_timestamp())
  on conflict (document_kind, location_id, document_date)
  do update set
    last_sequence_no = private.document_number_counters.last_sequence_no + 1,
    updated_at = clock_timestamp()
  returning last_sequence_no into v_sequence;

  return v_sequence;
end;
$$;

comment on table private.document_number_counters is
  'Durable per-location/date RPT, REX, and WEX sequence state that survives source deletion.';

create table public.export_vehicle_weigh_bills (
  id uuid primary key default gen_random_uuid(),
  wex_no text not null,
  wex_date date not null,
  sequence_no integer not null check (sequence_no > 0),
  location_id uuid not null references public.locations(id),
  revision integer not null default 1 check (revision > 0),
  created_by_user_id uuid not null references public.profiles(id),
  created_by_name text not null check (nullif(btrim(created_by_name), '') is not null),
  created_at timestamptz not null default clock_timestamp(),
  updated_by_user_id uuid not null references public.profiles(id),
  updated_by_name text not null check (nullif(btrim(updated_by_name), '') is not null),
  updated_at timestamptz not null default clock_timestamp(),
  unique (location_id, wex_date, sequence_no),
  unique (location_id, wex_no)
);

create index export_vehicle_weigh_bills_location_created
  on public.export_vehicle_weigh_bills (location_id, created_at desc, id desc);

create table public.export_vehicle_weigh_lines (
  id uuid primary key default gen_random_uuid(),
  wex_id uuid not null references public.export_vehicle_weigh_bills(id),
  sequence_no integer not null check (sequence_no between 1 and 2),
  vehicle_registration text not null check (
    nullif(btrim(vehicle_registration), '') is not null
    and char_length(vehicle_registration) <= 64
  ),
  vehicle_registration_key text generated always as (
    lower(regexp_replace(btrim(vehicle_registration), '\s+', ' ', 'g'))
  ) stored,
  carrier_id uuid references public.transport_staffs(id),
  carrier_name text,
  inbound_at timestamptz not null,
  inbound_weight numeric(14,2) not null check (inbound_weight > 0),
  outbound_at timestamptz not null,
  outbound_weight numeric(14,2) not null check (outbound_weight > inbound_weight),
  net_weight numeric(14,2) generated always as (outbound_weight - inbound_weight) stored,
  unique (wex_id, sequence_no),
  unique (wex_id, vehicle_registration_key),
  check (carrier_name is null or nullif(btrim(carrier_name), '') is not null),
  check (carrier_id is null or carrier_name is not null),
  check (outbound_at > inbound_at)
);

create table public.export_vehicle_weigh_bill_reservations (
  id uuid primary key default gen_random_uuid(),
  wex_id uuid not null references public.export_vehicle_weigh_bills(id),
  rubber_export_id uuid not null references public.rubber_exports(id),
  sequence_no integer not null check (sequence_no > 0),
  export_no text not null check (nullif(btrim(export_no), '') is not null),
  current_weight numeric(14,2) not null check (current_weight > 0),
  created_at timestamptz not null default clock_timestamp(),
  unique (wex_id, sequence_no),
  unique (rubber_export_id)
);

create index export_vehicle_weigh_lines_wex_id
  on public.export_vehicle_weigh_lines (wex_id);
create index export_vehicle_weigh_bill_reservations_wex_id
  on public.export_vehicle_weigh_bill_reservations (wex_id);

alter table public.document_deletion_audits
  drop constraint document_deletion_audits_document_kind_check;
alter table public.document_deletion_audits
  add constraint document_deletion_audits_document_kind_check check (
    document_kind in (
      'report_batch', 'rubber_export', 'cash_count', 'export_vehicle_weigh_bill'
    )
  );
alter table public.document_deletion_audits
  add constraint document_deletion_audits_wex_minimal_check check (
    document_kind <> 'export_vehicle_weigh_bill'
    or (
      paired_source_id is null
      and previous_status is null
      and original_actor_user_id is null
      and original_actor_name is null
    )
  );

comment on table public.document_deletion_audits is
  'Permanent minimal audit for hard-deleted RPT, REX, Cash Count, and WEX aggregates; never stores child or business-detail snapshots.';

create function private.normalized_export_vehicle_weigh_lines(
  p_location_id uuid,
  p_lines jsonb
)
returns table (
  sequence_no integer,
  vehicle_registration text,
  carrier_id uuid,
  carrier_name text,
  inbound_at timestamptz,
  inbound_weight numeric,
  outbound_at timestamptz,
  outbound_weight numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_unique_plates integer;
begin
  if coalesce(jsonb_typeof(p_lines), 'null') <> 'array' then
    raise exception 'WEX_INVALID_LINES: ต้องมีรายการชั่งรถ 1–2 คัน';
  end if;
  if jsonb_array_length(p_lines) not between 1 and 2 then
    raise exception 'WEX_INVALID_LINES: ต้องมีรายการชั่งรถ 1–2 คัน';
  end if;
  if p_location_id is null then
    raise exception 'WEX_INVALID_LINES: สาขาของรายการชั่งรถไม่ถูกต้อง';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_lines) line(value)
    where (line.value ? 'carrierId'
        and jsonb_typeof(line.value->'carrierId') not in ('string', 'null'))
      or (line.value ? 'carrierName'
        and jsonb_typeof(line.value->'carrierName') not in ('string', 'null'))
  ) then
    raise exception 'WEX_INVALID_CARRIER: รูปแบบผู้ขนส่งไม่ถูกต้อง';
  end if;

  with parsed as (
    select regexp_replace(btrim(line.value->>'vehicleRegistration'), '\s+', ' ', 'g') as registration
    from jsonb_array_elements(p_lines) line(value)
  )
  select count(*), count(distinct lower(registration))
  into v_count, v_unique_plates
  from parsed
  where nullif(registration, '') is not null and char_length(registration) <= 64;

  if v_count <> jsonb_array_length(p_lines) or v_unique_plates <> v_count then
    raise exception 'WEX_INVALID_LINES: ทะเบียนรถไม่ถูกต้องหรือซ้ำกัน';
  end if;

  perform s.id
  from public.transport_staffs s
  join (
    select distinct nullif(btrim(line.value->>'carrierId'), '')::uuid as id
    from jsonb_array_elements(p_lines) line(value)
    where nullif(btrim(line.value->>'carrierId'), '') is not null
  ) selected on selected.id = s.id
  order by s.id
  for share of s;

  if exists (
    select 1
    from jsonb_array_elements(p_lines) line(value)
    left join public.transport_staffs s
      on s.id = nullif(btrim(line.value->>'carrierId'), '')::uuid
    where nullif(btrim(line.value->>'carrierId'), '') is not null
      and (
        s.id is null
        or not (
          s.record_status = 'active'
          and (s.default_location_id is null or s.default_location_id = p_location_id)
        )
      )
  ) then
    raise exception 'WEX_CARRIER_INELIGIBLE: เลือกได้เฉพาะผู้ขนส่งที่ใช้งานอยู่และมีสิทธิ์ในสาขานี้';
  end if;

  return query
  select
    line.ordinality::integer,
    regexp_replace(btrim(line.value->>'vehicleRegistration'), '\s+', ' ', 'g'),
    s.id,
    case
      when s.id is not null then s.main_name
      else nullif(regexp_replace(btrim(line.value->>'carrierName'), '\s+', ' ', 'g'), '')
    end,
    (line.value->>'inboundAt')::timestamptz,
    round((line.value->>'inboundWeight')::numeric, 2),
    (line.value->>'outboundAt')::timestamptz,
    round((line.value->>'outboundWeight')::numeric, 2)
  from jsonb_array_elements(p_lines) with ordinality as line(value, ordinality)
  left join public.transport_staffs s
    on s.id = nullif(btrim(line.value->>'carrierId'), '')::uuid
  where round((line.value->>'inboundWeight')::numeric, 2) > 0
    and round((line.value->>'outboundWeight')::numeric, 2)
      > round((line.value->>'inboundWeight')::numeric, 2)
    and (line.value->>'outboundAt')::timestamptz
      > (line.value->>'inboundAt')::timestamptz
  order by line.ordinality;

  get diagnostics v_count = row_count;
  if v_count <> jsonb_array_length(p_lines) then
    raise exception 'WEX_INVALID_LINES: รายการชั่งรถไม่สมบูรณ์หรือน้ำหนักสุทธิไม่เป็นบวก';
  end if;
exception
  when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
    raise exception 'WEX_INVALID_LINES: รูปแบบเวลา น้ำหนัก หรือทะเบียนรถไม่ถูกต้อง';
end;
$$;

create function private.validate_wex_rubber_exports(
  p_location_id uuid,
  p_wex_id uuid,
  p_rubber_export_ids uuid[]
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[] := coalesce(p_rubber_export_ids, array[]::uuid[]);
  v_count integer;
  v_weight numeric(14,2);
begin
  if exists (select 1 from unnest(v_ids) as selected(id) where selected.id is null)
     or (select count(*) from unnest(v_ids))
       <> (select count(distinct selected.id) from unnest(v_ids) as selected(id)) then
    raise exception 'WEX_INVALID_REX: รายการขายยางห้ามว่างหรือซ้ำกัน';
  end if;

  perform e.id
  from public.rubber_exports e
  where e.id = any(v_ids)
  order by e.id
  for update;

  select count(*), coalesce(round(sum(e.current_weight), 2), 0)
  into v_count, v_weight
  from public.rubber_exports e
  where e.id = any(v_ids)
    and e.location_id = p_location_id
    and e.status = 'verified'
    and e.sold_out_at is not null
    and e.current_weight is not null
    and e.current_weight > 0;

  if v_count <> cardinality(v_ids) then
    raise exception 'WEX_REX_INELIGIBLE: เลือกได้เฉพาะรายการขายยางที่ตรวจสอบแล้ว ขายออกแล้ว และอยู่สาขาเดียวกัน';
  end if;

  if exists (
    select 1
    from public.export_vehicle_weigh_bill_reservations r
    where r.rubber_export_id = any(v_ids)
      and (p_wex_id is null or r.wex_id <> p_wex_id)
  ) then
    raise exception 'WEX_REX_RESERVED: มีรายการขายยางถูกจองในบิลรถส่งออกอื่นแล้ว';
  end if;

  return v_weight;
end;
$$;

create function public.create_export_vehicle_weigh_bill(
  p_location_id uuid,
  p_lines jsonb,
  p_rubber_export_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.profiles%rowtype;
  v_now timestamptz := clock_timestamp();
  v_wex_date date;
  v_sequence_no integer;
  v_wex_no text;
  v_wex_id uuid;
  v_vehicle_net numeric(14,2);
  v_rubber_weight numeric(14,2);
begin
  if p_location_id is null or not private.can_manage_reports(p_location_id)
     or not exists (
       select 1 from public.locations l
       where l.id = p_location_id and l.is_active = true
     ) then
    raise exception 'WEX_FORBIDDEN: ไม่มีสิทธิ์สร้างบิลรถส่งออกของสาขานี้';
  end if;

  perform 1 from private.normalized_export_vehicle_weigh_lines(p_location_id, p_lines);
  v_rubber_weight := private.validate_wex_rubber_exports(
    p_location_id, null, p_rubber_export_ids
  );

  select * into v_actor
  from public.profiles p
  where p.id = auth.uid() and p.is_active = true;
  if v_actor.id is null then
    raise exception 'WEX_FORBIDDEN: บัญชีผู้ใช้ไม่พร้อมใช้งาน';
  end if;

  v_wex_date := (v_now at time zone 'Asia/Bangkok')::date;
  perform pg_advisory_xact_lock(hashtextextended(
    'export-vehicle-weigh-bill:' || p_location_id::text || ':' || v_wex_date::text, 0
  ));
  v_sequence_no := private.next_document_sequence('WEX', p_location_id, v_wex_date);
  v_wex_no := 'WEX-' || to_char(v_wex_date, 'YYYYMMDD') || '-'
    || lpad(v_sequence_no::text, 3, '0');

  insert into public.export_vehicle_weigh_bills (
    wex_no, wex_date, sequence_no, location_id, revision,
    created_by_user_id, created_by_name, created_at,
    updated_by_user_id, updated_by_name, updated_at
  ) values (
    v_wex_no, v_wex_date, v_sequence_no, p_location_id, 1,
    v_actor.id, v_actor.name, v_now,
    v_actor.id, v_actor.name, v_now
  ) returning id into v_wex_id;

  insert into public.export_vehicle_weigh_lines (
    wex_id, sequence_no, vehicle_registration, carrier_id, carrier_name,
    inbound_at, inbound_weight, outbound_at, outbound_weight
  )
  select
    v_wex_id, l.sequence_no, l.vehicle_registration, l.carrier_id, l.carrier_name,
    l.inbound_at, l.inbound_weight, l.outbound_at, l.outbound_weight
  from private.normalized_export_vehicle_weigh_lines(p_location_id, p_lines) l;

  select round(sum(l.outbound_weight - l.inbound_weight), 2)
  into v_vehicle_net
  from public.export_vehicle_weigh_lines l
  where l.wex_id = v_wex_id;

  if v_rubber_weight > v_vehicle_net then
    raise exception 'WEX_OVERWEIGHT: น้ำหนักรายการขายยางรวมเกินน้ำหนักสุทธิรถ';
  end if;

  insert into public.export_vehicle_weigh_bill_reservations (
    wex_id, rubber_export_id, sequence_no, export_no, current_weight, created_at
  )
  select
    v_wex_id, e.id, selected.ordinality::integer, e.export_no, e.current_weight, v_now
  from unnest(coalesce(p_rubber_export_ids, array[]::uuid[]))
    with ordinality as selected(id, ordinality)
  join public.rubber_exports e on e.id = selected.id
  order by selected.ordinality;

  return jsonb_build_object('id', v_wex_id, 'wexNo', v_wex_no, 'revision', 1);
exception
  when unique_violation then
    raise exception 'WEX_REX_RESERVED: มีรายการขายยางถูกจองในบิลรถส่งออกอื่นแล้ว';
end;
$$;

create function public.update_export_vehicle_weigh_bill(
  p_wex_id uuid,
  p_expected_revision integer,
  p_lines jsonb,
  p_rubber_export_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wex public.export_vehicle_weigh_bills%rowtype;
  v_actor public.profiles%rowtype;
  v_now timestamptz := clock_timestamp();
  v_vehicle_net numeric(14,2);
  v_rubber_weight numeric(14,2);
  v_lock_ids uuid[];
begin
  select * into v_wex
  from public.export_vehicle_weigh_bills w
  where w.id = p_wex_id
  for update;
  if v_wex.id is null then
    raise exception 'WEX_NOT_FOUND: ไม่พบบิลรถส่งออก';
  end if;
  if not private.can_manage_reports(v_wex.location_id) then
    raise exception 'WEX_FORBIDDEN: ไม่มีสิทธิ์แก้ไขบิลรถส่งออกของสาขานี้';
  end if;
  if p_expected_revision is null or p_expected_revision <> v_wex.revision then
    raise exception 'WEX_STALE_REVISION: บิลรถส่งออกถูกแก้ไขแล้ว กรุณาโหลดข้อมูลใหม่';
  end if;

  perform 1 from private.normalized_export_vehicle_weigh_lines(v_wex.location_id, p_lines);
  select coalesce(array_agg(distinct id order by id), array[]::uuid[])
  into v_lock_ids
  from (
    select unnest(coalesce(p_rubber_export_ids, array[]::uuid[])) as id
    union
    select r.rubber_export_id
    from public.export_vehicle_weigh_bill_reservations r
    where r.wex_id = v_wex.id
  ) locked;
  perform e.id
  from public.rubber_exports e
  where e.id = any(v_lock_ids)
  order by e.id
  for update;

  v_rubber_weight := private.validate_wex_rubber_exports(
    v_wex.location_id, v_wex.id, p_rubber_export_ids
  );
  select * into v_actor
  from public.profiles p
  where p.id = auth.uid() and p.is_active = true;
  if v_actor.id is null then
    raise exception 'WEX_FORBIDDEN: บัญชีผู้ใช้ไม่พร้อมใช้งาน';
  end if;

  delete from public.export_vehicle_weigh_bill_reservations
  where wex_id = v_wex.id;
  delete from public.export_vehicle_weigh_lines
  where wex_id = v_wex.id;

  insert into public.export_vehicle_weigh_lines (
    wex_id, sequence_no, vehicle_registration, carrier_id, carrier_name,
    inbound_at, inbound_weight, outbound_at, outbound_weight
  )
  select
    v_wex.id, l.sequence_no, l.vehicle_registration, l.carrier_id, l.carrier_name,
    l.inbound_at, l.inbound_weight, l.outbound_at, l.outbound_weight
  from private.normalized_export_vehicle_weigh_lines(v_wex.location_id, p_lines) l;

  select round(sum(l.outbound_weight - l.inbound_weight), 2)
  into v_vehicle_net
  from public.export_vehicle_weigh_lines l
  where l.wex_id = v_wex.id;

  if v_rubber_weight > v_vehicle_net then
    raise exception 'WEX_OVERWEIGHT: น้ำหนักรายการขายยางรวมเกินน้ำหนักสุทธิรถ';
  end if;

  insert into public.export_vehicle_weigh_bill_reservations (
    wex_id, rubber_export_id, sequence_no, export_no, current_weight, created_at
  )
  select
    v_wex.id, e.id, selected.ordinality::integer, e.export_no, e.current_weight, v_now
  from unnest(coalesce(p_rubber_export_ids, array[]::uuid[]))
    with ordinality as selected(id, ordinality)
  join public.rubber_exports e on e.id = selected.id
  order by selected.ordinality;

  update public.export_vehicle_weigh_bills
  set revision = revision + 1,
      updated_by_user_id = v_actor.id,
      updated_by_name = v_actor.name,
      updated_at = v_now
  where id = v_wex.id
  returning revision into v_wex.revision;

  return jsonb_build_object(
    'id', v_wex.id, 'wexNo', v_wex.wex_no, 'revision', v_wex.revision
  );
exception
  when unique_violation then
    raise exception 'WEX_REX_RESERVED: มีรายการขายยางถูกจองในบิลรถส่งออกอื่นแล้ว';
end;
$$;

create function public.delete_export_vehicle_weigh_bill(
  p_wex_id uuid,
  p_expected_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wex public.export_vehicle_weigh_bills%rowtype;
  v_audit public.document_deletion_audits%rowtype;
  v_actor_name text;
  v_now timestamptz := clock_timestamp();
begin
  if not private.can_delete_reports() then
    raise exception 'WEX_FORBIDDEN: เฉพาะ super_admin หรือผู้จัดการระบบเท่านั้นที่ลบบิลรถส่งออกได้';
  end if;

  select * into v_wex
  from public.export_vehicle_weigh_bills w
  where w.id = p_wex_id
  for update;

  if v_wex.id is null then
    select * into v_audit
    from public.document_deletion_audits a
    where a.document_kind = 'export_vehicle_weigh_bill'
      and a.source_id = p_wex_id;
    if v_audit.id is not null then
      return jsonb_build_object(
        'id', p_wex_id, 'wexNo', v_audit.document_no, 'status', 'deleted'
      );
    end if;
    raise exception 'WEX_NOT_FOUND: ไม่พบบิลรถส่งออก';
  end if;

  if p_expected_revision is null or p_expected_revision <> v_wex.revision then
    raise exception 'WEX_STALE_REVISION: บิลรถส่งออกถูกแก้ไขแล้ว กรุณาโหลดข้อมูลใหม่';
  end if;

  select p.name into v_actor_name
  from public.profiles p
  where p.id = auth.uid() and p.is_active = true;
  if nullif(btrim(v_actor_name), '') is null then
    raise exception 'WEX_FORBIDDEN: บัญชีผู้ใช้ไม่พร้อมใช้งาน';
  end if;

  insert into public.document_deletion_audits (
    document_kind, source_id, document_no, location_id,
    deleted_by_user_id, deleted_by_name, deleted_at
  ) values (
    'export_vehicle_weigh_bill', v_wex.id, v_wex.wex_no, v_wex.location_id,
    auth.uid(), v_actor_name, v_now
  );

  delete from public.export_vehicle_weigh_bill_reservations
  where wex_id = v_wex.id;
  delete from public.export_vehicle_weigh_lines
  where wex_id = v_wex.id;
  delete from public.export_vehicle_weigh_bills
  where id = v_wex.id;

  return jsonb_build_object(
    'id', v_wex.id, 'wexNo', v_wex.wex_no, 'status', 'deleted'
  );
end;
$$;

create function public.get_export_vehicle_weigh_bill_options(
  p_location_id uuid,
  p_wex_id uuid default null
)
returns table (
  rubber_export_id uuid,
  export_no text,
  current_weight numeric,
  reserved_by_current_wex boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_wex_location_id uuid;
begin
  if p_location_id is null or not private.can_manage_reports(p_location_id) then
    raise exception 'WEX_FORBIDDEN: ไม่มีสิทธิ์ดูรายการขายยางของสาขานี้';
  end if;
  if p_wex_id is not null then
    select w.location_id into v_wex_location_id
    from public.export_vehicle_weigh_bills w
    where w.id = p_wex_id;
    if v_wex_location_id is null then
      raise exception 'WEX_NOT_FOUND: ไม่พบบิลรถส่งออก';
    end if;
    if v_wex_location_id <> p_location_id then
      raise exception 'WEX_FORBIDDEN: บิลรถส่งออกไม่อยู่ในสาขานี้';
    end if;
  end if;

  return query
  select
    e.id, e.export_no, e.current_weight,
    coalesce(r.wex_id = p_wex_id, false)
  from public.rubber_exports e
  left join public.export_vehicle_weigh_bill_reservations r
    on r.rubber_export_id = e.id
  where e.location_id = p_location_id
    and e.status = 'verified'
    and e.sold_out_at is not null
    and e.current_weight is not null
    and e.current_weight > 0
    and (r.id is null or r.wex_id = p_wex_id)
  order by e.sold_out_at desc, e.id desc;
end;
$$;

create function public.get_export_vehicle_weigh_bill_detail(p_wex_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_wex public.export_vehicle_weigh_bills%rowtype;
  v_location_name text;
  v_vehicle_count integer;
  v_rubber_export_count integer;
  v_vehicle_net numeric(14,2);
  v_reserved_weight numeric(14,2);
  v_lines jsonb;
  v_rubber_exports jsonb;
begin
  select * into v_wex
  from public.export_vehicle_weigh_bills w
  where w.id = p_wex_id;
  if v_wex.id is null then
    raise exception 'WEX_NOT_FOUND: ไม่พบบิลรถส่งออก';
  end if;
  if not private.can_manage_reports(v_wex.location_id) then
    raise exception 'WEX_FORBIDDEN: ไม่มีสิทธิ์ดูบิลรถส่งออกของสาขานี้';
  end if;

  select l.name into v_location_name
  from public.locations l where l.id = v_wex.location_id;
  select count(*)::integer, coalesce(round(sum(l.net_weight), 2), 0),
    coalesce(jsonb_agg(jsonb_build_object(
      'id', l.id,
      'sequenceNo', l.sequence_no,
      'vehicleRegistration', l.vehicle_registration,
      'carrierId', l.carrier_id,
      'carrierName', l.carrier_name,
      'inboundAt', l.inbound_at,
      'inboundWeight', l.inbound_weight,
      'outboundAt', l.outbound_at,
      'outboundWeight', l.outbound_weight,
      'netWeight', l.net_weight
    ) order by l.sequence_no), '[]'::jsonb)
  into v_vehicle_count, v_vehicle_net, v_lines
  from public.export_vehicle_weigh_lines l
  where l.wex_id = v_wex.id;

  select count(*)::integer, coalesce(round(sum(r.current_weight), 2), 0),
    coalesce(jsonb_agg(jsonb_build_object(
      'rubberExportId', r.rubber_export_id,
      'exportNo', r.export_no,
      'currentWeight', r.current_weight
    ) order by r.sequence_no), '[]'::jsonb)
  into v_rubber_export_count, v_reserved_weight, v_rubber_exports
  from public.export_vehicle_weigh_bill_reservations r
  where r.wex_id = v_wex.id;

  return jsonb_build_object(
    'id', v_wex.id,
    'wexNo', v_wex.wex_no,
    'locationId', v_wex.location_id,
    'locationName', v_location_name,
    'revision', v_wex.revision,
    'vehicleCount', v_vehicle_count,
    'rubberExportCount', v_rubber_export_count,
    'vehicleNetWeight', v_vehicle_net,
    'reservedRubberWeight', v_reserved_weight,
    'remainingWeight', v_vehicle_net - v_reserved_weight,
    'createdByName', v_wex.created_by_name,
    'createdAt', v_wex.created_at,
    'updatedAt', v_wex.updated_at,
    'lines', v_lines,
    'rubberExports', v_rubber_exports
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
    if exists (
      select 1
      from public.export_vehicle_weigh_bill_reservations r
      where r.rubber_export_id = v_export.id
    ) then
      raise exception 'WEX_RESERVATION_LOCKED: รายการขายยางถูกจองโดยบิลรถส่งออก:%', v_export.export_no
        using errcode = 'P0001',
          hint = 'กรุณาถอดรายการขายยางออกจากบิลรถส่งออกก่อน';
    end if;
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

alter table public.export_vehicle_weigh_bills enable row level security;
alter table public.export_vehicle_weigh_lines enable row level security;
alter table public.export_vehicle_weigh_bill_reservations enable row level security;

create policy export_vehicle_weigh_bills_scoped_read
  on public.export_vehicle_weigh_bills
  for select to authenticated
  using (private.can_manage_reports(location_id));

create policy export_vehicle_weigh_lines_scoped_read
  on public.export_vehicle_weigh_lines
  for select to authenticated
  using (exists (
    select 1 from public.export_vehicle_weigh_bills w
    where w.id = export_vehicle_weigh_lines.wex_id
      and private.can_manage_reports(w.location_id)
  ));

create policy export_vehicle_weigh_bill_reservations_scoped_read
  on public.export_vehicle_weigh_bill_reservations
  for select to authenticated
  using (exists (
    select 1 from public.export_vehicle_weigh_bills w
    where w.id = export_vehicle_weigh_bill_reservations.wex_id
      and private.can_manage_reports(w.location_id)
  ));

revoke all on table public.export_vehicle_weigh_bills,
  public.export_vehicle_weigh_lines,
  public.export_vehicle_weigh_bill_reservations
from public, anon, authenticated;
grant select on table public.export_vehicle_weigh_bills,
  public.export_vehicle_weigh_lines,
  public.export_vehicle_weigh_bill_reservations
to authenticated;
grant all on table public.export_vehicle_weigh_bills,
  public.export_vehicle_weigh_lines,
  public.export_vehicle_weigh_bill_reservations
to service_role;

revoke all on function private.normalized_export_vehicle_weigh_lines(uuid, jsonb),
  private.validate_wex_rubber_exports(uuid, uuid, uuid[])
from public, anon, authenticated;

revoke all on function public.create_export_vehicle_weigh_bill(uuid, jsonb, uuid[]),
  public.update_export_vehicle_weigh_bill(uuid, integer, jsonb, uuid[]),
  public.delete_export_vehicle_weigh_bill(uuid, integer),
  public.get_export_vehicle_weigh_bill_options(uuid, uuid),
  public.get_export_vehicle_weigh_bill_detail(uuid)
from public, anon;

grant execute on function public.create_export_vehicle_weigh_bill(uuid, jsonb, uuid[]),
  public.update_export_vehicle_weigh_bill(uuid, integer, jsonb, uuid[]),
  public.delete_export_vehicle_weigh_bill(uuid, integer),
  public.get_export_vehicle_weigh_bill_options(uuid, uuid),
  public.get_export_vehicle_weigh_bill_detail(uuid)
to authenticated;

notify pgrst, 'reload schema';

commit;
