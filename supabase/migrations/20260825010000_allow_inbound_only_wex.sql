begin;

alter table public.export_vehicle_weigh_lines
  drop constraint if exists export_vehicle_weigh_lines_outbound_weight_check;
alter table public.export_vehicle_weigh_lines
  drop constraint if exists export_vehicle_weigh_lines_outbound_at_check;
alter table public.export_vehicle_weigh_lines
  drop constraint if exists export_vehicle_weigh_lines_check;
alter table public.export_vehicle_weigh_lines
  alter column outbound_at drop not null;
alter table public.export_vehicle_weigh_lines
  add constraint export_vehicle_weigh_lines_outbound_weight_state_check
  check (outbound_weight = 0 or outbound_weight > inbound_weight);
alter table public.export_vehicle_weigh_lines
  add constraint export_vehicle_weigh_lines_outbound_time_state_check
  check (
    (outbound_weight = 0 and outbound_at is null)
    or (
      outbound_weight > inbound_weight
      and outbound_at is not null
      and outbound_at > inbound_at
    )
  );
alter table public.export_vehicle_weigh_lines
  drop column net_weight;
alter table public.export_vehicle_weigh_lines
  add column net_weight numeric(14,2)
  generated always as (
    case
      when outbound_weight = 0 then 0::numeric
      else outbound_weight - inbound_weight
    end
  ) stored;

comment on column public.export_vehicle_weigh_lines.outbound_weight is
  'Zero means the vehicle has checked in but has not completed outbound weighing.';
comment on column public.export_vehicle_weigh_lines.outbound_at is
  'Null while outbound_weight is zero; required and later than inbound_at after checkout.';
comment on column public.export_vehicle_weigh_lines.net_weight is
  'Server-derived zero while checkout is pending, otherwise outbound_weight minus inbound_weight.';

create or replace function private.normalized_export_vehicle_weigh_lines(
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
      or jsonb_typeof(line.value->'inboundAt') <> 'string'
      or jsonb_typeof(line.value->'inboundWeight') <> 'number'
      or jsonb_typeof(line.value->'outboundWeight') <> 'number'
      or (
        line.value ? 'outboundAt'
        and jsonb_typeof(line.value->'outboundAt') not in ('string', 'null')
      )
  ) then
    raise exception 'WEX_INVALID_LINES: รูปแบบเวลา น้ำหนัก ทะเบียนรถ หรือผู้ขนส่งไม่ถูกต้อง';
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
    case
      when round((line.value->>'outboundWeight')::numeric, 2) = 0 then null
      else nullif(btrim(line.value->>'outboundAt'), '')::timestamptz
    end,
    round((line.value->>'outboundWeight')::numeric, 2)
  from jsonb_array_elements(p_lines) with ordinality as line(value, ordinality)
  left join public.transport_staffs s
    on s.id = nullif(btrim(line.value->>'carrierId'), '')::uuid
  where round((line.value->>'inboundWeight')::numeric, 2) > 0
    and round((line.value->>'outboundWeight')::numeric, 2) >= 0
    and (
      (
        round((line.value->>'outboundWeight')::numeric, 2) = 0
        and nullif(btrim(line.value->>'outboundAt'), '') is null
      )
      or (
        round((line.value->>'outboundWeight')::numeric, 2)
          > round((line.value->>'inboundWeight')::numeric, 2)
        and nullif(btrim(line.value->>'outboundAt'), '')::timestamptz
          > (line.value->>'inboundAt')::timestamptz
      )
    )
  order by line.ordinality;

  get diagnostics v_count = row_count;
  if v_count <> jsonb_array_length(p_lines) then
    raise exception 'WEX_INVALID_LINES: น้ำหนักออกต้องเป็น 0 ระหว่างรอ หรือมากกว่าน้ำหนักเข้าเมื่อชั่งออกแล้ว';
  end if;
exception
  when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
    raise exception 'WEX_INVALID_LINES: รูปแบบเวลา น้ำหนัก หรือทะเบียนรถไม่ถูกต้อง';
end;
$$;

create or replace function private.enforce_complete_wex_before_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.export_vehicle_weigh_lines l
    where l.wex_id = new.wex_id
      and (l.outbound_weight = 0 or l.outbound_at is null)
  ) then
    raise exception 'WEX_INCOMPLETE_WEIGHING: ต้องชั่งออกรถทุกคันก่อนเลือกรายการขายยาง';
  end if;
  return new;
end;
$$;

drop trigger if exists export_vehicle_weigh_reservation_complete_guard
  on public.export_vehicle_weigh_bill_reservations;
create trigger export_vehicle_weigh_reservation_complete_guard
before insert or update of wex_id
on public.export_vehicle_weigh_bill_reservations
for each row execute function private.enforce_complete_wex_before_reservation();

revoke all on function private.enforce_complete_wex_before_reservation()
from public, anon, authenticated;

-- Pending lines contribute zero net weight until checkout is complete.
create or replace function public.create_export_vehicle_weigh_bill(
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

  select round(sum(l.net_weight), 2)
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

create or replace function public.update_export_vehicle_weigh_bill(
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

  select round(sum(l.net_weight), 2)
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

notify pgrst, 'reload schema';

commit;
