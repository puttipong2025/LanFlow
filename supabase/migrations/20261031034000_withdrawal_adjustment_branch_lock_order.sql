-- Approval rebuilds every open parent. Acquire its branches and the payer
-- together, in the same sorted order already used by adjustment deletion.
begin;
do $migration$
declare definition text; anchor text := '  perform private.lock_report_locations(array[v_source.expense_location_id]);';
begin
  select pg_get_functiondef('public.request_time_tracking_withdrawal_adjustment(uuid,numeric,uuid,text)'::regprocedure) into definition;
  definition := replace(definition, chr(13), '');
  if strpos(definition, anchor) = 0 then raise exception 'ADJUSTMENT_REQUEST_BRANCH_FENCE_PATCH_BLOCKED'; end if;
  execute replace(definition, anchor, $new$  perform private.lock_report_locations(array(
    select p_expense_location_id
    union
    select expense_location_id from public.financial_transactions
    where profile_id = v_source.profile_id and status = 'APPROVED' and cancelled_at is null
      and type in ('DEBT', 'WITHDRAWAL', 'ADJUSTMENT') and expense_location_id is not null
  ));$new$);
end $migration$;

do $migration$
declare definition text; anchor text := $old$  if not found then raise exception 'ADJUSTMENT_NOT_FOUND'; end if;
  if not private.is_active_user() then raise exception 'Authentication required'; end if;$old$;
begin
  select pg_get_functiondef('public.decide_time_tracking_withdrawal_adjustment(uuid,text,uuid,text)'::regprocedure) into definition;
  definition := replace(definition, chr(13), '');
  anchor := replace(anchor, chr(13), '');
  if strpos(definition, anchor) = 0 then raise exception 'ADJUSTMENT_APPROVAL_BRANCH_FENCE_PATCH_BLOCKED'; end if;
  execute replace(definition, anchor, $new$  if not found then raise exception 'ADJUSTMENT_NOT_FOUND'; end if;
  if p_decision = 'APPROVED' then
    perform private.lock_report_locations(array(
      select p_expense_location_id
      union
      select expense_location_id from public.financial_transactions
      where profile_id = v_adjustment.profile_id and status = 'APPROVED' and cancelled_at is null
        and type in ('DEBT', 'WITHDRAWAL', 'ADJUSTMENT') and expense_location_id is not null
    ));
  end if;
  if not private.is_active_user() then raise exception 'Authentication required'; end if;$new$);
end $migration$;
notify pgrst, 'reload schema';
commit;
