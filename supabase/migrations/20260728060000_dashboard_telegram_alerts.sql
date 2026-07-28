-- Telegram reads the same completed branch snapshots as the Dashboard.
-- Healthy values are intentionally absent from this result.

alter table public.dashboard_alert_thresholds
  alter column purchase_average_min set default 30000;

update public.dashboard_alert_thresholds
set purchase_average_min = 30000,
    updated_at = now()
where purchase_average_min is null;

create or replace function public.get_dashboard_alerts_for_telegram()
returns table (
  location_id uuid,
  branch_name text,
  alert_key text,
  metric_label text,
  current_value numeric,
  minimum_value numeric,
  unit text,
  detail text
)
language sql
stable
security definer
set search_path = ''
as $$
  with branch_metrics as (
    select
      l.id as location_id,
      l.name as branch_name,
      s.summary,
      t.purchase_average_min,
      t.net_cash_min
    from public.locations l
    join public.dashboard_branch_snapshots s on s.location_id = l.id
    join public.dashboard_alert_thresholds t on t.location_id = l.id
    where l.is_active = true
      and s.summary is not null
  ),
  scalar_alerts as (
    select
      b.location_id,
      b.branch_name,
      'purchase_average_7_days'::text as alert_key,
      'ยอดซื้อเฉลี่ย 7 วัน'::text as metric_label,
      round((b.summary #>> '{purchase7Days,dailyAverage}')::numeric, 2)
        as current_value,
      b.purchase_average_min as minimum_value,
      'บาท/วัน'::text as unit,
      'ต่ำกว่ายอดขั้นต่ำ'::text as detail
    from branch_metrics b
    where b.purchase_average_min is not null
      and (b.summary #>> '{purchase7Days,dailyAverage}')::numeric
        < b.purchase_average_min

    union all

    select
      b.location_id,
      b.branch_name,
      'net_cash_accumulated',
      'รับ–จ่ายสุทธิสะสม',
      round((b.summary ->> 'netCashFlow')::numeric, 2),
      b.net_cash_min,
      'บาท',
      'ต่ำกว่ายอดขั้นต่ำ'
    from branch_metrics b
    where (b.summary ->> 'netCashFlow')::numeric < b.net_cash_min
  ),
  stock_alerts as (
    select
      b.location_id,
      b.branch_name,
      'stock:' || (product.item ->> 'productId') as alert_key,
      'สต็อกสินค้า · ' || (product.item ->> 'name') as metric_label,
      round((product.item ->> 'balance')::numeric, 2) as current_value,
      threshold.minimum_balance as minimum_value,
      product.item ->> 'unit' as unit,
      'ต่ำกว่ายอดขั้นต่ำ'::text as detail
    from branch_metrics b
    cross join lateral jsonb_array_elements(
      coalesce(b.summary #> '{stock,items}', '[]'::jsonb)
    ) product(item)
    join public.dashboard_stock_alert_thresholds threshold
      on threshold.location_id = b.location_id
     and threshold.product_id = (product.item ->> 'productId')::uuid
    where (product.item ->> 'balance')::numeric < threshold.minimum_balance
  )
  select * from scalar_alerts
  union all
  select * from stock_alerts
  order by branch_name, alert_key;
$$;

revoke all on function public.get_dashboard_alerts_for_telegram()
  from public, anon, authenticated;
grant execute on function public.get_dashboard_alerts_for_telegram()
  to service_role;
