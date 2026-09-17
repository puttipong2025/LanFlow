-- REX readers need a presence indicator without access to money-transfer details.
create function public.get_rubber_export_work_transfer_ids(p_export_ids uuid[])
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if not private.is_active_user()
    or not (private.can_access_super_admin_features() or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.is_active and p.role = 'admin'
    )) then
    raise exception 'ไม่มีสิทธิ์ดูรายการส่งออกยาง';
  end if;
  if cardinality(p_export_ids) > 100 then raise exception 'จำนวนรายการส่งออกยางเกินกำหนด'; end if;
  select coalesce(array_agg(e.id), array[]::uuid[]) into v_ids
  from public.rubber_exports e
  where e.id = any(coalesce(p_export_ids, array[]::uuid[]))
    and private.can_access_location(e.location_id)
    and exists (select 1 from public.money_transfers t where t.rubber_export_id = e.id);
  return v_ids;
end;
$$;

revoke all on function public.get_rubber_export_work_transfer_ids(uuid[]) from public, anon;
grant execute on function public.get_rubber_export_work_transfer_ids(uuid[]) to authenticated;
notify pgrst, 'reload schema';
