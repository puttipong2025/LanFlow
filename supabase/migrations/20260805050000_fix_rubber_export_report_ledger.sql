-- Restore source-owned Rubber Export expenses in the canonical report ledger.
do $$
declare
  v_definition text;
  v_anchor text := $anchor$
  union all

  select
    (f.approved_at at time zone 'Asia/Bangkok')::date,$anchor$;
  v_export_union text := $export$
  union all

  select
    (e.verified_at at time zone 'Asia/Bangkok')::date,
    e.export_no,
    'expense',
    'ค่าทำงานส่งออกยาง — ' || e.export_no,
    e.work_total,
    '55-' || e.id::text
  from public.report_items i
  join public.rubber_exports e on e.id = i.entity_id
  where i.report_id = p_report_id
    and i.entity_type = 'rubber_export'
    and e.work_total > 0

$export$;
begin
  select pg_get_functiondef(
    'private.report_income_expense_period_rows(uuid)'::regprocedure
  ) into v_definition;

  if strpos(v_definition, v_anchor) = 0 then
    raise exception 'Unable to locate report period ledger insertion point';
  end if;

  v_definition := replace(v_definition, v_anchor, v_export_union || v_anchor);
  execute v_definition;
end;
$$;

create or replace function private.rebuild_active_report_balance_chain(p_location_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_report record;
  v_previous_report_id uuid;
  v_running_balance numeric := 0;
  v_period_balance numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_location_id::text, 0));

  for v_report in
    select b.id
    from public.report_batches b
    where b.location_id = p_location_id
      and b.status = 'active'
    order by b.created_at, b.id
  loop
    select coalesce(sum(
      case when r.entry_type = 'income' then r.amount else -r.amount end
    ), 0)
    into v_period_balance
    from private.report_income_expense_period_rows(v_report.id) r;

    update public.report_batches
    set previous_report_id = v_previous_report_id,
        opening_balance = v_running_balance,
        closing_balance = v_running_balance + v_period_balance
    where id = v_report.id;

    v_previous_report_id := v_report.id;
    v_running_balance := v_running_balance + v_period_balance;
  end loop;
end;
$$;

revoke all on function private.rebuild_active_report_balance_chain(uuid)
from public, anon, authenticated;

do $$
declare
  v_location record;
begin
  for v_location in
    select distinct b.location_id
    from public.report_batches b
    where b.status = 'active'
  loop
    perform private.rebuild_active_report_balance_chain(v_location.location_id);
  end loop;
end;
$$;
