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
  if not private.is_active_user() then
    raise exception 'Unauthorized or inactive user';
  end if;
  if p_location_id is null or not private.can_access_location(p_location_id) then
    raise exception 'Location access denied';
  end if;
  if p_source_type not in ('rubber_bill', 'ocr_ticket') then
    raise exception 'Unsupported money transfer source type';
  end if;

  return query
  select i.source_type, i.source_id, i.transfer_id
  from public.money_transfer_items i
  join public.money_transfers t on t.id = i.transfer_id
  where t.location_id = p_location_id
    and t.record_status <> 'deleted'
    and i.source_type = p_source_type
    and (p_source_ids is null or i.source_id = any(p_source_ids));
end;
$$;

revoke all on function public.get_money_transfer_source_locks(uuid, text, uuid[])
from public, anon;
grant execute on function public.get_money_transfer_source_locks(uuid, text, uuid[])
to authenticated;

notify pgrst, 'reload schema';
