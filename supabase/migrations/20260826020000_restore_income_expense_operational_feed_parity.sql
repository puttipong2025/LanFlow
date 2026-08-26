-- Restore source eligibility and presentation parity after the operational feed cutover.
-- The two earlier migrations are already applied, so patch their function definitions forward.

do $migration$
declare
  v_definition text := pg_get_functiondef(
    'public.get_income_expense_operational_feed_on_demand(uuid,text,text,text)'::regprocedure
  );
  v_old_label text := $old$'รับเงินแล้ว · ผลต่าง ' || d.difference_total::text$old$;
  v_new_label text := $new$'รับเงินแล้ว · ผลต่าง '
              || case when d.difference_total >= 0 then '+฿' else '-฿' end
              || trim(to_char(abs(d.difference_total), 'FM999999999990'))$new$;
  v_old_cash_status text := $old$and d.cash_status = 'received' and d.received_at is not null$old$;
  v_new_cash_status text := $new$and d.cash_status in ('received', 'mismatched', 'difference_accepted')
        and d.received_at is not null$new$;
  v_old_rubber text := $old$and b.record_status = 'active' and b.net_total > 0$old$;
  v_new_rubber text := $new$and b.record_status = 'active' and b.net_total > 0
          and private.rubber_bill_is_payable(b.id)$new$;
begin
  if (length(v_definition) - length(replace(v_definition, v_old_label, ''))) / length(v_old_label) <> 2 then
    raise exception 'Expected two operational cash labels in on-demand feed';
  end if;
  if position(v_old_cash_status in v_definition) = 0 then
    raise exception 'Unable to locate on-demand cash-income eligibility';
  end if;
  if position(v_old_rubber in v_definition) = 0 then
    raise exception 'Unable to locate on-demand rubber eligibility';
  end if;

  v_definition := replace(v_definition, v_old_label, v_new_label);
  v_definition := replace(v_definition, v_old_cash_status, v_new_cash_status);
  v_definition := replace(v_definition, v_old_rubber, v_new_rubber);
  execute v_definition;
end
$migration$;

do $migration$
declare
  v_definition text := pg_get_functiondef(
    'private.income_expense_operational_row(uuid,text,uuid,date)'::regprocedure
  );
  v_old_label text := $old$'รับเงินแล้ว · ผลต่าง ' || d.difference_total::text$old$;
  v_new_label text := $new$'รับเงินแล้ว · ผลต่าง '
        || case when d.difference_total >= 0 then '+฿' else '-฿' end
        || trim(to_char(abs(d.difference_total), 'FM999999999990'))$new$;
  v_old_rubber text := $old$and b.record_status = 'active' and b.net_total > 0$old$;
  v_new_rubber text := $new$and b.record_status = 'active' and b.net_total > 0
      and private.rubber_bill_is_payable(b.id)$new$;
begin
  if position(v_old_label in v_definition) = 0 then
    raise exception 'Unable to locate bounded operational cash label';
  end if;
  if position(v_old_rubber in v_definition) = 0 then
    raise exception 'Unable to locate bounded operational rubber eligibility';
  end if;

  v_definition := replace(v_definition, v_old_label, v_new_label);
  v_definition := replace(v_definition, v_old_rubber, v_new_rubber);
  execute v_definition;
end
$migration$;

do $migration$
declare
  v_definition text := pg_get_functiondef(
    'public.get_income_expense_operational_feed(uuid,text,text,text)'::regprocedure
  );
  v_old_cash_status text := $old$and d.cash_status = 'received' and d.received_at is not null$old$;
  v_new_cash_status text := $new$and d.cash_status in ('received', 'mismatched', 'difference_accepted')
          and d.received_at is not null$new$;
  v_old_rubber text := $old$and b.record_status = 'active' and b.net_total > 0$old$;
  v_new_rubber text := $new$and b.record_status = 'active' and b.net_total > 0
          and private.rubber_bill_is_payable(b.id)$new$;
begin
  if position(v_old_cash_status in v_definition) = 0 then
    raise exception 'Unable to locate bounded cash-income eligibility';
  end if;
  if position(v_old_rubber in v_definition) = 0 then
    raise exception 'Unable to locate bounded rubber eligibility';
  end if;

  v_definition := replace(v_definition, v_old_cash_status, v_new_cash_status);
  v_definition := replace(v_definition, v_old_rubber, v_new_rubber);
  execute v_definition;
end
$migration$;

notify pgrst, 'reload schema';
