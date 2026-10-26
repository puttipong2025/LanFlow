-- Browser trust replaces SMS. Keep the existing account generation and gates.
create table private.browser_approvals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  secret_hash text not null check (secret_hash ~ '^[a-f0-9]{64}$'),
  generation bigint not null,
  state text not null check (state in ('pending','approved','cancelled','revoked')),
  label text not null,
  requested_at timestamptz not null default now(),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  unique(user_id, secret_hash)
);
create index browser_approvals_pending on private.browser_approvals(user_id) where state='pending';
create table private.browser_session_approvals (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  browser_id uuid not null references private.browser_approvals(id) on delete cascade,
  generation bigint not null
);
revoke all on private.browser_approvals, private.browser_session_approvals from public,anon,authenticated;
grant all on private.browser_approvals, private.browser_session_approvals to service_role;

-- All existing required accounts must pass the new approval flow.
update private.sms_account_security a set generation=generation+1, revoked_before=clock_timestamp()
where required and exists(select 1 from public.profiles p where p.id=a.user_id and p.role<>'super_admin');

create or replace function private.sms_session_status() returns text
language plpgsql stable security definer set search_path='' as $$
declare a private.sms_account_security%rowtype; sid uuid;
begin
  if auth.uid() is null then return 'SIGNED_OUT'; end if;
  select * into a from private.sms_account_security where user_id=auth.uid();
  if a.user_id is null then return 'READY'; end if;
  begin sid:=nullif(auth.jwt()->>'session_id','')::uuid;
  exception when invalid_text_representation then return 'SESSION_REVOKED'; end;
  if not exists(select 1 from auth.sessions s where s.id=sid and s.user_id=auth.uid()
    and s.created_at>a.revoked_before and (s.not_after is null or s.not_after>now())) then return 'SESSION_REVOKED'; end if;
  if not a.required or exists(select 1 from public.profiles where id=auth.uid() and role='super_admin') then return 'READY'; end if;
  if not exists(select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) x where x->>'method'='password') then return 'PASSWORD_REQUIRED'; end if;
  if exists(select 1 from private.browser_session_approvals s join private.browser_approvals b on b.id=s.browser_id
    where s.session_id=sid and b.user_id=auth.uid() and s.generation=a.generation
      and b.generation=a.generation and b.state='approved') then return 'READY'; end if;
  -- Internal compatibility code; UI now renders browser approval, never SMS.
  return 'OTP_REQUIRED';
end $$;

-- Same effective scope as get_my_effective_active_location_scope: system
-- managers can access all active branches. Do not use role=admin alone.
create function private.can_approve_browser(p_actor uuid,p_target uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select p_actor<>p_target and exists(
    select 1 from public.profiles a, public.profiles t
    where a.id=p_actor and t.id=p_target and a.is_active and t.is_active and t.role<>'super_admin'
    and (a.role='super_admin' or (
      a.role='admin' and a.can_access_super_admin_features
      and not (t.role='admin' and t.can_access_super_admin_features)
      and exists(select 1 from public.user_locations ul join public.locations l on l.id=ul.location_id
        where ul.user_id=t.id and l.is_active)
    ))
  )
$$;
revoke all on function private.can_approve_browser(uuid,uuid) from public,anon,authenticated;

-- Service-only. Server supplies claims verified by Supabase, never body IDs.
create function public.bootstrap_browser_approval(p_user uuid,p_session uuid,p_hash text,p_label text,p_request boolean default false,p_resubmit boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a private.sms_account_security%rowtype; b private.browser_approvals%rowtype;
begin
  select * into a from private.sms_account_security where user_id=p_user for update;
  if not exists(select 1 from public.profiles where id=p_user and is_active)
    or not exists(select 1 from auth.sessions where id=p_session and user_id=p_user
      and created_at>coalesce(a.revoked_before,'-infinity') and (not_after is null or not_after>now())) then
    return jsonb_build_object('status','SESSION_REVOKED'); end if;
  if a.user_id is null or not a.required or exists(select 1 from public.profiles where id=p_user and role='super_admin') then
    return jsonb_build_object('status','READY'); end if;
  if p_hash is null or p_hash!~'^[a-f0-9]{64}$' then return jsonb_build_object('status','MISSING'); end if;
  select * into b from private.browser_approvals where user_id=p_user and secret_hash=p_hash for update;
  if p_request and (b.id is null or b.generation<>a.generation or b.state='revoked' or (b.state='cancelled' and p_resubmit)) then
    insert into private.browser_approvals(user_id,secret_hash,generation,state,label)
    values(p_user,p_hash,a.generation,'pending',left(p_label,80))
    on conflict(user_id,secret_hash) do update set generation=excluded.generation,state='pending',label=excluded.label,requested_at=now()
    returning * into b;
  end if;
  if b.id is null or b.generation<>a.generation then return jsonb_build_object('status','MISSING'); end if;
  if b.state='approved' then
    insert into private.browser_session_approvals(session_id,browser_id,generation) values(p_session,b.id,a.generation)
    on conflict(session_id) do update set browser_id=excluded.browser_id,generation=excluded.generation;
    return jsonb_build_object('status','READY');
  end if;
  return jsonb_build_object('status',upper(b.state));
end $$;

create function public.manage_browser_approval(p_actor uuid,p_target uuid,p_action text,p_id uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare a private.sms_account_security%rowtype; b private.browser_approvals%rowtype;
begin
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
  insert into private.sms_security_audit(actor_id,target_id,action,new_value)
    values(p_actor,p_target,'browser_'||p_action,p_id::text);
end $$;

create function public.list_browser_approvals(p_actor uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'userId',p.id,'primaryLocationId',(select ul.location_id from public.user_locations ul join public.locations l on l.id=ul.location_id where ul.user_id=p.id and ul.is_primary and l.is_active limit 1),
    'pending',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'label',b.label,'requestedAt',b.requested_at) order by b.requested_at)
      from private.browser_approvals b where b.user_id=p.id and b.generation=a.generation and b.state='pending'),'[]'::jsonb),
    'lastApprovedBy',(select actor.name from private.sms_security_audit au join public.profiles actor on actor.id=au.actor_id
      where au.target_id=p.id and au.action='browser_approve' order by au.created_at desc,au.id desc limit 1),
    'lastApprovedAt',(select au.created_at from private.sms_security_audit au where au.target_id=p.id and au.action='browser_approve' order by au.created_at desc,au.id desc limit 1)
  )),'[]'::jsonb)
  from public.profiles p join private.sms_account_security a on a.user_id=p.id
  where private.can_approve_browser(p_actor,p.id)
$$;

-- SMS verifier can no longer authorize sessions; disable old send mutations.
create or replace function public.reserve_sms_challenge(p_user uuid,p_session uuid,p_id uuid,p_digest text) returns jsonb
language sql security definer set search_path='' as $$ select jsonb_build_object('error','NOT_REQUIRED') $$;
create or replace function public.verify_sms_challenge(p_user uuid,p_session uuid,p_id uuid,p_digest text) returns boolean
language sql security definer set search_path='' as $$ select false $$;

do $$ declare f record; begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('bootstrap_browser_approval','manage_browser_approval','list_browser_approvals') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
notify pgrst,'reload schema';
