-- User approved 5/account/hour; cooldown/IP/global/wrong-code limits unchanged.
-- Preserve all active account restrictions in retry feedback.
create or replace function public.reserve_sms_challenge(p_user uuid, p_session uuid, p_id uuid, p_digest text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare account private.sms_account_security%rowtype; destination text; blocked record;
begin
  select * into account from private.sms_account_security where user_id=p_user for update;
  if account.user_id is null or not account.required then return jsonb_build_object('error','NOT_REQUIRED'); end if;
  if not exists(select 1 from public.profiles where id=p_user and is_active and role<>'super_admin')
    or not exists(select 1 from auth.sessions where id=p_session and user_id=p_user and created_at>account.revoked_before
      and (not_after is null or not_after>now())) then return jsonb_build_object('error','SESSION_REVOKED'); end if;
  -- Select the latest active account restriction, not merely the first one.
  select * into blocked from (values
    ('cooldown',coalesce(account.last_sent_at+interval '30 seconds',now()),account.sends,5,1),
    ('account',case when account.send_window>now()-interval '1 hour' and account.sends>=5
      then account.send_window+interval '1 hour' else now() end,account.sends,5,2),
    ('attempts',case when account.failure_window>now()-interval '1 hour' and account.failures>=10
      then account.failure_window+interval '1 hour' else now() end,account.failures,10,3)
  ) limits(scope,retry_at,used,maximum,priority) order by retry_at desc,priority desc limit 1;
  if blocked.retry_at>now() then
    return jsonb_build_object('error','RATE_LIMITED',
      'quota',jsonb_build_object('scope',blocked.scope,'count',blocked.used,'limit',blocked.maximum),
      'retryAfter',ceil(extract(epoch from blocked.retry_at-now())));
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
    'sendLimit',5,
    'resetAt',(case when account.send_window<=now()-interval '1 hour' then now() else account.send_window end)+interval '1 hour');
end $$;




create or replace function public.sms_send_usage(p_user uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object(
    'sentCount',case when send_window>now()-interval '1 hour' then sends else 0 end,
    'sendLimit',5,
    'resetAt',case when send_window>now()-interval '1 hour' then send_window+interval '1 hour' else null end,
    'resendAt',greatest(last_sent_at+interval '30 seconds',
       case when sends>=5 and send_window>now()-interval '1 hour' then send_window+interval '1 hour' else now() end,
       case when failures>=10 and failure_window>now()-interval '1 hour' then failure_window+interval '1 hour' else now() end))
    from private.sms_account_security where user_id=p_user), jsonb_build_object('sentCount',0,'sendLimit',5))
$$;
revoke all on function public.sms_send_usage(uuid) from public, anon, authenticated;
grant execute on function public.sms_send_usage(uuid) to service_role;
notify pgrst, 'reload schema';
