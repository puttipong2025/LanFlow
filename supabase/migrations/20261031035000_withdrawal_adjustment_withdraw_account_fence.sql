-- A pending-request owner may be deactivated while waiting for the row.
-- Recheck after that wait before deleting the request; keep ownership/status guards.
do $migration$
declare definition text; anchor text := $old$  if not found then raise exception 'ADJUSTMENT_NOT_FOUND'; end if;
  if v_adjustment.profile_id <> v_actor_id then raise exception 'Forbidden'; end if;$old$;
begin
  select pg_get_functiondef('public.withdraw_time_tracking_withdrawal_adjustment(uuid)'::regprocedure) into definition;
  definition := replace(definition, chr(13), '');
  anchor := replace(anchor, chr(13), '');
  if strpos(definition, anchor) = 0 then raise exception 'ADJUSTMENT_WITHDRAW_ACCOUNT_FENCE_PATCH_BLOCKED'; end if;
  execute replace(definition, anchor, $new$  if not found then raise exception 'ADJUSTMENT_NOT_FOUND'; end if;
  if not private.is_active_user() then raise exception 'Authentication required'; end if;
  if v_adjustment.profile_id <> v_actor_id then raise exception 'Forbidden'; end if;$new$);
end $migration$;
