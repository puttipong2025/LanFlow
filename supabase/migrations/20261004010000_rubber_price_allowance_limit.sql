-- Add one system-wide ceiling for grouped and ungrouped Rubber price allowances.

alter table public.rubber_bill_approval_settings
  add column max_price_allowance numeric(12,2);

update public.rubber_bill_approval_settings settings
set max_price_allowance = greatest(
  settings.ungrouped_price_allowance,
  coalesce((select max(groups.price_allowance) from public.rubber_approval_groups groups), 0)
)
where settings.id = true;

alter table public.rubber_bill_approval_settings
  alter column max_price_allowance set not null,
  add constraint rubber_bill_approval_max_allowance_check
    check (max_price_allowance >= 0 and scale(max_price_allowance) <= 2);

create or replace function public.list_rubber_approval_groups()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_groups jsonb;
  v_ungrouped_location_ids jsonb;
  v_settings public.rubber_bill_approval_settings%rowtype;
begin
  if not private.is_active_user() or not private.can_access_super_admin_features() then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์จัดการกลุ่มอนุมัติบิลยาง';
  end if;

  select * into v_settings
  from public.rubber_bill_approval_settings
  where id = true;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', grouped.id,
    'locationIds', grouped.location_ids,
    'editWindowMinutes', grouped.edit_window_minutes,
    'priceAllowance', grouped.price_allowance,
    'revisionNo', grouped.revision_no,
    'updatedByName', grouped.updated_by_name,
    'updatedByPhone', grouped.updated_by_phone,
    'updatedAt', grouped.updated_at
  ) order by grouped.created_at, grouped.id), '[]'::jsonb)
  into v_groups
  from (
    select g.id, g.edit_window_minutes, g.price_allowance, g.revision_no,
      g.updated_by_name, g.updated_by_phone, g.created_at, g.updated_at,
      to_jsonb(array_agg(gl.location_id order by l.name, gl.location_id)) location_ids
    from public.rubber_approval_groups g
    join public.rubber_approval_group_locations gl on gl.group_id = g.id
    join public.locations l on l.id = gl.location_id
    group by g.id
  ) grouped;

  select coalesce(jsonb_agg(l.id order by l.name, l.id), '[]'::jsonb)
  into v_ungrouped_location_ids
  from public.locations l
  where l.is_active = true
    and not exists (
      select 1 from public.rubber_approval_group_locations gl
      where gl.location_id = l.id
    );

  return jsonb_build_object(
    'groups', v_groups,
    'availableLocationIds', v_ungrouped_location_ids,
    'centralPrice', jsonb_build_object(
      'value', v_settings.central_price,
      'revision', v_settings.central_price_revision,
      'updatedByName', v_settings.central_price_updated_by_name,
      'updatedByPhone', v_settings.central_price_updated_by_phone,
      'updatedAt', v_settings.central_price_updated_at
    ),
    'ungroupedDefaults', jsonb_build_object(
      'locationIds', v_ungrouped_location_ids,
      'editWindowMinutes', v_settings.ungrouped_edit_window_minutes,
      'priceAllowance', v_settings.ungrouped_price_allowance,
      'revision', v_settings.ungrouped_revision,
      'updatedByName', v_settings.ungrouped_updated_by_name,
      'updatedByPhone', v_settings.ungrouped_updated_by_phone,
      'updatedAt', v_settings.ungrouped_updated_at
    ),
    'quota', jsonb_build_object(
      'limitPerAdmin', v_settings.quota_limit_per_admin,
      'maxPriceAllowance', v_settings.max_price_allowance,
      'roundId', v_settings.quota_round_id,
      'updatedByName', v_settings.quota_updated_by_name,
      'updatedByPhone', v_settings.quota_updated_by_phone,
      'updatedAt', v_settings.quota_updated_at
    )
  );
end
$$;

create or replace function private.validate_rubber_effective_price_cap(
  p_central_price numeric,
  p_price_allowance numeric
)
returns numeric
language plpgsql
stable
set search_path = ''
as $$
declare
  v_max_price_allowance numeric;
  v_effective_price_cap numeric := p_central_price + p_price_allowance;
