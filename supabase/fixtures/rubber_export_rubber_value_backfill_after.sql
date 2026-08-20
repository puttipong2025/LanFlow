do $$
begin
  if not (select paid_total = 3600 and rubber_value_total = 4000
          from public.rubber_exports
          where id = 'b6000000-0000-4000-8000-000000000001') then
    raise exception 'ordinary export snapshot backfill mismatch';
  end if;

  if not (select paid_amount = 3600 and rubber_value_amount = 4000
          from public.rubber_export_items
          where export_id = 'b6000000-0000-4000-8000-000000000001') then
    raise exception 'ordinary export item snapshot backfill mismatch';
  end if;

  if exists (
    select 1 from public.rubber_exports e
    join public.rubber_export_items i on i.export_id = e.id
    where e.id in (
      'b8000000-0000-4000-8000-000000000001',
      'b8000000-0000-4000-8000-000000000002',
      'b8000000-0000-4000-8000-000000000003'
    )
      and (e.rubber_value_total <> 3600 or i.rubber_value_amount <> 3600)
  ) then
    raise exception 'branch-receipt compatibility backfill mismatch';
  end if;

  if exists (
    select 1 from public.rubber_bills
    where id in (
      'b7000000-0000-4000-8000-000000000001',
      'b7000000-0000-4000-8000-000000000002'
    )
      and (rubber_value <> 3600 or deduction_total <> 3600 or net_total <> 0)
  ) then
    raise exception 'existing branch receipt changed';
  end if;
end;
$$;
