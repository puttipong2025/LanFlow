create or replace function public.get_my_effective_active_location_scope()
returns table(location_id uuid, is_primary boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    l.id as location_id,
    coalesce(ul.is_primary, false) as is_primary
  from public.profiles p
  join public.locations l on l.is_active = true
  left join public.user_locations ul
    on ul.user_id = p.id
   and ul.location_id = l.id
  where p.id = auth.uid()
    and p.is_active = true
    and (
      private.can_access_super_admin_features()
      or ul.user_id is not null
    )
  order by
    coalesce(ul.is_primary, false) desc,
    case when ul.user_id is not null then ul.created_at else l.created_at end,
    l.id
$$;

revoke all on function public.get_my_effective_active_location_scope() from public, anon;
grant execute on function public.get_my_effective_active_location_scope()
  to authenticated, service_role;

drop function if exists public.get_my_active_location_assignments();
drop function if exists public.set_user_primary_location(uuid, uuid);
drop function if exists public.remove_user_location_with_primary_replacement(uuid, uuid, uuid);
