-- Configurable fixed expiry for the shared branch-create acknowledgement.

create table public.branch_create_guard_settings (
  singleton boolean primary key default true check (singleton),
  confirmation_minutes integer not null default 15
    check (confirmation_minutes between 1 and 120)
);

insert into public.branch_create_guard_settings(singleton, confirmation_minutes)
values (true, 15)
on conflict (singleton) do nothing;

alter table public.branch_create_guard_settings enable row level security;

create or replace function public.get_branch_create_confirmation_minutes()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_minutes integer;
begin
  if not private.is_active_user() then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์อ่านระยะยืนยันสาขา';
  end if;
  select s.confirmation_minutes into strict v_minutes
  from public.branch_create_guard_settings s
  where s.singleton = true;
  return v_minutes;
end
$$;

create or replace function public.save_branch_create_confirmation_minutes(
  p_confirmation_minutes integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_active_user()
     or not private.can_access_super_admin_features() then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์เปลี่ยนระยะยืนยันสาขา';
  end if;
  if p_confirmation_minutes is null or p_confirmation_minutes not between 1 and 120 then
    raise exception 'BRANCH_CONFIRMATION_INVALID: ระยะยืนยันสาขาต้องอยู่ระหว่าง 1 ถึง 120 นาที';
  end if;
  update public.branch_create_guard_settings
  set confirmation_minutes = p_confirmation_minutes
  where singleton = true;
  return p_confirmation_minutes;
end
$$;

revoke all on table public.branch_create_guard_settings from public, anon, authenticated;
revoke all on function public.get_branch_create_confirmation_minutes() from public, anon;
revoke all on function public.save_branch_create_confirmation_minutes(integer) from public, anon;
grant execute on function public.get_branch_create_confirmation_minutes() to authenticated, service_role;
grant execute on function public.save_branch_create_confirmation_minutes(integer) to authenticated, service_role;

notify pgrst, 'reload schema';
