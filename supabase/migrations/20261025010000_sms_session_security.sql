-- App-owned second factor. Never expose challenge material to browser roles.
create table private.sms_account_security (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  required boolean not null default false,
  generation bigint not null default 0,
  revoked_before timestamptz not null default '-infinity',
  send_window timestamptz not null default now(),
  sends integer not null default 0,
  failure_window timestamptz not null default now(),
  failures integer not null default 0,
  last_sent_at timestamptz
);
create table private.sms_login_challenges (
  session_id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  generation bigint not null,
  phone text not null,
  challenge_id uuid not null,
  digest text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  delivered boolean not null default false,
  verified boolean not null default false
);
create table private.sms_security_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  target_id uuid not null,
  action text not null,
  old_value text,
  new_value text,
  created_at timestamptz not null default now()
);
create table private.sms_phone_changes (
  user_id uuid primary key,
  actor_id uuid not null,
  phone text not null,
  expires_at timestamptz not null
);
revoke all on private.sms_account_security, private.sms_login_challenges,
  private.sms_security_audit, private.sms_phone_changes from public, anon, authenticated;
grant all on private.sms_account_security, private.sms_login_challenges,
  private.sms_security_audit, private.sms_phone_changes to service_role;

create function private.sms_session_status() returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  account private.sms_account_security%rowtype;
  sid uuid;
begin
  if auth.uid() is null then return 'SIGNED_OUT'; end if;
  select * into account from private.sms_account_security where user_id = auth.uid();
  -- Existing accounts retain their old behavior until this feature is configured.
  if account.user_id is null then return 'READY'; end if;
  begin sid := nullif(auth.jwt()->>'session_id', '')::uuid;
  exception when invalid_text_representation then return 'SESSION_REVOKED'; end;
  if not exists (select 1 from auth.sessions s where s.id = sid and s.user_id = auth.uid()
    and s.created_at > account.revoked_before and (s.not_after is null or s.not_after > now())) then
    return 'SESSION_REVOKED';
  end if;
  if not account.required or exists (select 1 from public.profiles where id = auth.uid() and role = 'super_admin') then
    return 'READY';
  end if;
  if not exists (select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) a
    where a->>'method' = 'password') then return 'PASSWORD_REQUIRED'; end if;
  if exists (select 1 from private.sms_login_challenges c join auth.users u on u.id = c.user_id
    where c.session_id = sid and c.user_id = auth.uid() and c.generation = account.generation
      and c.phone = u.phone and c.verified) then return 'READY'; end if;
  return 'OTP_REQUIRED';
end $$;

create function private.sms_access_allowed() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.sms_session_status() = 'READY'
$$;
grant execute on function private.sms_access_allowed() to authenticated;

create function public.sms_login_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('status', case
    when not exists(select 1 from public.profiles where id = auth.uid() and is_active) then 'SIGNED_OUT'
    else private.sms_session_status() end)
$$;
revoke all on function public.sms_login_status() from public, anon;
grant execute on function public.sms_login_status() to authenticated;

-- Covers SECURITY DEFINER RPCs, whose table access bypasses RLS.
create function public.check_sms_access() returns void
language plpgsql stable security definer set search_path = '' as $$
declare state text;
begin
  if auth.role() <> 'authenticated' then return; end if;
  if current_setting('request.path', true) = '/rpc/sms_login_status' then return; end if;
  state := private.sms_session_status();
  if state <> 'READY' then
    raise sqlstate 'PT401' using message = state;
  end if;
end $$;
revoke all on function public.check_sms_access() from public, anon;
grant execute on function public.check_sms_access() to authenticated, service_role;
do $$ begin
  if exists(select 1 from pg_roles r, unnest(r.rolconfig) setting
    where r.rolname='authenticator' and setting like 'pgrst.db_pre_request=%'
      and setting not in ('pgrst.db_pre_request=', 'pgrst.db_pre_request=public.check_sms_access')) then
    raise exception 'Existing PostgREST pre-request hook must be composed before installing SMS security';
  end if;
