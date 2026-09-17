-- The existing enforce_atomic_money_transfer_delete trigger already rejects every
-- direct record_status soft delete before this feature-specific trigger can run.
drop trigger if exists reject_rubber_export_work_soft_delete on public.money_transfers;
drop function if exists private.reject_rubber_export_work_soft_delete();
