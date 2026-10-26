-- Password updates, including admin reset, invalidate remembered browsers and
-- active sessions atomically with Auth. Phone changes already bump generation.
create function private.revoke_browser_on_password_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    insert into private.sms_account_security(user_id,generation,revoked_before)
      select new.id,1,clock_timestamp() where exists(select 1 from public.profiles where id=new.id)
    on conflict(user_id) do update set generation=private.sms_account_security.generation+1,revoked_before=clock_timestamp();
    update private.browser_approvals set state='revoked' where user_id=new.id;
  end if;
  return new;
end $$;
revoke all on function private.revoke_browser_on_password_change() from public,anon,authenticated;
create trigger revoke_browser_on_password_change after update of encrypted_password on auth.users
for each row execute function private.revoke_browser_on_password_change();
