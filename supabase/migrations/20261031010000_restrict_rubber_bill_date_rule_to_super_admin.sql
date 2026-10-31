-- Global date rules share the exact-super-admin boundary of maximum allowances.
create or replace function public.save_rubber_bill_date_approval_setting(
  p_non_current_date_requires_approval boolean
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_active_user() or not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'super_admin' and p.is_active = true
  ) then
    raise exception 'FORBIDDEN: เฉพาะ super admin เท่านั้นที่ตั้งกฎวันที่บิลยางได้';
  end if;
  if p_non_current_date_requires_approval is null then
    raise exception 'RUBBER_GROUP_INVALID: ต้องระบุกฎวันที่บิล';
  end if;
  update public.rubber_bill_approval_settings
  set non_current_date_requires_approval = p_non_current_date_requires_approval,
      updated_by_user_id = auth.uid(),
      updated_by_name = (select p.name from public.profiles p where p.id = auth.uid()),
      updated_by_phone = (select p.phone from public.profiles p where p.id = auth.uid()),
      updated_at = now()
  where id = true;
  return p_non_current_date_requires_approval;
end
$$;

revoke all on function public.save_rubber_bill_date_approval_setting(boolean) from public, anon;
grant execute on function public.save_rubber_bill_date_approval_setting(boolean) to authenticated;
