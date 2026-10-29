-- Match the legacy wrapper's key-before-source locking order.
do $$
declare v_source text; v_old text; v_new text;
begin
  select pg_get_functiondef('public.sync_income_expense_background(jsonb)'::regprocedure) into v_source;
  v_old := '  -- Same source lock as the preserved dispatcher; also serializes cross-tab submits.';
  v_new := '  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(''income-expense-submission:''||(payload->>''idempotencyKey''),0));' || chr(10) || v_old;
  if position(v_old in v_source)=0 then raise exception 'Background lock marker not found'; end if;
  execute replace(v_source,v_old,v_new);
end $$;
create index income_background_pending_request_idx
  on private.income_expense_background_commands ((result->>'requestId'))
  where result->>'outcome'='pending_approval';
