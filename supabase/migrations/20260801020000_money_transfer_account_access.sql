-- Restore Money Transfer as an independent per-account capability.
-- System managers keep automatic access, while ordinary user/admin accounts
-- must be granted can_access_money_transfer explicitly.

update public.profiles
set can_access_money_transfer = false
where role in ('user', 'admin')
  and can_access_super_admin_features = true;

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
        and p.role in ('user', 'admin')
        and p.can_access_money_transfer = true
    )
$$;

revoke all on function private.can_access_money_transfer_module() from public, anon;
grant execute on function private.can_access_money_transfer_module() to authenticated;
