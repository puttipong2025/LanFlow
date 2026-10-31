-- Employee requests must not rely on actor/source/report facts read before waiting.
do $migration$
declare definition text; anchor text := $old$  where id = p_withdrawal_id
  for update;

  v_base := private.latest_withdrawal_target(v_source.id);$old$;
begin
 select pg_get_functiondef('public.request_time_tracking_withdrawal_adjustment(uuid,numeric,uuid,text)'::regprocedure) into definition;
 definition:=replace(definition,chr(13),'');
 anchor:=replace(anchor,chr(13),'');
 if strpos(definition,anchor)=0 then raise exception 'ADJUSTMENT_REQUEST_FENCE_PATCH_BLOCKED'; end if;
 execute replace(definition,anchor,$new$  where id = p_withdrawal_id
  for update;
  if not found or v_source.type <> 'WITHDRAWAL'
    or v_source.status <> 'APPROVED' or v_source.cancelled_at is not null then
    raise exception 'WITHDRAWAL_SOURCE_NOT_FOUND';
  end if;
  perform private.lock_report_locations(array[v_source.expense_location_id]);
  if not private.is_active_user() then raise exception 'Authentication required'; end if;
  v_is_manager := private.can_manage_time_payroll_profile(v_source.profile_id);
  if v_source.profile_id <> v_actor_id and not v_is_manager then raise exception 'Forbidden'; end if;
  if not v_is_manager and p_expense_location_id is not null then raise exception 'Forbidden'; end if;
  if v_is_manager and p_expense_location_id is not null
    and not private.can_assign_time_tracking_expense_location(p_expense_location_id)
  then raise exception 'ADJUSTMENT_BRANCH_REQUIRED'; end if;
  if private.active_report_no('financial_transaction',v_source.id) is null then
    raise exception 'WITHDRAWAL_NOT_REPORT_LOCKED';
  end if;

  v_base := private.latest_withdrawal_target(v_source.id);$new$);
end $migration$;
