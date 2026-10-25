create table private.sms_ip_budgets (
  bucket_hash text primary key,
  window_started_at timestamptz not null default now(),
  sends integer not null default 0
);
revoke all on private.sms_ip_budgets from public, anon, authenticated;
grant all on private.sms_ip_budgets to service_role;

create function public.claim_sms_ip_budget(p_hash text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare budget private.sms_ip_budgets%rowtype;
begin
  if p_hash !~ '^[a-f0-9]{64}$' then return false; end if;
  insert into private.sms_ip_budgets(bucket_hash) values(p_hash) on conflict do nothing;
  select * into budget from private.sms_ip_budgets where bucket_hash=p_hash for update;
  if budget.window_started_at>now()-interval '1 hour' and budget.sends>=20 then return false; end if;
  update private.sms_ip_budgets set
    sends=case when window_started_at<=now()-interval '1 hour' then 1 else sends+1 end,
    window_started_at=case when window_started_at<=now()-interval '1 hour' then now() else window_started_at end
    where bucket_hash=p_hash;
  -- Opportunistic cleanup avoids adding a separate scheduler.
  delete from private.sms_ip_budgets where window_started_at<now()-interval '2 hours';
  delete from private.sms_login_challenges c where c.expires_at<now()-interval '1 day'
    and (not c.verified or not exists(select 1 from auth.sessions s where s.id=c.session_id));
  return true;
end $$;
revoke all on function public.claim_sms_ip_budget(text) from public, anon, authenticated;
grant execute on function public.claim_sms_ip_budget(text) to service_role;
notify pgrst, 'reload schema';
