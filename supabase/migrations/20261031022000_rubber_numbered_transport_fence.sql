-- A new client must never silently create a legacy-numbered bill on an old backend.
create function public.submit_numbered_rubber_queue(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not private.rubber_actor_active() or not private.rubber_actor_location((payload->>'locationId')::uuid) then
    raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if not (payload ? 'billNumbering') then raise exception 'INVALID_BILL_NUMBER'; end if;
  perform private.assert_rubber_bill_numbering(payload);
  return public.submit_rubber_queue(payload);
end $$;
create function public.sync_numbered_rubber_bill(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if not private.rubber_actor_active() or not private.rubber_actor_location((payload->>'locationId')::uuid) then
    raise exception 'FORBIDDEN' using errcode='42501'; end if;
  if not (payload ? 'billNumbering') then raise exception 'INVALID_BILL_NUMBER'; end if;
  perform private.assert_rubber_bill_numbering(payload);
  return public.sync_rubber_bill(payload);
end $$;
revoke all on function public.submit_numbered_rubber_queue(jsonb),public.sync_numbered_rubber_bill(jsonb) from public,anon;
grant execute on function public.submit_numbered_rubber_queue(jsonb),public.sync_numbered_rubber_bill(jsonb) to authenticated;
notify pgrst, 'reload schema';
