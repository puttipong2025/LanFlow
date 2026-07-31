-- Retire the two temporary branches without deleting their historical data.
-- The rows, user assignments, dashboard state, and all business records remain
-- available for audit or a future reactivation.

do $$
begin
  -- A fresh `supabase db reset` applies migrations before seed.sql, so an empty
  -- locations table is valid here. seed.sql carries the same active-state rule.
  if not exists (select 1 from public.locations) then
    return;
  end if;

  -- Fresh migration replay has the legacy ป่ากุงใหญ่ location before seed.sql runs.
  -- Ensure the canonical location exists so this migration can complete.
  if not exists (
    select 1
    from public.locations
    where name = 'ชานุมาน'
  ) then
    insert into public.locations (
      id,
      name,
      code,
      is_active,
      created_by
    )
    values (
      '00000000-0000-4000-8000-000000000102',
      'ชานุมาน',
      'CNM',
      true,
      '00000000-0000-4000-8000-000000000001'
    )
    on conflict (id) do nothing;
  end if;

  if not exists (
    select 1
    from public.locations
    where name = 'ชานุมาน'
  ) then
    raise exception 'Cannot retire locations: ชานุมาน was not found';
  end if;

  update public.locations
  set
    is_active = false,
    updated_at = now()
  where name in ('ป่ากุงใหญ่', 'ดงแถบ', 'ลานข้าวหอม')
    and is_active = true;

  update public.locations
  set
    is_active = true,
    updated_at = now()
  where name = 'ชานุมาน'
    and is_active = false;

  if (
    select count(*)
    from public.locations
    where is_active = true
  ) <> 1
  or not exists (
    select 1
    from public.locations
    where name = 'ชานุมาน'
      and is_active = true
  ) then
    raise exception
      'Cannot retire locations: expected ชานุมาน to be the only active location';
  end if;
end;
$$;
