-- A zero unit price means a free giveaway: the sale still owns stock movement,
-- revision, approval, and report-lock behavior, while its money value is zero.

alter table public.income_expense_sale_lines
  drop constraint income_expense_sale_lines_unit_price_check,
  drop constraint income_expense_sale_lines_line_total_check;

alter table public.income_expense_sale_lines
  add constraint income_expense_sale_lines_unit_price_check
    check (unit_price >= 0),
  add constraint income_expense_sale_lines_line_total_check
    check (line_total >= 0);

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef('private.sync_income_sale_bill(jsonb)'::regprocedure)
    into v_definition;
  v_updated := replace(v_definition, 'unit_price <= 0', 'unit_price < 0');
  if v_updated = v_definition then
    raise exception 'Could not update private.sync_income_sale_bill zero-price validation';
  end if;
  execute v_updated;

  select pg_get_functiondef(
    'private.create_income_expense_approval_request_20260805080000(jsonb)'::regprocedure
  ) into v_definition;
  v_updated := replace(v_definition, 'unit_price <= 0', 'unit_price < 0');
  if v_updated = v_definition then
    raise exception 'Could not update sale-line approval validation';
  end if;

  v_definition := v_updated;
  v_updated := replace(
    v_definition,
    'or coalesce(v_cost, 0) <= 0',
    $replacement$or v_cost is null
     or v_cost < 0
     or (v_bill_option is distinct from 'บิลขาย' and v_cost = 0)$replacement$
  );
  if v_updated = v_definition then
    raise exception 'Could not update zero-total sale approval validation';
  end if;
  execute v_updated;
end;
$migration$;
