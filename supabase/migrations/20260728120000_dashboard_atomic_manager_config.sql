-- Save the global interval and one branch's Telegram thresholds atomically.

create or replace function public.save_dashboard_manager_config(
  p_location_id uuid,
  p_interval_minutes integer,
  p_purchase_average_min numeric,
  p_net_cash_min numeric,
  p_stock_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
begin
  perform private.dashboard_require_manager();

  if jsonb_typeof(p_stock_items) <> 'array' then
    raise exception 'เกณฑ์สต็อกไม่ถูกต้อง';
  end if;

  perform public.save_dashboard_refresh_interval(p_interval_minutes);
  perform public.save_dashboard_alert_thresholds(
    p_location_id,
    p_purchase_average_min,
    p_net_cash_min
  );

  for item in select value from jsonb_array_elements(p_stock_items)
  loop
    perform public.save_dashboard_stock_alert_threshold(
      p_location_id,
      (item ->> 'productId')::uuid,
      case
        when item -> 'minimumBalance' = 'null'::jsonb then null
        else (item ->> 'minimumBalance')::numeric
      end
    );
  end loop;

  return jsonb_build_object(
    'settings', public.get_dashboard_refresh_settings(),
    'thresholds', public.get_dashboard_alert_thresholds(p_location_id)
  );
end;
$$;

revoke all on function public.save_dashboard_manager_config(
  uuid,
  integer,
  numeric,
  numeric,
  jsonb
) from public, anon;
grant execute on function public.save_dashboard_manager_config(
  uuid,
  integer,
  numeric,
  numeric,
  jsonb
) to authenticated;
