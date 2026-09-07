-- Return report projections as scalar JSON so PostgREST's row cap cannot
-- truncate a completed report.

create or replace function public.get_report_income_expense_rows_json(p_report_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(rows)), '[]'::jsonb)
  from public.get_report_income_expense_rows(p_report_id) rows
$$;

create or replace function public.get_report_stock_balances(
  p_location_id uuid,
  p_cutoff_at timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_location_id is null
     or p_cutoff_at is null
     or not private.can_manage_reports(p_location_id) then
    raise exception 'FORBIDDEN: ไม่มีสิทธิ์ดูรายงานนี้';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('product', balances.product_name, 'quantity', balances.quantity)
      order by balances.product_name
    ),
    '[]'::jsonb
  )
  into v_result
  from (
    select movement.product_name, sum(movement.quantity_delta) as quantity
    from public.acid_stock_movements movement
    where movement.location_id = p_location_id
      and movement.created_at <= p_cutoff_at
    group by movement.product_name
  ) balances;

  return v_result;
end
$$;

revoke all on function public.get_report_income_expense_rows_json(uuid) from public, anon;
revoke all on function public.get_report_stock_balances(uuid, timestamptz) from public, anon;
grant execute on function public.get_report_income_expense_rows_json(uuid) to authenticated;
grant execute on function public.get_report_stock_balances(uuid, timestamptz) to authenticated;

notify pgrst, 'reload schema';
