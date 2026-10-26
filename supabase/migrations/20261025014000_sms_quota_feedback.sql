-- Service-only quota feedback for the authenticated account.
create or replace function public.reserve_sms_challenge(p_user uuid, p_session uuid, p_id uuid, p_digest text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare account private.sms_account_security%rowtype; destination text;
begin
  select * into account from private.sms_account_security where user_id=p_user for update;
  if account.user_id is null or not account.required then return jsonb_build_object('error','NOT_REQUIRED'); end if;
  if not exists(select 1 from public.profiles where id=p_user and is_active and role<>'super_admin')
    or not exists(select 1 from auth.sessions where id=p_session and user_id=p_user and created_at>account.revoked_before
      and (not_after is null or not_after>now())) then return jsonb_build_object('error','SESSION_REVOKED'); end if;
  if account.last_sent_at > now()-interval '30 seconds' then
    return jsonb_build_object('error','RATE_LIMITED','quota',jsonb_build_object('scope','cooldown','count',account.sends,'limit',10),'retryAfter',ceil(extract(epoch from account.last_sent_at+interval '30 seconds'-now())));
  end if;
  if account.send_window > now()-interval '1 hour' and account.sends>=10 then
    return jsonb_build_object('error','RATE_LIMITED','quota',jsonb_build_object('scope','account','count',account.sends,'limit',10),'retryAfter',ceil(extract(epoch from account.send_window+interval '1 hour'-now())));
  end if;
  if account.failure_window > now()-interval '1 hour' and account.failures>=10 then
    return jsonb_build_object('error','RATE_LIMITED','quota',jsonb_build_object('scope','attempts','count',account.failures,'limit',10),'retryAfter',ceil(extract(epoch from account.failure_window+interval '1 hour'-now())));
  end if;
  -- Serialize global sending to cap cost across accounts; no IP trust dependency.
  perform pg_advisory_xact_lock(hashtextextended('lanflow-sms-global',0));
  if (select coalesce(sum(sends),0) from private.sms_account_security where send_window>now()-interval '1 hour')>=200 then
    return jsonb_build_object('error','RATE_LIMITED','quota',jsonb_build_object('scope','global','count',200,'limit',200),'retryAfter',
      (select greatest(1,ceil(extract(epoch from min(send_window)+interval '1 hour'-now())))
       from private.sms_account_security where send_window>now()-interval '1 hour')); end if;
  select phone into destination from auth.users where id=p_user;
  update private.sms_account_security set last_sent_at=now(),
    sends=case when send_window<=now()-interval '1 hour' then 1 else sends+1 end,
    send_window=case when send_window<=now()-interval '1 hour' then now() else send_window end where user_id=p_user;
  insert into private.sms_login_challenges values(p_session,p_user,account.generation,destination,p_id,p_digest,now()+interval '5 minutes',0,false,false)
    on conflict(session_id) do update set generation=excluded.generation, phone=excluded.phone,
      challenge_id=excluded.challenge_id,digest=excluded.digest,expires_at=excluded.expires_at,attempts=0,delivered=false,verified=false;
  return jsonb_build_object('phone',destination,
    'sentCount',case when account.send_window<=now()-interval '1 hour' then 1 else account.sends+1 end,
    'sendLimit',10,
    'resetAt',(case when account.send_window<=now()-interval '1 hour' then now() else account.send_window end)+interval '1 hour');
end $$;


create function public.sms_send_usage(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object(
    'sentCount',case when send_window>now()-interval '1 hour' then sends else 0 end,
    'sendLimit',10,
    'resetAt',case when send_window>now()-interval '1 hour' then send_window+interval '1 hour' else null end,
    'resendAt',greatest(last_sent_at+interval '30 seconds',
       case when sends>=10 and send_window>now()-interval '1 hour' then send_window+interval '1 hour' else now() end,
       case when failures>=10 and failure_window>now()-interval '1 hour' then failure_window+interval '1 hour' else now() end))
    from private.sms_account_security where user_id=p_user), jsonb_build_object('sentCount',0,'sendLimit',10))
$$;
revoke all on function public.sms_send_usage(uuid) from public, anon, authenticated;
grant execute on function public.sms_send_usage(uuid) to service_role;
notify pgrst, 'reload schema';
