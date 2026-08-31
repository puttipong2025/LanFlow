-- Elevated account capabilities belong to Admin profiles only.
-- Super Admin keeps effective access through role-based helpers.

update public.profiles
set can_access_super_admin_features = false,
    can_access_money_transfer = false,
    can_manage_time_payroll = false,
    updated_at = now()
where role <> 'admin'
  and (
    can_access_super_admin_features = true
    or can_access_money_transfer = true
    or can_manage_time_payroll = true
  );

alter table public.profiles
  drop constraint if exists profiles_admin_only_elevated_access;

alter table public.profiles
  add constraint profiles_admin_only_elevated_access check (
    role = 'admin'
    or (
      can_access_super_admin_features = false
      and can_access_money_transfer = false
      and can_manage_time_payroll = false
    )
  );

create or replace function private.can_access_super_admin_features()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_super_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.role = 'admin'
        and p.can_access_super_admin_features = true
    )
$$;

create or replace function private.can_access_money_transfer_module()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_access_super_admin_features()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.role = 'admin'
        and p.can_access_money_transfer = true
    )
$$;

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
        from public.profiles p
        where p.id = auth.uid()
          and p.role = 'admin'
          and p.can_manage_time_payroll = true
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
            and exists (
              select 1
              from public.profiles actor
              where actor.id = auth.uid()
                and actor.role = 'admin'
                and actor.can_manage_time_payroll = true
            )
          )
        )
    )
$$;

notify pgrst, 'reload schema';
