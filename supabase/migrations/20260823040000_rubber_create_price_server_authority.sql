-- Treat the client Rubber Bill price snapshot as an offline UX hint only.
-- Approval authorization and persisted snapshots always use the effective DB group.

do $$
declare
  v_definition text;
  v_old_fragment constant text := E'  if v_price_time_exempt then\n    payload := jsonb_set(payload, ''{configuredPriceSnapshot}'', ''null''::jsonb, true);\n  end if;';
  v_new_fragment constant text := E'  payload := jsonb_set(\n    payload,\n    ''{configuredPriceSnapshot}'',\n    coalesce(to_jsonb(v_configured_price), ''null''::jsonb),\n    true\n  );\n  v_price_cap := v_configured_price;';
begin
  select pg_get_functiondef(
    'private.sync_rubber_bill_approval_20260823010000(jsonb)'::regprocedure
  ) into v_definition;

  if position(v_new_fragment in v_definition) > 0 then
    return;
  end if;
  if position(v_old_fragment in v_definition) = 0
     or length(v_definition) - length(replace(v_definition, v_old_fragment, ''))
       <> length(v_old_fragment) then
    raise exception 'Could not enforce server-authoritative Rubber Bill price settings';
  end if;

  v_definition := replace(v_definition, v_old_fragment, v_new_fragment);
  if position(v_old_fragment in v_definition) > 0
     or position(v_new_fragment in v_definition) = 0 then
    raise exception 'Could not enforce server-authoritative Rubber Bill price settings';
  end if;
  execute v_definition;
end
$$;

revoke all on function private.sync_rubber_bill_approval_20260823010000(jsonb)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
