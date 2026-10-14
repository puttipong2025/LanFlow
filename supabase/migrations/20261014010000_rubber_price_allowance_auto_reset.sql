-- Reset Rubber price allowances after 24 elapsed hours when the global switch is enabled.

alter table public.rubber_approval_groups
  add column price_allowance_auto_reset_locked boolean not null default false;

alter table public.rubber_bill_approval_settings
  add column price_allowance_auto_reset_enabled boolean not null default false,
  add column ungrouped_price_allowance_auto_reset_locked boolean not null default false;

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
    'priceAllowanceAutoResetLocked', grouped.price_allowance_auto_reset_locked,
    'revisionNo', grouped.revision_no,
    'updatedByName', grouped.updated_by_name,
    'updatedByPhone', grouped.updated_by_phone,
    'updatedAt', grouped.updated_at
  ) order by grouped.created_at, grouped.id), '[]'::jsonb)
  into v_groups
  from (
    select g.id, g.edit_window_minutes, g.price_allowance,
      g.price_allowance_auto_reset_locked, g.revision_no,
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
      'priceAllowanceAutoResetLocked', v_settings.ungrouped_price_allowance_auto_reset_locked,
      'revision', v_settings.ungrouped_revision,
      'updatedByName', v_settings.ungrouped_updated_by_name,
      'updatedByPhone', v_settings.ungrouped_updated_by_phone,
      'updatedAt', v_settings.ungrouped_updated_at
    ),
    'maxPriceAllowance', jsonb_build_object(
      'value', v_settings.max_price_allowance,
      'updatedByName', v_settings.max_price_allowance_updated_by_name,
      'updatedByPhone', v_settings.max_price_allowance_updated_by_phone,
      'updatedAt', v_settings.max_price_allowance_updated_at
    ),
    'priceAllowanceAutoResetEnabled', v_settings.price_allowance_auto_reset_enabled
  );
end
$$;

