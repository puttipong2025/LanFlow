-- Project money-transfer timestamps to the Bangkok business date in every
-- affected branch of the current income/expense feed definition.
do $$
declare
  v_definition text;
  v_occurrences integer;
begin
  select pg_get_functiondef(
    'public.get_income_expense_feed(uuid,date,date,date,text,integer)'::regprocedure
  ) into v_definition;

  v_occurrences := (
    length(v_definition) - length(replace(v_definition, 'mt.created_at::date', ''))
  ) / length('mt.created_at::date');

  if v_occurrences <> 9 then
    raise exception 'Expected 9 mt.created_at::date expressions, found %', v_occurrences;
  end if;

  execute replace(
    v_definition,
    'mt.created_at::date',
    '(mt.created_at at time zone ''Asia/Bangkok'')::date'
  );
end;
$$;
