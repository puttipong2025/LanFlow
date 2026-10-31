-- Decisions must use current permissions after waiting for another payroll mutation.
do $migration$
declare definition text; anchor text := $old$  where id = p_adjustment_id and type = 'ADJUSTMENT'
  for update;
  select * into v_source$old$;
begin
 select pg_get_functiondef('public.decide_time_tracking_withdrawal_adjustment(uuid,text,uuid,text)'::regprocedure) into definition;
 definition:=replace(definition,chr(13),'');
 anchor:=replace(anchor,chr(13),'');
 if strpos(definition,anchor)=0 then raise exception 'ADJUSTMENT_APPROVAL_PERMISSION_PATCH_BLOCKED'; end if;
 execute replace(definition,anchor,$new$  where id = p_adjustment_id and type = 'ADJUSTMENT'
  for update;
  if not found then raise exception 'ADJUSTMENT_NOT_FOUND'; end if;
  if not private.is_active_user() then raise exception 'Authentication required'; end if;
  if not private.can_manage_time_payroll_profile(v_adjustment.profile_id) then
    raise exception 'Forbidden';
  end if;
  select * into v_source$new$);
end $migration$;
