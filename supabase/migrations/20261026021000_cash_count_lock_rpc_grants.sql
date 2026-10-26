-- Recreated compatibility functions must retain the original authenticated-only grant.
revoke all on function public.save_cash_count_alert_group(uuid,uuid[],integer) from public,anon;
grant execute on function public.save_cash_count_alert_group(uuid,uuid[],integer) to authenticated;
