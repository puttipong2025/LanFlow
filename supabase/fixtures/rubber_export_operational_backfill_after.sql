do $$
declare
  v_active_age numeric;
begin
  select received_age_hours into v_active_age
  from public.rubber_bills
  where id = 'b7000000-0000-4000-8000-000000000001';
  if v_active_age <> 150 then
    raise exception 'active receipt was not recalculated from raw item age: %', v_active_age;
  end if;

  if not (select received_age_is_estimated from public.rubber_bills
          where id = 'b7000000-0000-4000-8000-000000000001') then
    raise exception 'active receipt lost the estimated flag';
  end if;

  if (select received_age_hours from public.rubber_bills
      where id = 'b7000000-0000-4000-8000-000000000002') <> 11 then
    raise exception 'deleted receipt snapshot changed';
  end if;

  if not (select age_source_at = '2026-08-10 06:00:00+00'::timestamptz
                 and carried_age_hours = 150
                 and age_is_estimated
          from public.rubber_export_items
          where id = 'b9000000-0000-4000-8000-000000000001') then
    raise exception 'draft downstream item was not backfilled';
  end if;

  if not (select age_source_at = '2000-01-01 00:00:00+00'::timestamptz
                 and carried_age_hours = 7
                 and not age_is_estimated
          from public.rubber_export_items
          where id = 'b9000000-0000-4000-8000-000000000002') then
    raise exception 'verified downstream snapshot changed';
  end if;

  if not (select age_source_at = '2000-01-01 00:00:00+00'::timestamptz
                 and carried_age_hours = 9
                 and not age_is_estimated
          from public.rubber_export_items
          where id = 'b9000000-0000-4000-8000-000000000003') then
    raise exception 'deleted downstream snapshot changed';
  end if;
end;
$$;
