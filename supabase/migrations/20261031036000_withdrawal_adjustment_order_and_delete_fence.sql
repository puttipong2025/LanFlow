begin;
-- now() is the transaction start, which may precede another completed approval.
-- Capture the approval time only after acquiring all existing serialization locks.
do $migration$
declare definition text; anchor text := $old$  perform set_config('app.time_tracking_expense_rpc', 'true', true);
  update public.financial_transactions
  set status = 'APPROVED', approved_by = v_actor_id, approved_at = now(),$old$;
begin
  select pg_get_functiondef('public.decide_time_tracking_withdrawal_adjustment(uuid,text,uuid,text)'::regprocedure) into definition;
  definition := replace(definition, chr(13), '');
  anchor := replace(anchor, chr(13), '');
  if strpos(definition, anchor) = 0 or strpos(definition, '  v_payload jsonb;') = 0
    or strpos(definition, '''approvedAt'', now()') = 0 then
    raise exception 'ADJUSTMENT_APPROVAL_CLOCK_PATCH_BLOCKED';
  end if;
  definition := replace(definition, '  v_payload jsonb;', E'  v_payload jsonb;\n  v_approved_at timestamptz;');
  definition := replace(definition, anchor, $new$  perform set_config('app.time_tracking_expense_rpc', 'true', true);
  v_approved_at := clock_timestamp();
  update public.financial_transactions
  set status = 'APPROVED', approved_by = v_actor_id, approved_at = v_approved_at,$new$);
  execute replace(definition, '''approvedAt'', now()', '''approvedAt'', v_approved_at');
end $migration$;

-- The branch fence is a second wait after the existing employee/row fence.
-- Permission checks made before it cannot authorize the subsequent deletion.
do $migration$
declare definition text; anchor text := ' select id into latest_id from public.financial_transactions';
begin
  select pg_get_functiondef('private.delete_withdrawal_adjustment(uuid)'::regprocedure) into definition;
  definition := replace(definition, chr(13), '');
  if strpos(definition, anchor) = 0 then raise exception 'ADJUSTMENT_DELETE_BRANCH_PERMISSION_PATCH_BLOCKED'; end if;
  execute replace(definition, anchor, $new$ if not private.is_active_user() then raise exception 'Authentication required'; end if;
 if not private.can_manage_time_payroll_profile(adjustment.profile_id) then raise exception 'Forbidden'; end if;
 if not private.is_global_time_payroll_manager() and adjustment.expense_location_id is not null
   and not private.can_assign_time_tracking_expense_location(adjustment.expense_location_id) then
   raise exception 'Existing expense location access denied'; end if;
 select id into latest_id from public.financial_transactions$new$);
end $migration$;
notify pgrst, 'reload schema';
commit;
