-- Dashboard rows are derived/configuration data and must not outlive their
-- source branch or stock product.

alter table public.dashboard_branch_snapshots
  drop constraint dashboard_branch_snapshots_location_id_fkey,
  add constraint dashboard_branch_snapshots_location_id_fkey
    foreign key (location_id) references public.locations(id) on delete cascade;

alter table public.dashboard_alert_thresholds
  drop constraint dashboard_alert_thresholds_location_id_fkey,
  add constraint dashboard_alert_thresholds_location_id_fkey
    foreign key (location_id) references public.locations(id) on delete cascade;

alter table public.dashboard_stock_alert_thresholds
  drop constraint dashboard_stock_alert_thresholds_location_id_fkey,
  add constraint dashboard_stock_alert_thresholds_location_id_fkey
    foreign key (location_id) references public.locations(id) on delete cascade,
  drop constraint dashboard_stock_alert_thresholds_product_id_fkey,
  add constraint dashboard_stock_alert_thresholds_product_id_fkey
    foreign key (product_id) references public.stock_products(id)
    on delete cascade;