end $$;
alter role authenticator set pgrst.db_pre_request = 'public.check_sms_access';

-- Restrictive policy composes with every existing permissive policy.
do $$ declare item record; begin
  for item in select schemaname, tablename from pg_tables
    where (schemaname = 'public' and rowsecurity) or (schemaname = 'storage' and tablename = 'objects')
  loop
    execute format('create policy sms_session_gate on %I.%I as restrictive for all to authenticated using ((select private.sms_access_allowed())) with check ((select private.sms_access_allowed()))', item.schemaname, item.tablename);
  end loop;
end $$;

create function public.set_user_sms_required(p_actor uuid, p_target uuid, p_required boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare was_required boolean;
begin
  if not exists(select 1 from public.profiles where id=p_actor and role='super_admin' and is_active)
    or not exists(select 1 from public.profiles where id=p_target and role<>'super_admin') then
    raise exception 'FORBIDDEN';
  end if;
  insert into private.sms_account_security(user_id) values(p_target) on conflict do nothing;
  select required into was_required from private.sms_account_security where user_id=p_target for update;
  if was_required = p_required then return; end if;
  update private.sms_account_security set required=p_required, generation=generation+1,
    revoked_before=case when p_required then clock_timestamp() else revoked_before end where user_id=p_target;
  delete from private.sms_login_challenges where user_id=p_target;
  insert into private.sms_security_audit(actor_id,target_id,action,old_value,new_value)
    values(p_actor,p_target,'sms_required',was_required::text,p_required::text);
end $$;

create function public.reserve_sms_challenge(p_user uuid, p_session uuid, p_id uuid, p_digest text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare account private.sms_account_security%rowtype; destination text;
begin
  select * into account from private.sms_account_security where user_id=p_user for update;
  if account.user_id is null or not account.required then return jsonb_build_object('error','NOT_REQUIRED'); end if;
  if not exists(select 1 from public.profiles where id=p_user and is_active and role<>'super_admin')
    or not exists(select 1 from auth.sessions where id=p_session and user_id=p_user and created_at>account.revoked_before
      and (not_after is null or not_after>now())) then return jsonb_build_object('error','SESSION_REVOKED'); end if;
  if account.last_sent_at > now()-interval '60 seconds'
    or (account.send_window > now()-interval '1 hour' and account.sends>=5)
    or (account.failure_window > now()-interval '1 hour' and account.failures>=10) then
    return jsonb_build_object('error','RATE_LIMITED');
  end if;
  -- Serialize global sending to cap cost across accounts; no IP trust dependency.
  perform pg_advisory_xact_lock(hashtextextended('lanflow-sms-global',0));
  if (select coalesce(sum(sends),0) from private.sms_account_security where send_window>now()-interval '1 hour')>=100 then
    return jsonb_build_object('error','RATE_LIMITED'); end if;
  select phone into destination from auth.users where id=p_user;
  update private.sms_account_security set last_sent_at=now(),
    sends=case when send_window<=now()-interval '1 hour' then 1 else sends+1 end,
    send_window=case when send_window<=now()-interval '1 hour' then now() else send_window end where user_id=p_user;
  insert into private.sms_login_challenges values(p_session,p_user,account.generation,destination,p_id,p_digest,now()+interval '5 minutes',0,false,false)
    on conflict(session_id) do update set generation=excluded.generation, phone=excluded.phone,
      challenge_id=excluded.challenge_id,digest=excluded.digest,expires_at=excluded.expires_at,attempts=0,delivered=false,verified=false;
  return jsonb_build_object('phone',destination);
end $$;

create function public.deliver_sms_challenge(p_id uuid) returns void
language sql security definer set search_path = '' as $$
  update private.sms_login_challenges set delivered=true where challenge_id=p_id and not verified
$$;

create function public.verify_sms_challenge(p_user uuid,p_session uuid,p_id uuid,p_digest text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare account private.sms_account_security%rowtype; challenge private.sms_login_challenges%rowtype;
begin
  select * into account from private.sms_account_security where user_id=p_user for update;
  select * into challenge from private.sms_login_challenges where session_id=p_session and user_id=p_user for update;
  if challenge.session_id is null or challenge.challenge_id<>p_id or challenge.verified or not challenge.delivered
    or challenge.expires_at<=now() or challenge.attempts>=5 or challenge.generation<>account.generation
    or not account.required
    or (account.failure_window>now()-interval '1 hour' and account.failures>=10)
    or not exists(select 1 from auth.sessions where id=p_session and user_id=p_user and created_at>account.revoked_before
      and (not_after is null or not_after>now()))
    or not exists(select 1 from auth.users where id=p_user and phone=challenge.phone)
    or not exists(select 1 from public.profiles where id=p_user and is_active) then return false; end if;
  update private.sms_login_challenges set attempts=attempts+1, verified=(digest=p_digest) where session_id=p_session;
  if challenge.digest<>p_digest then
    update private.sms_account_security set
      failures=case when failure_window<=now()-interval '1 hour' then 1 else failures+1 end,
      failure_window=case when failure_window<=now()-interval '1 hour' then now() else failure_window end where user_id=p_user;
    return false;
  end if;
  return true;
end $$;

create function public.get_sms_required(p_users uuid[]) returns table(user_id uuid, required boolean)
language sql security definer set search_path = '' as $$
  select user_id, required from private.sms_account_security where user_id=any(p_users)
$$;

create function public.prepare_sms_phone_change(p_actor uuid,p_target uuid,p_phone text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.profiles where id=p_actor and role='super_admin' and is_active) then raise exception 'FORBIDDEN'; end if;
  if p_phone !~ '^66[0-9]{9}$' or exists(select 1 from auth.users where phone=p_phone and id<>p_target) then raise exception 'INVALID_PHONE'; end if;
  insert into private.sms_phone_changes values(p_target,p_actor,p_phone,now()+interval '1 minute')
    on conflict(user_id) do update set actor_id=excluded.actor_id,phone=excluded.phone,expires_at=excluded.expires_at;
end $$;

create function private.guard_sms_phone_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare change private.sms_phone_changes%rowtype;
begin
  if new.phone is not distinct from old.phone and new.phone_change is not distinct from old.phone_change then return new; end if;
  select * into change from private.sms_phone_changes where user_id=old.id for update;
  if change.user_id is null or change.expires_at<now() or new.phone<>change.phone
    or not exists(select 1 from public.profiles where id=change.actor_id and role='super_admin' and is_active) then
    raise exception 'PHONE_CHANGE_REQUIRES_SUPER_ADMIN'; end if;
  if new.phone is distinct from old.phone then
    update public.profiles set phone='0'||substring(new.phone from 3),updated_at=now() where id=new.id;
    insert into private.sms_account_security(user_id,revoked_before) values(new.id,clock_timestamp())
      on conflict(user_id) do update set revoked_before=clock_timestamp(),generation=private.sms_account_security.generation+1;
    delete from private.sms_login_challenges where user_id=new.id;
    insert into private.sms_security_audit(actor_id,target_id,action,old_value,new_value)
      values(change.actor_id,new.id,'phone_change',old.phone,new.phone);
    delete from private.sms_phone_changes where user_id=new.id;
  end if;
  return new;
end $$;
create trigger guard_lanflow_phone_change before update of phone,phone_change on auth.users
for each row execute function private.guard_sms_phone_change();

-- All mutation entry points are server-only; verified server claims supply IDs.
do $$ declare item record; begin
  for item in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('set_user_sms_required','reserve_sms_challenge',
      'deliver_sms_challenge','verify_sms_challenge','get_sms_required','prepare_sms_phone_change')
  loop
    execute format('revoke all on function %s from public,anon,authenticated',item.signature);
    execute format('grant execute on function %s to service_role',item.signature);
  end loop;
end $$;
notify pgrst,'reload config';
notify pgrst,'reload schema';
