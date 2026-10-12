-- Profile management edits only active branch assignments. Inactive assignments
-- are historical records retained for audit and possible branch reactivation.

create or replace function public.update_admin_user_profile(
  p_user_id uuid,
  p_name text,
  p_location_ids uuid[],
  p_primary_location_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text;
  v_target public.profiles%rowtype;
  v_normalized_name text;
  v_location_ids uuid[];
  v_old_location_ids uuid[];
  v_old_primary_location_id uuid;
  v_inactive_fallback_location_id uuid;
  v_old_data jsonb;
  v_new_data jsonb;
  v_audit_id uuid;
  v_can_manage_system boolean;
begin
  if v_actor_id is null or not private.is_active_user() then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์จัดการพนักงาน';
  end if;
  if p_user_id is null or p_user_id = v_actor_id then
    raise exception 'FORBIDDEN: ไม่สามารถแก้ข้อมูลบัญชีของตัวเองได้';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('admin-profile:' || p_user_id::text, 0));
  select * into v_target from public.profiles p where p.id = p_user_id for update;
  if v_target.id is null then
    raise exception 'ADMIN_USER_NOT_FOUND: ไม่พบบัญชีพนักงาน';
  end if;
  if v_target.role = 'super_admin' or not v_target.is_active then
    raise exception 'FORBIDDEN: บัญชีนี้ไม่สามารถแก้ข้อมูลได้';
  end if;

  v_normalized_name := regexp_replace(btrim(coalesce(p_name, '')), '[[:space:]]+', ' ', 'g');
  if v_normalized_name = '' or char_length(v_normalized_name) > 100 then
    raise exception 'ADMIN_PROFILE_INVALID: ชื่อพนักงานต้องมี 1-100 ตัวอักษร';
  end if;

  if coalesce(cardinality(p_location_ids), 0) <> (
    select count(distinct location_id)
    from unnest(coalesce(p_location_ids, array[]::uuid[])) location_id
    where location_id is not null
  ) then
    raise exception 'ADMIN_PROFILE_INVALID: รายการสาขาซ้ำหรือไม่ถูกต้อง';
  end if;
  select coalesce(array_agg(location_id order by location_id), array[]::uuid[])
    into v_location_ids
  from unnest(coalesce(p_location_ids, array[]::uuid[])) location_id;

  if cardinality(v_location_ids) = 0 and p_primary_location_id is not null then
    raise exception 'ADMIN_PROFILE_INVALID: บัญชีไม่มีสาขาต้องไม่มีสาขาหลัก';
  end if;
  if cardinality(v_location_ids) > 0
     and (p_primary_location_id is null or not p_primary_location_id = any(v_location_ids)) then
    raise exception 'ADMIN_PROFILE_INVALID: ต้องเลือกสาขาหลักหนึ่งสาขาจากสาขาที่มอบหมาย';
  end if;
  if exists (
    select 1 from unnest(v_location_ids) requested(location_id)
    left join public.locations l on l.id = requested.location_id and l.is_active = true
    where l.id is null
  ) then
    raise exception 'ADMIN_PROFILE_INVALID: มีสาขาที่ไม่พร้อมใช้งาน';
  end if;

  select p.role into v_actor_role from public.profiles p where p.id = v_actor_id;
  v_can_manage_system := private.can_access_super_admin_features();
  if not v_can_manage_system then
    if v_actor_role <> 'admin' or v_target.role <> 'user'
       or not private.can_manage_profile(p_user_id) then
      raise exception 'FORBIDDEN: ไม่มีสิทธิ์จัดการพนักงานคนนี้';
    end if;
    if v_normalized_name <> v_target.name then
      raise exception 'FORBIDDEN: Admin ทั่วไปไม่มีสิทธิ์เปลี่ยนชื่อพนักงาน';
    end if;
  end if;

  select
    coalesce(array_agg(ul.location_id order by ul.location_id), array[]::uuid[]),
    (array_agg(ul.location_id) filter (where ul.is_primary))[1]
  into v_old_location_ids, v_old_primary_location_id
  from public.user_locations ul
  join public.locations l on l.id = ul.location_id and l.is_active = true
  where ul.user_id = p_user_id;

  select ul.location_id
  into v_inactive_fallback_location_id
  from public.user_locations ul
  join public.locations l on l.id = ul.location_id and l.is_active = false
  where ul.user_id = p_user_id
  order by ul.is_primary desc, ul.created_at, ul.location_id
  limit 1;

  if not v_can_manage_system then
    if exists (
      select changed.location_id
      from (
        (select unnest(v_old_location_ids) location_id
         except select unnest(v_location_ids))
        union
        (select unnest(v_location_ids)
         except select unnest(v_old_location_ids))
      ) changed
      where not private.can_manage_location(changed.location_id)
    ) then
      raise exception 'FORBIDDEN: ไม่มีสิทธิ์เปลี่ยนสาขานอกขอบเขตของ Admin';
    end if;
    if v_old_primary_location_id is not null
       and v_old_primary_location_id is distinct from p_primary_location_id then
      raise exception 'FORBIDDEN: Admin ทั่วไปไม่มีสิทธิ์ย้ายสาขาหลักเดิม';
    end if;
    if v_old_primary_location_id is null
       and p_primary_location_id is not null
       and not private.can_manage_location(p_primary_location_id) then
      raise exception 'FORBIDDEN: ไม่มีสิทธิ์กำหนดสาขาหลักนอกขอบเขตของ Admin';
    end if;
  end if;

  v_old_data := jsonb_build_object(
    'name', v_target.name,
    'locationIds', to_jsonb(v_old_location_ids),
    'primaryLocationId', v_old_primary_location_id
  );

  update public.profiles
  set name = v_normalized_name, updated_at = now()
  where id = p_user_id;

  update public.user_locations set is_primary = false where user_id = p_user_id;
  delete from public.user_locations ul
  using public.locations l
  where ul.user_id = p_user_id
    and l.id = ul.location_id
    and l.is_active = true
    and not (ul.location_id = any(v_location_ids));
  insert into public.user_locations (user_id, location_id, assigned_by, is_primary)
  select p_user_id, location_id, v_actor_id, false
  from unnest(v_location_ids) location_id
  on conflict (user_id, location_id) do nothing;
  if p_primary_location_id is not null then
    update public.user_locations
    set is_primary = true
    where user_id = p_user_id and location_id = p_primary_location_id;
  elsif v_inactive_fallback_location_id is not null then
    update public.user_locations
    set is_primary = true
    where user_id = p_user_id and location_id = v_inactive_fallback_location_id;
  end if;

  v_new_data := jsonb_build_object(
    'name', v_normalized_name,
    'locationIds', to_jsonb(v_location_ids),
    'primaryLocationId', p_primary_location_id
  );
  insert into public.admin_account_audit_logs (
    actor_user_id, target_user_id, action, status,
    old_data, new_data, completed_at
  ) values (
    v_actor_id, p_user_id, 'profile_update', 'succeeded',
    v_old_data, v_new_data, now()
  ) returning id into v_audit_id;

  return jsonb_build_object(
    'user', jsonb_build_object(
      'id', v_target.id,
      'phone', v_target.phone,
      'name', v_normalized_name,
      'role', v_target.role,
      'isActive', v_target.is_active,
      'locationIds', to_jsonb(v_location_ids),
      'primaryLocationId', p_primary_location_id,
      'canAccessSystemManager', v_target.role = 'super_admin' or v_target.can_access_super_admin_features,
      'canAccessMoneyTransfer', v_target.role = 'super_admin'
        or v_target.can_access_super_admin_features or v_target.can_access_money_transfer,
      'canManageTimePayroll', v_target.role = 'super_admin'
        or v_target.can_access_super_admin_features or v_target.can_manage_time_payroll
    ),
    'auditId', v_audit_id
  );
end
$$;

revoke all on function public.update_admin_user_profile(uuid, text, uuid[], uuid) from public, anon;
grant execute on function public.update_admin_user_profile(uuid, text, uuid[], uuid) to authenticated;

notify pgrst, 'reload schema';
