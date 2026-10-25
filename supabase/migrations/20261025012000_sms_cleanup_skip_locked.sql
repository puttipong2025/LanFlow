-- Opportunistic cleanup must not wait for another active sending transaction.
create or replace function public.claim_sms_ip_budget(p_hash text) returns boolean
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
notify pgrst, 'reload schema';
