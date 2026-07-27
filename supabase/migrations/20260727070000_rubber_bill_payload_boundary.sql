do $$
declare
  v_definition text;
  v_anchor text := E'if v_in_weight is not null and v_out_weight is not null then\n        if v_in_weight <> round(v_in_weight, 2)';
  v_replacement text := E'if v_in_weight is not null and v_out_weight is not null then\n        if v_in_weight < 0 or v_out_weight < 0 then\n          raise exception ''weigh-row weights must be non-negative'';\n        end if;\n        if v_in_weight <> round(v_in_weight, 2)';
begin
  select pg_get_functiondef(
    'private.normalize_rubber_bill_calculation_payload(jsonb)'::regprocedure
  ) into v_definition;

  if position(v_anchor in v_definition) = 0 then
    raise exception 'Rubber Bill negative-weight validation anchor not found';
  end if;

  execute replace(v_definition, v_anchor, v_replacement);
end;
$$;

do $$
declare
  v_definition text;
  v_anchor text := E'  end if;\n\n  perform pg_advisory_xact_lock(hashtextextended(v_location_id::text, 0));';
  v_replacement text := E'  end if;\n\n  payload := private.normalize_rubber_bill_calculation_payload(payload);\n\n  perform pg_advisory_xact_lock(hashtextextended(v_location_id::text, 0));';
begin
  select pg_get_functiondef(
    'public.sync_rubber_bill(jsonb)'::regprocedure
  ) into v_definition;

  if position(v_anchor in v_definition) = 0 then
    raise exception 'Rubber Bill public payload-normalization anchor not found';
  end if;

  execute replace(v_definition, v_anchor, v_replacement);
end;
$$;
