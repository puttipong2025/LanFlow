-- Match the live feed's timestamp and stable text key for its largest sources.

create index dashboard_income_expense_money_feed_idx
  on public.income_expense (
    location_id,
    (coalesce(client_recorded_at, created_at)) desc,
    (('actual:'::text || id::text)) desc
  )
  where record_status = 'active' and cost > 0;

create index dashboard_rubber_bill_money_feed_idx
  on public.rubber_bills (
    location_id,
    (coalesce(client_recorded_at, created_at)) desc,
    (('rubber-bill:'::text || id::text)) desc
  )
  where record_status = 'active';

create index dashboard_ocr_money_feed_idx
  on public.ocr_tickets (
    location_id,
    (coalesce(client_recorded_at, created_at)) desc,
    (('ocr-ticket:'::text || id::text)) desc
  )
  where record_status = 'active' and total_amount > 0;
