-- Forward hardening after local race/contract review.
create index browser_latest_approval on private.sms_security_audit(target_id,created_at desc,id desc) where action='browser_approve';
create or replace function public.manage_browser_approval(p_actor uuid,p_target uuid,p_action text,p_id uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare a private.sms_account_security%rowtype; b private.browser_approvals%rowtype;
begin
  -- Lock actor/target profiles before account state so role updates cannot race approval.
  perform id from public.profiles where id in (p_actor,p_target) order by id for share;
  if not private.can_approve_browser(p_actor,p_target) then raise sqlstate '42501' using message='FORBIDDEN'; end if;
  select * into a from private.sms_account_security where user_id=p_target for update;
  if a.user_id is null or not a.required then raise exception 'NOT_REQUIRED'; end if;
  if p_action='revoke' then
    update private.sms_account_security set generation=generation+1,revoked_before=clock_timestamp() where user_id=p_target;
    update private.browser_approvals set state='revoked' where user_id=p_target;
  elsif p_action in ('approve','cancel') then
    select * into b from private.browser_approvals where id=p_id and user_id=p_target for update;
    if b.id is null or b.generation<>a.generation or b.state<>'pending' then raise exception 'STALE_REQUEST'; end if;
    update private.browser_approvals set state=case when p_action='approve' then 'approved' else 'cancelled' end,
      approved_by=case when p_action='approve' then p_actor else approved_by end,
      approved_at=case when p_action='approve' then now() else approved_at end where id=b.id;
  else raise exception 'INVALID_ACTION'; end if;
  insert into private.sms_security_audit(actor_id,target_id,action,new_value,created_at)
    values(p_actor,p_target,'browser_'||p_action,p_id::text,clock_timestamp());
end $$;

create or replace function public.list_browser_approvals(p_actor uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'userId',p.id,'required',a.required,'primaryLocationId',(select ul.location_id from public.user_locations ul join public.locations l on l.id=ul.location_id where ul.user_id=p.id and ul.is_primary and l.is_active limit 1),
    'pending',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'label',b.label,'requestedAt',b.requested_at) order by b.requested_at)
      from private.browser_approvals b where b.user_id=p.id and b.generation=a.generation and b.state='pending'),'[]'::jsonb),
    'lastApprovedBy',(select actor.name from private.sms_security_audit au join public.profiles actor on actor.id=au.actor_id
      where au.target_id=p.id and au.action='browser_approve' order by au.created_at desc,au.id desc limit 1),
    'lastApprovedAt',(select au.created_at from private.sms_security_audit au where au.target_id=p.id and au.action='browser_approve' order by au.created_at desc,au.id desc limit 1)
  )),'[]'::jsonb)
  from public.profiles p join private.sms_account_security a on a.user_id=p.id
  where private.can_approve_browser(p_actor,p.id)
$$;


notify pgrst,'reload schema';
