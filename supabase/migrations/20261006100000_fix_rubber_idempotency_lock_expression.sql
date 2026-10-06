-- Repair installations that received the initial lock expression before its precedence fix.

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef('public.sync_rubber_bill(jsonb)'::regprocedure)
    into v_definition;

  v_updated := replace(
    v_definition,
    $old$'rubber-bill-idempotency:' || payload->>'idempotencyKey'$old$,
    $new$'rubber-bill-idempotency:' || (payload->>'idempotencyKey')$new$
  );
  if v_updated <> v_definition then
    execute v_updated;
  end if;
end;
$migration$;
