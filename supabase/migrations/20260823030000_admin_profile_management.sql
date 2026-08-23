-- Atomic employee general-data changes and secret-free password reset evidence.

create table public.admin_account_audit_logs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid,
  actor_user_id uuid not null references public.profiles(id),
  target_user_id uuid not null references public.profiles(id),
  action text not null,
  status text not null,
  old_data jsonb,
  new_data jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint admin_account_audit_action_check
    check (action in ('profile_update', 'password_reset')),
  constraint admin_account_audit_status_check
    check (status in ('pending', 'succeeded', 'failed', 'unknown')),
  constraint admin_account_audit_secret_free_shape check (
    (action = 'profile_update'
      and request_id is null
      and status = 'succeeded'
      and old_data is not null
      and new_data is not null
      and error_code is null
      and completed_at is not null)
    or
    (action = 'password_reset'
      and request_id is not null
      and old_data is null
      and new_data is null
      and (
        (status = 'pending' and error_code is null and completed_at is null)
        or (status = 'succeeded' and error_code is null and completed_at is not null)
        or (status in ('failed', 'unknown') and error_code is not null and completed_at is not null)
      ))
  )
);

create unique index admin_account_password_request_unique
  on public.admin_account_audit_logs (request_id)
  where request_id is not null;
create index admin_account_audit_target_created_idx
  on public.admin_account_audit_logs (target_user_id, created_at desc);

alter table public.admin_account_audit_logs enable row level security;
revoke all on public.admin_account_audit_logs from public, anon, authenticated;
grant all on public.admin_account_audit_logs to service_role;

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
  where ul.user_id = p_user_id;

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
  where ul.user_id = p_user_id and not (ul.location_id = any(v_location_ids));
  insert into public.user_locations (user_id, location_id, assigned_by, is_primary)
  select p_user_id, location_id, v_actor_id, false
  from unnest(v_location_ids) location_id
  on conflict (user_id, location_id) do nothing;
  if p_primary_location_id is not null then
    update public.user_locations
    set is_primary = true
    where user_id = p_user_id and location_id = p_primary_location_id;
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

create or replace function public.begin_admin_password_reset(
  p_target_user_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_target public.profiles%rowtype;
  v_audit public.admin_account_audit_logs%rowtype;
begin
  if v_actor_id is null or not private.is_active_user()
     or not private.can_access_super_admin_features() then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์รีเซ็ตรหัสผ่าน';
  end if;
  if p_target_user_id is null or p_request_id is null
     or p_target_user_id = v_actor_id then
    raise exception 'FORBIDDEN: ไม่สามารถรีเซ็ตรหัสผ่านบัญชีนี้ได้';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('admin-password:' || p_request_id::text, 0));
  select * into v_audit
  from public.admin_account_audit_logs a
  where a.request_id = p_request_id;
  if v_audit.id is not null then
    if v_audit.action <> 'password_reset'
       or v_audit.actor_user_id <> v_actor_id
       or v_audit.target_user_id <> p_target_user_id then
      raise exception 'ADMIN_REQUEST_CONFLICT: requestId ถูกใช้กับคำสั่งอื่นแล้ว';
    end if;
    return jsonb_build_object(
      'auditId', v_audit.id,
      'status', v_audit.status,
      'created', false
    );
  end if;

  select * into v_target from public.profiles p where p.id = p_target_user_id;
  if v_target.id is null then
    raise exception 'ADMIN_USER_NOT_FOUND: ไม่พบบัญชีพนักงาน';
  end if;
  if v_target.role = 'super_admin' or not v_target.is_active then
    raise exception 'FORBIDDEN: บัญชีนี้ไม่สามารถรีเซ็ตรหัสผ่านได้';
  end if;

  insert into public.admin_account_audit_logs (
    request_id, actor_user_id, target_user_id, action, status
  ) values (
    p_request_id, v_actor_id, p_target_user_id, 'password_reset', 'pending'
  ) returning * into v_audit;

  return jsonb_build_object(
    'auditId', v_audit.id,
    'status', v_audit.status,
    'created', true
  );
end
$$;

create or replace function public.complete_admin_password_reset(
  p_audit_id uuid,
  p_status text,
  p_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_audit public.admin_account_audit_logs%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'FORBIDDEN: service role required';
  end if;
  if p_status not in ('succeeded', 'failed', 'unknown') then
    raise exception 'ADMIN_AUDIT_INVALID: สถานะผลลัพธ์ไม่ถูกต้อง';
  end if;
  if p_status = 'succeeded' and p_error_code is not null then
    raise exception 'ADMIN_AUDIT_INVALID: ผลสำเร็จต้องไม่มี error code';
  end if;
  if p_status in ('failed', 'unknown')
     and nullif(btrim(coalesce(p_error_code, '')), '') is null then
    raise exception 'ADMIN_AUDIT_INVALID: ผลล้มเหลวต้องมี error code';
  end if;

  select * into v_audit
  from public.admin_account_audit_logs a
  where a.id = p_audit_id and a.action = 'password_reset'
  for update;
  if v_audit.id is null then
    raise exception 'ADMIN_AUDIT_NOT_FOUND: ไม่พบหลักฐานคำสั่ง';
  end if;
  if v_audit.status = 'pending' then
    update public.admin_account_audit_logs
    set status = p_status,
        error_code = case when p_status = 'succeeded' then null else left(p_error_code, 80) end,
        completed_at = now()
    where id = p_audit_id
    returning * into v_audit;
  end if;
  return jsonb_build_object('auditId', v_audit.id, 'status', v_audit.status);
end
$$;

revoke all on function public.update_admin_user_profile(uuid, text, uuid[], uuid) from public, anon;
revoke all on function public.begin_admin_password_reset(uuid, uuid) from public, anon;
revoke all on function public.complete_admin_password_reset(uuid, text, text) from public, anon, authenticated;
grant execute on function public.update_admin_user_profile(uuid, text, uuid[], uuid) to authenticated;
grant execute on function public.begin_admin_password_reset(uuid, uuid) to authenticated;
grant execute on function public.complete_admin_password_reset(uuid, text, text) to service_role;

notify pgrst, 'reload schema';
