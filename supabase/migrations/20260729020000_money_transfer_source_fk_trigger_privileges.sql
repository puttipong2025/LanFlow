-- money_transfer_items are written by authenticated clients, but rubber_bills
-- intentionally grant those clients SELECT only. The source-FK trigger locks
-- the referenced source with SELECT ... FOR UPDATE, which also requires UPDATE
-- privilege when the function runs as the caller.
--
-- Run the trigger as its postgres owner so the row locks remain atomic without
-- granting browser clients direct UPDATE access to source tables.
alter function public.sync_money_transfer_item_source_fks() security definer;

-- Trigger execution does not require callers to execute the function directly.
revoke all on function public.sync_money_transfer_item_source_fks()
  from public, anon, authenticated;
