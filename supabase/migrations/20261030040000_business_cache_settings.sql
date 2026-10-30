-- Shared repair-check frequency. No direct table writes, including for managers.
create table public.business_cache_settings (
  id boolean primary key default true check (id),
  interval_minutes integer check (interval_minutes between 10 and 120),
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
insert into public.business_cache_settings(id) values (true);
alter table public.business_cache_settings enable row level security;
revoke all on public.business_cache_settings from public, anon, authenticated;

create function public.get_business_cache_settings()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_access_business_modules() or not private.sms_access_allowed() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return (select jsonb_build_object('intervalMinutes', interval_minutes, 'revision', revision)
    from public.business_cache_settings where id = true);
end $$;

create function public.save_business_cache_settings(p_interval_minutes integer, p_expected_revision integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare current_settings public.business_cache_settings%rowtype;
begin
  if not private.is_active_user() or not private.sms_access_allowed() or not exists (
    select 1 from public.profiles where id = auth.uid() and is_active and role = 'super_admin'
  ) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if (p_interval_minutes is not null and p_interval_minutes not between 10 and 120)
     or p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'Invalid cache settings' using errcode = '22023';
  end if;
  select * into strict current_settings from public.business_cache_settings where id = true for update;
  if current_settings.revision <> p_expected_revision then
    raise exception 'Cache settings changed' using errcode = '40001';
  end if;
  if current_settings.interval_minutes is distinct from p_interval_minutes then
    update public.business_cache_settings set interval_minutes = p_interval_minutes,
      revision = revision + 1, updated_at = clock_timestamp(), updated_by = auth.uid() where id = true;
  end if;
  return public.get_business_cache_settings();
end $$;

revoke all on function public.get_business_cache_settings() from public, anon;
revoke all on function public.save_business_cache_settings(integer, integer) from public, anon;
grant execute on function public.get_business_cache_settings() to authenticated;
grant execute on function public.save_business_cache_settings(integer, integer) to authenticated;
notify pgrst, 'reload schema';
