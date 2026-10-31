-- The slip snapshot must include adjustments committed before it acquires the
-- employee fence, even when the caller's transaction started earlier.
-- Stamp only new slips from the existing creation RPC; preserve historical rows
-- and the as-of semantics of direct/imported snapshots.
do $migration$
declare definition text; columns_anchor text := $old$    status,
    created_by
  )
  values ($old$;
  values_anchor text := $old$    'PENDING',
    v_actor_id
  )
  returning * into v_slip;$old$;
begin
  select pg_get_functiondef('public.create_time_tracking_payroll_slip_internal_20260901(uuid,text,boolean)'::regprocedure) into definition;
  definition := replace(definition, chr(13), '');
  columns_anchor := replace(columns_anchor, chr(13), '');
  values_anchor := replace(values_anchor, chr(13), '');
  if strpos(definition, '  v_slip public.payroll_slips%rowtype;') = 0
    or strpos(definition, '  insert into public.payroll_slips (') = 0
    or strpos(definition, columns_anchor) = 0 or strpos(definition, values_anchor) = 0
    or strpos(definition, '''lockedAt'', now()') = 0 then
    raise exception 'PAYROLL_SLIP_SNAPSHOT_CLOCK_PATCH_BLOCKED';
  end if;
  definition := replace(definition, '  v_slip public.payroll_slips%rowtype;', E'  v_slip public.payroll_slips%rowtype;\n  v_snapshot_at timestamptz;');
  definition := replace(definition, '  insert into public.payroll_slips (', E'  v_snapshot_at := clock_timestamp();\n  insert into public.payroll_slips (');
  definition := replace(definition, columns_anchor, $new$    status,
    created_by,
    created_at
  )
  values ($new$);
  definition := replace(definition, values_anchor, $new$    'PENDING',
    v_actor_id,
    v_snapshot_at
  )
  returning * into v_slip;$new$);
  execute replace(definition, '''lockedAt'', now()', '''lockedAt'', v_snapshot_at');
end $migration$;
