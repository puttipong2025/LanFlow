-- Permission may change while a deletion waits for the employee fence.
do $migration$
declare definition text; anchor text := ' select * into source from public.financial_transactions where id=adjustment.parent_debt_id for update;';
begin
 select pg_get_functiondef('private.delete_withdrawal_adjustment(uuid)'::regprocedure) into definition;
 if strpos(definition,anchor)=0 then raise exception 'ADJUSTMENT_PERMISSION_PATCH_BLOCKED'; end if;
 execute replace(definition,anchor,$new$ if not private.is_active_user() or not private.can_manage_time_payroll_profile(adjustment.profile_id) then
   raise exception 'Forbidden'; end if;
 select * into source from public.financial_transactions where id=adjustment.parent_debt_id for update;$new$);
end $migration$;
