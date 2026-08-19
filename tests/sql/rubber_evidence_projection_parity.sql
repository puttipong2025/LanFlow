begin;

select set_config(
  'request.jwt.claims',
  (
    select jsonb_build_object('sub', p.id, 'role', 'authenticated')::text
    from public.profiles p
    where p.role = 'super_admin' and p.is_active = true
    order by p.id
    limit 1
  ),
  true
);
set local role authenticated;

do $$
declare
  v_location_id uuid;
  v_repair jsonb;
begin
  for v_location_id in
    select l.id from public.locations l where l.is_active order by l.id
  loop
    select public.repair_rubber_bill_evidence_projection(v_location_id) into v_repair;
    if (v_repair ->> 'driftBefore')::bigint <> 0
      or (v_repair ->> 'driftAfter')::bigint <> 0 then
      raise exception 'Evidence projection parity failed: %', v_repair;
    end if;
  end loop;
end;
$$;

rollback;
