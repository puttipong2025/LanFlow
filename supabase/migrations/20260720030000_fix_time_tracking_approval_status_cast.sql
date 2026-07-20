-- `p_decision` is text at the RPC boundary; compare it explicitly to the enum.
-- Keep this as a forward migration because the original relation migration has
-- already been applied to local development databases.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.decide_time_tracking_approval(text, uuid, text, text, uuid)'::regprocedure)
    into v_definition;

  v_definition := replace(
    v_definition,
    'v_tx.status = p_decision',
    'v_tx.status = p_decision::public.approval_status'
  );
  v_definition := replace(
    v_definition,
    'v_slip.status = p_decision',
    'v_slip.status = p_decision::public.approval_status'
  );

  execute v_definition;
end;
$$;