begin
  select settings.max_price_allowance into v_max_price_allowance
  from public.rubber_bill_approval_settings settings
  where settings.id = true;

  if p_price_allowance > v_max_price_allowance then
    raise exception 'RUBBER_ALLOWANCE_LIMIT_EXCEEDED: ราคายางที่กำหนดเกินค่าสูงสุด กรุณาเพิ่มเพดานส่วนต่างราคายางก่อน';
  end if;
  if p_central_price + v_max_price_allowance > 9999999999.99 then
    raise exception 'RUBBER_EFFECTIVE_PRICE_CAP_INVALID: ราคากลางรวมส่วนต่างต้องไม่เกิน 9,999,999,999.99 บาท';
  end if;
  return v_effective_price_cap;
end
$$;

create or replace function public.save_rubber_admin_quota_v2(
  p_quota_limit integer,
  p_max_price_allowance numeric,
  p_expected_round_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.rubber_bill_approval_settings%rowtype;
  v_actor public.profiles%rowtype;
  v_current_max_allowance numeric;
begin
  if not private.is_active_user() or not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active = true and p.role = 'super_admin'
  ) then
    raise exception 'FORBIDDEN: เฉพาะ super admin เท่านั้นที่ตั้งโควต้าและเพดานส่วนต่างราคาได้';
  end if;
  if p_quota_limit is null or p_quota_limit < 0 then
    raise exception 'RUBBER_QUOTA_INVALID: จำนวนโควต้าต้องเป็นจำนวนเต็มตั้งแต่ 0 ขึ้นไป';
  end if;
  if p_max_price_allowance is null
     or p_max_price_allowance < 0
     or scale(p_max_price_allowance) > 2 then
    raise exception 'RUBBER_ALLOWANCE_INVALID: ราคายางที่กำหนดสูงสุดต้องไม่ติดลบและมีทศนิยมไม่เกิน 2 ตำแหน่ง';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('rubber-approval-policy', 0));
  select * into v_settings
  from public.rubber_bill_approval_settings where id = true for update;

  if v_settings.quota_round_id <> p_expected_round_id then
    raise exception 'RUBBER_QUOTA_STALE: การตั้งค่าโควต้าถูกแก้ไขโดยผู้ใช้อื่น';
  end if;

  select greatest(
    v_settings.ungrouped_price_allowance,
    coalesce(max(groups.price_allowance), 0)
  ) into v_current_max_allowance
  from public.rubber_approval_groups groups;

  if p_max_price_allowance < v_current_max_allowance then
    raise exception 'RUBBER_ALLOWANCE_LIMIT_TOO_LOW: ราคายางที่กำหนดสูงสุดต้องไม่น้อยกว่าค่าที่กลุ่มหรือสาขาที่ยังไม่จัดกลุ่มใช้อยู่';
  end if;
  if v_settings.central_price + p_max_price_allowance > 9999999999.99 then
    raise exception 'RUBBER_EFFECTIVE_PRICE_CAP_INVALID: ราคากลางรวมส่วนต่างต้องไม่เกิน 9,999,999,999.99 บาท';
  end if;

  select * into v_actor from public.profiles p where p.id = auth.uid();
  update public.rubber_bill_approval_settings
  set quota_limit_per_admin = p_quota_limit,
      max_price_allowance = p_max_price_allowance,
      quota_round_id = gen_random_uuid(),
      quota_updated_by_user_id = auth.uid(),
      quota_updated_by_name = v_actor.name,
      quota_updated_by_phone = v_actor.phone,
      quota_updated_at = clock_timestamp()
  where id = true;

  return public.list_rubber_approval_groups();
end
$$;

revoke all on function public.save_rubber_admin_quota_v2(integer, numeric, uuid) from public, anon;
grant execute on function public.save_rubber_admin_quota_v2(integer, numeric, uuid) to authenticated;

revoke all on function private.validate_rubber_effective_price_cap(numeric, numeric)
  from public, anon, authenticated;
