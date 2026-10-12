-- The public merge RPC has owned its implementation since
-- 20260819150000_explain_report_locked_pending_merge.sql. The former private
-- implementation has no remaining callers or database dependencies.

drop function if exists private.merge_pending_money_transfers(uuid);
