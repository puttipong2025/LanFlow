-- Keep price-adjustment receipt metadata on synthetic pending-create feed rows.

do $migration$
declare
  v_definition text;
  v_rewritten text;
  v_old constant text := $old$        'configured_price_snapshot', r.configured_price_snapshot,
        'created_by_user_id', r.requested_by_user_id,$old$;
  v_new constant text := $new$        'configured_price_snapshot', r.configured_price_snapshot,
        'price_adjustment_target', coalesce((r.proposed_payload->>'priceAdjustmentTarget')::numeric, 0),
        'created_by_user_id', r.requested_by_user_id,$new$;
begin
  select pg_get_functiondef(
    'public.get_rubber_bill_operational_feed_v2(uuid,text,text,text,timestamptz,text,integer)'::regprocedure
  ) into v_definition;

  if (length(v_definition) - length(replace(v_definition, v_old, '')))
       <> length(v_old) then
    raise exception 'unexpected Rubber Bill operational feed definition';
  end if;

  v_rewritten := replace(v_definition, v_old, v_new);
  execute v_rewritten;
end;
$migration$;

notify pgrst, 'reload schema';
