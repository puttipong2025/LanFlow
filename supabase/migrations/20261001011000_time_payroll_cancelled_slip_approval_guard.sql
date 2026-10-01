-- A cancelled or rejected payroll slip reopens its month. Keep transaction
-- approval aligned with the shared closed-month definition.
do $migration$
declare
  v_definition text;
  v_old text := $old$where ps.profile_id = v_tx.profile_id
        and ps.month = to_char(v_tx.effective_date, 'YYYY-MM')$old$;
  v_new text := $new$where ps.profile_id = v_tx.profile_id
        and ps.month = to_char(v_tx.effective_date, 'YYYY-MM')
        and ps.status in ('PENDING', 'APPROVED')
        and ps.cancelled_at is null$new$;
begin
  select pg_get_functiondef(
    'public.decide_time_tracking_approval_internal_20260829(text,uuid,text,text,uuid)'::regprocedure
  ) into v_definition;

  if strpos(v_definition, v_old) = 0 then
    raise exception 'PAYROLL_CANCELLED_SLIP_APPROVAL_GUARD_BLOCKED: base month guard changed';
  end if;

  execute replace(v_definition, v_old, v_new);
end
$migration$;

notify pgrst, 'reload schema';
