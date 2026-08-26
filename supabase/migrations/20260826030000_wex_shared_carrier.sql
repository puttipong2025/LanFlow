begin;

-- A WEX has one carrier snapshot per trip. The truck is authoritative and an
-- optional tail-trailer mirrors that snapshot regardless of caller input.
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
  v_shared_carrier_id uuid;
  v_shared_carrier_name text;
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

  v_shared_carrier_id := nullif(btrim(p_lines->0->>'carrierId'), '')::uuid;
  if v_shared_carrier_id is not null then
    select s.id, s.main_name
    into v_shared_carrier_id, v_shared_carrier_name
    from public.transport_staffs s
    where s.id = v_shared_carrier_id
      and s.record_status = 'active'
      and (s.default_location_id is null or s.default_location_id = p_location_id)
    for share of s;

    if not found then
      raise exception 'WEX_CARRIER_INELIGIBLE: เลือกได้เฉพาะผู้ขนส่งที่ใช้งานอยู่และมีสิทธิ์ในสาขานี้';
    end if;
  else
    v_shared_carrier_name := nullif(
      regexp_replace(btrim(p_lines->0->>'carrierName'), '\s+', ' ', 'g'),
      ''
    );
  end if;

  return query
  select
    line.ordinality::integer,
    regexp_replace(btrim(line.value->>'vehicleRegistration'), '\s+', ' ', 'g'),
    v_shared_carrier_id,
    v_shared_carrier_name,
    (line.value->>'inboundAt')::timestamptz,
    round((line.value->>'inboundWeight')::numeric, 2),
    case
      when round((line.value->>'outboundWeight')::numeric, 2) = 0 then null
      else nullif(btrim(line.value->>'outboundAt'), '')::timestamptz
    end,
    round((line.value->>'outboundWeight')::numeric, 2)
  from jsonb_array_elements(p_lines) with ordinality as line(value, ordinality)
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

revoke all on function private.normalized_export_vehicle_weigh_lines(uuid, jsonb)
from public, anon, authenticated;

commit;