create or replace function public.create_rubber_approval_group_v2(
  p_location_ids uuid[],
  p_edit_window_minutes integer,
  p_price_allowance numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location_ids uuid[];
  v_group public.rubber_approval_groups%rowtype;
  v_actor public.profiles%rowtype;
  v_settings public.rubber_bill_approval_settings%rowtype;
  v_now timestamptz := clock_timestamp();
  v_allowance numeric;
begin
  if not private.is_active_user() or not private.can_access_super_admin_features() then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์จัดการกลุ่มอนุมัติบิลยาง';
  end if;
  v_allowance := private.validate_rubber_price_allowance(p_price_allowance);
  v_location_ids := private.validate_rubber_approval_group_v2_input(
    p_location_ids, p_edit_window_minutes, v_allowance
  );
  perform pg_advisory_xact_lock(hashtextextended('rubber-approval-policy', 0));
  if exists (
    select 1 from public.rubber_approval_group_locations gl
    where gl.location_id = any(v_location_ids)
  ) then
    raise exception 'RUBBER_GROUP_BRANCH_CONFLICT: มีสาขาอยู่ในกลุ่มอื่นแล้ว';
  end if;
  select * into v_actor from public.profiles p where p.id = auth.uid();
  select * into v_settings
  from public.rubber_bill_approval_settings where id = true for update;
  perform private.validate_rubber_effective_price_cap(v_settings.central_price, v_allowance);

  insert into public.rubber_approval_groups (
    edit_window_minutes, configured_price, price_allowance,
    updated_by_user_id, updated_by_name, updated_by_phone, updated_at
  ) values (
    p_edit_window_minutes, v_settings.central_price + v_allowance, v_allowance,
    auth.uid(), v_actor.name, v_actor.phone, v_now
  ) returning * into v_group;

  insert into public.rubber_approval_group_locations (group_id, location_id)
  select v_group.id, location_id from unnest(v_location_ids) location_id;

  update public.rubber_bill_approval_settings
  set ungrouped_revision = ungrouped_revision + 1,
      ungrouped_updated_by_user_id = auth.uid(),
      ungrouped_updated_by_name = v_actor.name,
      ungrouped_updated_by_phone = v_actor.phone,
      ungrouped_updated_at = v_now,
      price_rule_revision = price_rule_revision + 1
  where id = true;

  return jsonb_build_object(
    'group', jsonb_build_object(
      'id', v_group.id,
      'locationIds', to_jsonb(v_location_ids),
      'editWindowMinutes', v_group.edit_window_minutes,
      'priceAllowance', v_group.price_allowance,
      'priceAllowanceAutoResetLocked', v_group.price_allowance_auto_reset_locked,
      'revisionNo', v_group.revision_no,
      'updatedByName', v_group.updated_by_name,
      'updatedByPhone', v_group.updated_by_phone,
      'updatedAt', v_group.updated_at
    ),
    'affectedLocationIds', to_jsonb(v_location_ids)
  );
end
$$;

create or replace function public.update_rubber_approval_group_v2(
  p_group_id uuid,
  p_location_ids uuid[],
  p_edit_window_minutes integer,
  p_price_allowance numeric,
  p_expected_revision bigint,
  p_expected_source_revisions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location_ids uuid[];
  v_old_location_ids uuid[];
  v_affected_location_ids uuid[];
  v_source_group_ids uuid[];
  v_group public.rubber_approval_groups%rowtype;
  v_actor public.profiles%rowtype;
  v_settings public.rubber_bill_approval_settings%rowtype;
  v_now timestamptz := clock_timestamp();
  v_allowance numeric;
  v_membership_changed boolean;
  v_ungrouped_changed boolean := false;
begin
  if not private.is_active_user() or not private.can_access_super_admin_features() then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์จัดการกลุ่มอนุมัติบิลยาง';
  end if;
  v_allowance := private.validate_rubber_price_allowance(p_price_allowance);
  v_location_ids := private.validate_rubber_approval_group_v2_input(
    p_location_ids, p_edit_window_minutes, v_allowance
  );
  perform pg_advisory_xact_lock(hashtextextended('rubber-approval-policy', 0));
  select * into v_group
  from public.rubber_approval_groups g
  where g.id = p_group_id for update;
  if v_group.id is null then
    raise exception 'RUBBER_GROUP_NOT_FOUND: ไม่พบกลุ่ม';
  end if;
  if v_group.revision_no <> p_expected_revision then
    raise exception 'RUBBER_GROUP_STALE: กลุ่มถูกแก้ไขโดยผู้ใช้อื่น';
  end if;

  select array_agg(gl.location_id order by gl.location_id)
  into v_old_location_ids
  from public.rubber_approval_group_locations gl
  where gl.group_id = p_group_id;
  v_old_location_ids := coalesce(v_old_location_ids, array[]::uuid[]);
  v_membership_changed := v_old_location_ids is distinct from v_location_ids;
  v_ungrouped_changed := v_membership_changed and (
    exists (
      select 1 from unnest(v_old_location_ids) id
      where not (id = any(v_location_ids))
    )
    or exists (
      select 1 from unnest(v_location_ids) id
      where not (id = any(v_old_location_ids))
        and not exists (
          select 1 from public.rubber_approval_group_locations gl
          where gl.location_id = id
        )
    )
  );

  if not v_membership_changed
     and v_group.edit_window_minutes = p_edit_window_minutes
     and v_group.price_allowance = v_allowance then
    return jsonb_build_object(
      'group', jsonb_build_object(
        'id', v_group.id,
        'locationIds', to_jsonb(v_old_location_ids),
        'editWindowMinutes', v_group.edit_window_minutes,
        'priceAllowance', v_group.price_allowance,
        'priceAllowanceAutoResetLocked', v_group.price_allowance_auto_reset_locked,
        'revisionNo', v_group.revision_no,
        'updatedByName', v_group.updated_by_name,
        'updatedByPhone', v_group.updated_by_phone,
        'updatedAt', v_group.updated_at
      ),
      'affectedLocationIds', '[]'::jsonb
    );
  end if;

  select array_agg(distinct gl.group_id)
  into v_source_group_ids
  from public.rubber_approval_group_locations gl
  where gl.location_id = any(v_location_ids)
    and gl.group_id <> p_group_id;

  if exists (
    select 1
    from public.rubber_approval_groups source_group
    where source_group.id = any(coalesce(v_source_group_ids, array[]::uuid[]))
      and not case
        when jsonb_typeof(coalesce(p_expected_source_revisions, '{}'::jsonb) -> source_group.id::text) = 'number'
          then (coalesce(p_expected_source_revisions, '{}'::jsonb) ->> source_group.id::text)::numeric
            = source_group.revision_no
        else false
      end
  ) then
    raise exception 'RUBBER_GROUP_STALE: กลุ่มต้นทางถูกแก้ไขโดยผู้ใช้อื่น';
  end if;

  if exists (
    select 1
    from unnest(coalesce(v_source_group_ids, array[]::uuid[])) source(group_id)
    where not exists (
      select 1
      from public.rubber_approval_group_locations gl
      where gl.group_id = source.group_id
        and not (gl.location_id = any(v_location_ids))
    )
  ) then
    raise exception 'RUBBER_GROUP_EMPTY: ย้ายสมาชิกสุดท้ายไม่ได้ กรุณาลบกลุ่มต้นทาง';
  end if;

  select array_agg(distinct id order by id)
  into v_affected_location_ids
  from (
    select unnest(v_old_location_ids) id
    union
    select unnest(v_location_ids) id
    union
    select gl.location_id
    from public.rubber_approval_group_locations gl
    where gl.group_id = any(coalesce(v_source_group_ids, array[]::uuid[]))
  ) affected;

  select * into v_actor from public.profiles p where p.id = auth.uid();
  select * into v_settings
  from public.rubber_bill_approval_settings where id = true for update;
  perform private.validate_rubber_effective_price_cap(v_settings.central_price, v_allowance);

  delete from public.rubber_approval_group_locations gl
  where gl.location_id = any(v_location_ids)
    and gl.group_id <> p_group_id;
  delete from public.rubber_approval_group_locations gl
  where gl.group_id = p_group_id
    and not (gl.location_id = any(v_location_ids));
  insert into public.rubber_approval_group_locations (group_id, location_id)
  select p_group_id, id from unnest(v_location_ids) id
  on conflict (location_id) do nothing;

  if v_source_group_ids is not null then
    update public.rubber_approval_groups
    set revision_no = revision_no + 1,
        updated_by_user_id = auth.uid(),
        updated_by_name = v_actor.name,
        updated_by_phone = v_actor.phone,
        updated_at = v_now
    where id = any(v_source_group_ids);
  end if;

  update public.rubber_approval_groups
  set edit_window_minutes = p_edit_window_minutes,
      configured_price = v_settings.central_price + v_allowance,
      price_allowance = v_allowance,
      revision_no = revision_no + 1,
      updated_by_user_id = auth.uid(),
      updated_by_name = v_actor.name,
      updated_by_phone = v_actor.phone,
      updated_at = v_now
  where id = p_group_id
  returning * into v_group;

  if v_ungrouped_changed then
    update public.rubber_bill_approval_settings
    set ungrouped_revision = ungrouped_revision + 1,
        ungrouped_updated_by_user_id = auth.uid(),
        ungrouped_updated_by_name = v_actor.name,
        ungrouped_updated_by_phone = v_actor.phone,
        ungrouped_updated_at = v_now
    where id = true;
  end if;

  update public.rubber_bill_approval_settings
  set price_rule_revision = price_rule_revision + 1
  where id = true;

  return jsonb_build_object(
    'group', jsonb_build_object(
      'id', v_group.id,
      'locationIds', to_jsonb(v_location_ids),
      'editWindowMinutes', v_group.edit_window_minutes,
      'priceAllowance', v_group.price_allowance,
      'priceAllowanceAutoResetLocked', v_group.price_allowance_auto_reset_locked,
      'revisionNo', v_group.revision_no,
      'updatedByName', v_group.updated_by_name,
      'updatedByPhone', v_group.updated_by_phone,
      'updatedAt', v_group.updated_at
    ),
    'affectedLocationIds', to_jsonb(v_affected_location_ids)
  );
end
$$;

create function public.save_rubber_price_allowance_auto_reset(
  p_enabled boolean,
  p_expected_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current boolean;
begin
  if not private.is_active_user() or not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active = true and p.role = 'super_admin'
  ) then
    raise exception 'FORBIDDEN: เฉพาะ super admin เท่านั้นที่เปิดหรือปิดการรีเซ็ตราคายางอัตโนมัติได้';
  end if;
  if p_enabled is null or p_expected_enabled is null then
    raise exception 'RUBBER_AUTO_RESET_INVALID: สถานะการรีเซ็ตราคายางอัตโนมัติไม่ถูกต้อง';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('rubber-approval-policy', 0));
  select price_allowance_auto_reset_enabled into v_current
  from public.rubber_bill_approval_settings
  where id = true
  for update;

  if v_current is distinct from p_expected_enabled then
    raise exception 'RUBBER_AUTO_RESET_STALE: สถานะการรีเซ็ตอัตโนมัติถูกแก้ไขโดยผู้ใช้อื่น';
  end if;
  if v_current = p_enabled then
    return jsonb_build_object('status', 'unchanged', 'enabled', v_current);
  end if;

  update public.rubber_bill_approval_settings
  set price_allowance_auto_reset_enabled = p_enabled
  where id = true;

  return jsonb_build_object('status', 'saved', 'enabled', p_enabled);
end
$$;

create function public.save_rubber_price_allowance_auto_reset_lock(
  p_scope text,
  p_group_id uuid,
  p_locked boolean,
  p_expected_locked boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current boolean;
  v_status text := 'saved';
begin
  if not private.is_active_user() or not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active = true and p.role = 'super_admin'
  ) then
    raise exception 'FORBIDDEN: เฉพาะ super admin เท่านั้นที่เปลี่ยนสถานะล็อกรีเซ็ตราคายางได้';
  end if;
  if p_locked is null
     or p_expected_locked is null
     or p_scope is null
     or p_scope not in ('group', 'ungrouped')
     or (p_scope = 'group' and p_group_id is null)
     or (p_scope = 'ungrouped' and p_group_id is not null) then
    raise exception 'RUBBER_AUTO_RESET_LOCK_INVALID: สถานะล็อกรีเซ็ตราคายางไม่ถูกต้อง';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('rubber-approval-policy', 0));

  if p_scope = 'group' then
    select price_allowance_auto_reset_locked into v_current
    from public.rubber_approval_groups
    where id = p_group_id
    for update;
    if not found then
      raise exception 'RUBBER_GROUP_NOT_FOUND: ไม่พบกลุ่ม';
    end if;
    if v_current is distinct from p_expected_locked then
      raise exception 'RUBBER_AUTO_RESET_LOCK_STALE: สถานะล็อกถูกแก้ไขโดยผู้ใช้อื่น';
    end if;
    if v_current = p_locked then
      v_status := 'unchanged';
    else
      update public.rubber_approval_groups
      set price_allowance_auto_reset_locked = p_locked
      where id = p_group_id;
    end if;
    return jsonb_build_object(
      'status', v_status,
      'scope', 'group',
      'groupId', p_group_id,
      'locked', p_locked
    );
  end if;

  select ungrouped_price_allowance_auto_reset_locked into v_current
  from public.rubber_bill_approval_settings
  where id = true
  for update;
  if v_current is distinct from p_expected_locked then
    raise exception 'RUBBER_AUTO_RESET_LOCK_STALE: สถานะล็อกถูกแก้ไขโดยผู้ใช้อื่น';
  end if;
  if v_current = p_locked then
    v_status := 'unchanged';
  else
    update public.rubber_bill_approval_settings
    set ungrouped_price_allowance_auto_reset_locked = p_locked
    where id = true;
  end if;
  return jsonb_build_object(
    'status', v_status,
    'scope', 'ungrouped',
    'locked', p_locked
  );
