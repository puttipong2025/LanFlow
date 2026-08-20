-- Apply after rubber_export_rubber_value_backfill_before.sql.
-- The migration must abort with RUBBER_EXPORT_PAID_SOURCE_DRIFT and a bounded ID list.
update public.rubber_export_items
set paid_amount = paid_amount - 1
where export_id = 'b6000000-0000-4000-8000-000000000001';
