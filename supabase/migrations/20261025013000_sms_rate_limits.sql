-- Approved: 30s resend, 10/account/hour, 50/IP/hour, 200 global/hour.
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
    return jsonb_build_object('error','RATE_LIMITED','retryAfter',ceil(extract(epoch from account.last_sent_at+interval '30 seconds'-now())));
  end if;
  if account.send_window > now()-interval '1 hour' and account.sends>=10 then
    return jsonb_build_object('error','RATE_LIMITED','retryAfter',ceil(extract(epoch from account.send_window+interval '1 hour'-now())));
  end if;
  if account.failure_window > now()-interval '1 hour' and account.failures>=10 then
    return jsonb_build_object('error','RATE_LIMITED','retryAfter',ceil(extract(epoch from account.failure_window+interval '1 hour'-now())));
  end if;
  -- Serialize global sending to cap cost across accounts; no IP trust dependency.
  perform pg_advisory_xact_lock(hashtextextended('lanflow-sms-global',0));
  if (select coalesce(sum(sends),0) from private.sms_account_security where send_window>now()-interval '1 hour')>=200 then
    return jsonb_build_object('error','RATE_LIMITED','retryAfter',
      (select greatest(1,ceil(extract(epoch from min(send_window)+interval '1 hour'-now())))
       from private.sms_account_security where send_window>now()-interval '1 hour')); end if;
  select phone into destination from auth.users where id=p_user;
  update private.sms_account_security set last_sent_at=now(),
    sends=case when send_window<=now()-interval '1 hour' then 1 else sends+1 end,
    send_window=case when send_window<=now()-interval '1 hour' then now() else send_window end where user_id=p_user;
  insert into private.sms_login_challenges values(p_session,p_user,account.generation,destination,p_id,p_digest,now()+interval '5 minutes',0,false,false)
    on conflict(session_id) do update set generation=excluded.generation, phone=excluded.phone,
      challenge_id=excluded.challenge_id,digest=excluded.digest,expires_at=excluded.expires_at,attempts=0,delivered=false,verified=false;
  return jsonb_build_object('phone',destination);
end $$;

-- Opportunistic cleanup must not wait for another active sending transaction.
create or replace function public.claim_sms_ip_budget(p_hash text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare budget private.sms_ip_budgets%rowtype;
begin
  if p_hash !~ '^[a-f0-9]{64}$' then return false; end if;
  insert into private.sms_ip_budgets(bucket_hash) values(p_hash) on conflict do nothing;
  select * into budget from private.sms_ip_budgets where bucket_hash=p_hash for update;
  if budget.window_started_at>now()-interval '1 hour' and budget.sends>=50 then return false; end if;
  update private.sms_ip_budgets set
    sends=case when window_started_at<=now()-interval '1 hour' then 1 else sends+1 end,
    window_started_at=case when window_started_at<=now()-interval '1 hour' then now() else window_started_at end
    where bucket_hash=p_hash;
  delete from private.sms_ip_budgets b using (
    select bucket_hash from private.sms_ip_budgets
    where window_started_at<now()-interval '2 hours' for update skip locked
  ) stale where b.bucket_hash=stale.bucket_hash;
  delete from private.sms_login_challenges c using (
    select session_id from private.sms_login_challenges candidate
    where candidate.expires_at<now()-interval '1 day'
      and (not candidate.verified or not exists(select 1 from auth.sessions s where s.id=candidate.session_id))
    for update skip locked
  ) stale where c.session_id=stale.session_id;
  return true;
end $$;


-- Read only after the atomic IP claim rejects. Browser roles cannot call this.
create function public.sms_ip_retry_after(p_hash text) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select greatest(1,ceil(extract(epoch from window_started_at+interval '1 hour'-now())))::integer
    from private.sms_ip_budgets where bucket_hash=p_hash),1)
$$;
revoke all on function public.sms_ip_retry_after(text) from public, anon, authenticated;
grant execute on function public.sms_ip_retry_after(text) to service_role;
notify pgrst, 'reload schema';