end
$$;

create function private.reset_rubber_price_allowances(
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := coalesce(p_now, clock_timestamp());
  v_settings public.rubber_bill_approval_settings%rowtype;
  v_group_count integer := 0;
  v_ungrouped_count integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('rubber-approval-policy', 0));
  select * into v_settings
  from public.rubber_bill_approval_settings
  where id = true
  for update;

  if not v_settings.price_allowance_auto_reset_enabled then
    return jsonb_build_object('groupCount', 0, 'ungroupedCount', 0);
  end if;

  update public.rubber_approval_groups
  set configured_price = v_settings.central_price,
      price_allowance = 0,
      revision_no = revision_no + 1,
      updated_by_user_id = null,
      updated_by_name = 'ระบบ',
      updated_by_phone = null,
      updated_at = v_now
  where price_allowance <> 0
    and not price_allowance_auto_reset_locked
    and updated_at <= v_now - interval '24 hours';
  get diagnostics v_group_count = row_count;

  update public.rubber_bill_approval_settings
  set ungrouped_price_allowance = 0,
      ungrouped_revision = ungrouped_revision + 1,
      ungrouped_updated_by_user_id = null,
      ungrouped_updated_by_name = 'ระบบ',
      ungrouped_updated_by_phone = null,
      ungrouped_updated_at = v_now
  where id = true
    and ungrouped_price_allowance <> 0
    and not ungrouped_price_allowance_auto_reset_locked
    and ungrouped_updated_at <= v_now - interval '24 hours';
  get diagnostics v_ungrouped_count = row_count;

  if v_group_count + v_ungrouped_count > 0 then
    update public.rubber_bill_approval_settings
    set price_rule_revision = price_rule_revision + 1
    where id = true;
  end if;

  return jsonb_build_object(
    'groupCount', v_group_count,
    'ungroupedCount', v_ungrouped_count
  );
end
$$;

revoke all on function public.save_rubber_price_allowance_auto_reset(boolean, boolean)
  from public, anon;
grant execute on function public.save_rubber_price_allowance_auto_reset(boolean, boolean)
  to authenticated;
revoke all on function public.save_rubber_price_allowance_auto_reset_lock(text, uuid, boolean, boolean)
  from public, anon;
grant execute on function public.save_rubber_price_allowance_auto_reset_lock(text, uuid, boolean, boolean)
  to authenticated;
revoke all on function private.reset_rubber_price_allowances(timestamptz)
  from public, anon, authenticated;

do $$
declare
  existing_job bigint;
begin
  for existing_job in
    select jobid from cron.job
    where jobname = 'rubber-price-allowance-auto-reset'
  loop
    perform cron.unschedule(existing_job);
  end loop;
  perform cron.schedule(
    'rubber-price-allowance-auto-reset',
    '* * * * *',
    'set statement_timeout = ''20s''; select private.reset_rubber_price_allowances()'
  );
end
$$;

notify pgrst, 'reload schema';
