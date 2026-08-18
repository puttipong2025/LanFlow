-- Cursor and child-detail indexes justified by the bounded Rubber/Money Transfer read seams.
create index if not exists rubber_bills_operational_cursor_idx
  on public.rubber_bills (location_id, coalesce(client_created_at, created_at) desc, id desc)
  where record_status = 'active';

create index if not exists ocr_tickets_source_cursor_idx
  on public.ocr_tickets (location_id, created_at desc, id desc)
  where record_status = 'active';

create index if not exists money_transfer_items_transfer_idx
  on public.money_transfer_items (transfer_id, created_at, id);

create index if not exists money_transfer_slips_transfer_idx
  on public.money_transfer_slips (transfer_id, sort_order, id);

create index if not exists rubber_bill_approval_current_work_idx
  on public.rubber_bill_approval_requests (location_id, requested_at, id)
  where request_status = 'pending';
