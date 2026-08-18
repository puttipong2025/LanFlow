create or replace function public.get_money_transfer_source_locks(
  p_location_id uuid,
  p_source_type text,
  p_source_ids uuid[] default null
)
returns table(source_type text, source_id uuid, transfer_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_active_user() or not private.can_access_location(p_location_id) then
    raise exception 'Location access denied';
  end if;
  if p_source_type not in ('rubber_bill', 'ocr_ticket') then raise exception 'Unsupported source type'; end if;
  return query
  select r.source_type, r.source_id, r.transfer_id
  from private.money_transfer_source_relations(p_location_id, p_source_type) r
  where p_source_ids is null or r.source_id = any(p_source_ids)
  order by r.source_id;
end;
$$;

revoke all on function public.get_money_transfer_source_locks(uuid, text, uuid[]) from public, anon;
grant execute on function public.get_money_transfer_source_locks(uuid, text, uuid[]) to authenticated;

notify pgrst, 'reload schema';
