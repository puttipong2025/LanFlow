-- Run after every public.profiles row has been imported into auth.users
-- with the same UUID.

do $$
begin
  if exists (
    select 1
    from public.profiles p
    left join auth.users u on u.id = p.id
    where u.id is null
  ) then
    raise exception 'Cannot finalize auth link: profiles without matching auth.users still exist';
  end if;
end
$$;

alter table public.profiles
  drop constraint if exists profiles_id_auth_user_fk;

alter table public.profiles
  add constraint profiles_id_auth_user_fk
  foreign key (id)
  references auth.users(id)
  on delete restrict
  not valid;

alter table public.profiles
  validate constraint profiles_id_auth_user_fk;

