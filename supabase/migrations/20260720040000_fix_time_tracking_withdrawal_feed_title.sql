-- Keep the approved display contract while preserving already-applied migration history.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.get_income_expense_feed(uuid, date, date, date, text, integer)'::regprocedure)
    into v_definition;

  v_definition := replace(
    v_definition,
    ''' — '' || nullif(ft.description, '''')',
    ''': '' || nullif(ft.description, '''')'
  );

  execute v_definition;
end;
$$;
