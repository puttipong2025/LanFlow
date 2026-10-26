-- A browser approved for an ordinary account cannot inherit system-manager trust.
create function private.revoke_browser_on_manager_promotion() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.role='admin' and new.can_access_super_admin_features
    and not (old.role='admin' and old.can_access_super_admin_features) then
    update private.sms_account_security set generation=generation+1,revoked_before=clock_timestamp()
      where user_id=new.id and required;
    if found then update private.browser_approvals set state='revoked' where user_id=new.id; end if;
  end if;
  return new;
end $$;
revoke all on function private.revoke_browser_on_manager_promotion() from public,anon,authenticated;
create trigger revoke_browser_on_manager_promotion after update of role,can_access_super_admin_features on public.profiles
for each row execute function private.revoke_browser_on_manager_promotion();
create or replace function public.list_browser_approvals(p_actor uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'userId',p.id,'required',a.required,'primaryLocationId',(select ul.location_id from public.user_locations ul join public.locations l on l.id=ul.location_id where ul.user_id=p.id and ul.is_primary and l.is_active limit 1),
    'pending',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'label',b.label,'requestedAt',b.requested_at) order by b.requested_at)
      from private.browser_approvals b where b.user_id=p.id and b.generation=a.generation and b.state='pending'),'[]'::jsonb),
    'lastApprovedBy',(select actor.name from private.sms_security_audit au left join public.profiles actor on actor.id=au.actor_id
      where au.target_id=p.id and au.action='browser_approve' order by au.created_at desc,au.id desc limit 1),
    'lastApprovedAt',(select au.created_at from private.sms_security_audit au where au.target_id=p.id and au.action='browser_approve' order by au.created_at desc,au.id desc limit 1)
  )),'[]'::jsonb)
  from public.profiles p join private.sms_account_security a on a.user_id=p.id
  where private.can_approve_browser(p_actor,p.id)
$$;


notify pgrst,'reload schema';
