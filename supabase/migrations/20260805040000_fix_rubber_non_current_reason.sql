-- Keep the rubber approval reason snapshot exact. The date wrapper seeds
-- non_current_date before this dispatcher runs; price must only be appended
-- when at least one proposed weigh price actually exceeds the configured cap.
do $$
declare
  v_definition text;
  v_old text := $old$
    if cardinality(v_reasons) = 0 and (v_price_cap is null or not v_has_exceeded_cap) then
      return public.sync_rubber_bill_core_20260725010000(payload);
    end if;

    v_reasons := array_append(v_reasons, 'price');
$old$;
  v_new text := $new$
    if v_price_cap is not null and v_has_exceeded_cap then
      v_reasons := array_append(v_reasons, 'price');
    end if;

    if cardinality(v_reasons) = 0 then
      return public.sync_rubber_bill_core_20260725010000(payload);
    end if;
$new$;
begin
  select pg_get_functiondef(
    'private.sync_rubber_bill_approval_20260805020000(jsonb)'::regprocedure
  ) into v_definition;

  if position(v_old in v_definition) = 0 then
    raise exception 'Could not locate rubber create approval reason branch';
  end if;

  execute replace(v_definition, v_old, v_new);
end;
$$;

