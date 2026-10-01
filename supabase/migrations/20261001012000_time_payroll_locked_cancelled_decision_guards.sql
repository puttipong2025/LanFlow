-- Recheck cancellation after the per-employee advisory lock and row lock. The
-- public fail-fast guard alone cannot close a cancellation/decision race.
do $migration$
declare
  v_definition text;
  v_transaction_old text := $old$where id = p_source_id
    for update;
    if not found or v_tx.type not in ('DEBT', 'WITHDRAWAL') then
      raise exception 'Transaction not found';
    end if;$old$;
  v_transaction_new text := $new$where id = p_source_id
    for update;
    if not found or v_tx.type not in ('DEBT', 'WITHDRAWAL') then
      raise exception 'Transaction not found';
    end if;
    if v_tx.cancelled_at is not null then
      raise exception 'Approval has already been decided';
    end if;$new$;
  v_slip_old text := $old$where id = p_source_id
    for update;
    if not found then raise exception 'Payroll slip not found'; end if;$old$;
  v_slip_new text := $new$where id = p_source_id
    for update;
    if not found then raise exception 'Payroll slip not found'; end if;
    if v_slip.cancelled_at is not null then
      raise exception 'Approval has already been decided';
    end if;$new$;
begin
  select pg_get_functiondef(
    'public.decide_time_tracking_approval_internal_20260829(text,uuid,text,text,uuid)'::regprocedure
  ) into v_definition;

  if strpos(v_definition, v_transaction_old) = 0
    or strpos(v_definition, v_slip_old) = 0
  then
    raise exception 'PAYROLL_LOCKED_CANCELLED_DECISION_GUARD_BLOCKED: base decision guards changed';
  end if;

  execute replace(
    replace(v_definition, v_transaction_old, v_transaction_new),
    v_slip_old,
    v_slip_new
  );
end
$migration$;

notify pgrst, 'reload schema';
