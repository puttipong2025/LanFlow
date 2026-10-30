-- Forward operational rollback for 20261030020000 only.
-- Preserve jobs, receipts, execution contexts, ownership and existing grants.
begin;
create or replace function private.rubber_actor_active() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles where id=private.rubber_execution_actor()
    and is_active and role in ('admin','super_admin'))
$$;
create or replace function private.rubber_actor_manager() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles where id=private.rubber_execution_actor()
    and is_active and (role='super_admin' or (role='admin' and can_access_super_admin_features)))
$$;
create or replace function private.rubber_actor_location(p_location uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.rubber_actor_active() and (private.rubber_actor_manager() or exists(
    select 1 from public.user_locations where user_id=private.rubber_execution_actor() and location_id=p_location))
$$;
commit;
