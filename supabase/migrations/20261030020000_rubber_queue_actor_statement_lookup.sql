-- Resolve the protected actor once per statement, not once per scanned row.
-- Keep live role/membership checks, identity fallback and execution context.
-- CREATE OR REPLACE retains function ownership, identity and existing grants.
create or replace function private.rubber_actor_active() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles
    where id=(select private.rubber_execution_actor())
      and is_active and role in ('admin','super_admin'))
$$;

create or replace function private.rubber_actor_manager() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.profiles
    where id=(select private.rubber_execution_actor())
      and is_active and (role='super_admin' or (role='admin' and can_access_super_admin_features)))
$$;

create or replace function private.rubber_actor_location(p_location uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select private.rubber_actor_active() and (private.rubber_actor_manager() or exists(
    select 1 from public.user_locations
    where user_id=(select private.rubber_execution_actor()) and location_id=p_location))
$$;
