create or replace function private.has_time_payroll_manager_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user()
    and (
      private.can_access_super_admin_features()
      or exists (
        select 1
        from public.profiles actor
        where actor.id = auth.uid()
          and actor.role = 'admin'
          and actor.can_manage_time_payroll = true
      )
    )
$$;

create or replace function private.can_manage_time_payroll_profile(target_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user()
    and exists (
      select 1
      from public.profiles target
      where target.id = target_profile_id
        and target.is_active = true
        and (
          private.can_access_super_admin_features()
          or (
            target.role in ('user', 'admin')
            and target.can_access_super_admin_features = false
            and exists (
              select 1
              from public.profiles actor
              where actor.id = auth.uid()
                and actor.role = 'admin'
                and actor.can_manage_time_payroll = true
            )
            and exists (
              select 1
              from public.user_locations target_primary
              join public.locations target_location
                on target_location.id = target_primary.location_id
               and target_location.is_active = true
              join public.user_locations actor_location
                on actor_location.location_id = target_primary.location_id
               and actor_location.user_id = auth.uid()
              where target_primary.user_id = target_profile_id
                and target_primary.is_primary = true
            )
          )
        )
    )
$$;

revoke all on function private.has_time_payroll_manager_access() from public, anon;
revoke all on function private.can_manage_time_payroll_profile(uuid) from public, anon;
grant execute on function private.has_time_payroll_manager_access() to authenticated;
grant execute on function private.can_manage_time_payroll_profile(uuid) to authenticated;

notify pgrst, 'reload schema';
