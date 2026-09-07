-- Keep Admin user creation within the actor's branch scope and make the
-- profile/location write one database transaction.

create or replace function public.create_admin_user_profile(
  p_user_id uuid,
  p_phone text,
  p_name text,
  p_role text,
  p_location_ids uuid[],
  p_password_plaintext text,
  p_password_auth_version uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_actor_role text := private.current_user_role();
  v_location_ids uuid[];
begin
  if v_actor_id is null or not private.is_active_user()
     or not (
       v_actor_role in ('super_admin', 'admin')
       or private.can_access_super_admin_features()
     ) then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์สร้างบัญชีพนักงาน';
  end if;
  if p_user_id is null
     or nullif(btrim(coalesce(p_phone, '')), '') is null
     or nullif(btrim(coalesce(p_name, '')), '') is null
     or char_length(btrim(p_name)) > 100
     or p_role not in ('user', 'admin')
     or nullif(coalesce(p_password_plaintext, ''), '') is null
     or p_password_auth_version is null then
    raise exception 'ADMIN_PROFILE_INVALID: ข้อมูลพนักงานไม่ถูกต้อง';
  end if;
  if p_role = 'admin' and v_actor_role <> 'super_admin' then
    raise exception 'FORBIDDEN: เฉพาะ super_admin เท่านั้นที่สร้างบัญชี Admin ได้';
  end if;
  if coalesce(cardinality(p_location_ids), 0) <> (
    select count(distinct location_id)
    from unnest(coalesce(p_location_ids, array[]::uuid[])) location_id
    where location_id is not null
  ) then
    raise exception 'ADMIN_PROFILE_INVALID: รายการสาขาซ้ำหรือไม่ถูกต้อง';
  end if;

  select coalesce(array_agg(location_id order by position), array[]::uuid[])
  into v_location_ids
  from unnest(coalesce(p_location_ids, array[]::uuid[]))
    with ordinality requested(location_id, position);

  if exists (
    select 1
    from unnest(v_location_ids) requested(location_id)
    left join public.locations location
      on location.id = requested.location_id and location.is_active = true
    where location.id is null
  ) then
    raise exception 'ADMIN_PROFILE_INVALID: มีสาขาที่ไม่พร้อมใช้งาน';
  end if;
  if not private.can_access_super_admin_features()
     and exists (
       select 1
       from unnest(v_location_ids) requested(location_id)
       where not private.can_manage_location(requested.location_id)
     ) then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์กำหนดสาขานอกขอบเขตของ Admin';
  end if;

  insert into public.profiles (
    id,
    phone,
    name,
    role,
    is_active,
    current_password_plaintext,
    current_password_auth_version
  ) values (
    p_user_id,
    btrim(p_phone),
    regexp_replace(btrim(p_name), '[[:space:]]+', ' ', 'g'),
    p_role::public.app_role,
    true,
    p_password_plaintext,
    p_password_auth_version
  );

  insert into public.user_locations (
    user_id,
    location_id,
    assigned_by,
    is_primary
  )
  select p_user_id, location_id, v_actor_id, position = 1
  from unnest(v_location_ids) with ordinality requested(location_id, position);
end
$$;

revoke all on function public.create_admin_user_profile(uuid, text, text, text, uuid[], text, uuid)
  from public, anon;
grant execute on function public.create_admin_user_profile(uuid, text, text, text, uuid[], text, uuid)
  to authenticated;

notify pgrst, 'reload schema';
