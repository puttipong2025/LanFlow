-- Project same-target branch transfers through the existing money read models.
-- Keep legacy inter-branch rows on their current source/target behavior and date fallback.

do $migration$
declare
  v_definition text := pg_get_functiondef(
    'private.income_expense_operational_row(uuid,text,uuid,date)'::regprocedure
  );
  v_old_income text := $old$'number', 'TR-' || left(mt.id::text, 8),
      'txDate', (mt.created_at at time zone 'Asia/Bangkok')::date,
      'title', 'รับโอนจาก ' || coalesce(source_location.name, 'สาขาต้นทาง'),$old$;
  v_new_income text := $new$'number', 'TR-' || left(mt.id::text, 8),
      'txDate', coalesce(mt.accounting_date, (mt.created_at at time zone 'Asia/Bangkok')::date),
      'title', case when mt.location_id = mt.target_location_id then 'โอนให้สาขา'
        else 'รับโอนจาก ' || coalesce(source_location.name, 'สาขาต้นทาง') end,$new$;
  v_old_relation text := $old$'relationSourceId', mt.id, 'relationSourceLocationId', mt.location_id,
      'relationLabel', 'โอนเงินสาขา',
      'relationLockReason', 'รายการนี้มาจากการโอนเงินสาขา ต้องแก้ไขหรือลบที่โมดูลโอนเงินต้นทาง',$old$;
  v_new_relation text := $new$'relationSourceId', mt.id, 'relationSourceLocationId', mt.location_id,
      'relationLabel', case when mt.location_id = mt.target_location_id then 'โอนให้สาขา' else 'โอนเงินสาขา' end,
      'relationLockReason', case when mt.location_id = mt.target_location_id
        then 'รายการนี้มาจากโอนให้สาขา ต้องแก้ไขหรือลบที่โมดูลโอนเงิน'
        else 'รายการนี้มาจากการโอนเงินสาขา ต้องแก้ไขหรือลบที่โมดูลโอนเงินต้นทาง' end,$new$;
  v_old_expense text := $old$'number', 'TR-' || left(mt.id::text, 8),
      'txDate', (mt.created_at at time zone 'Asia/Bangkok')::date,
      'title', 'โยกเงินไป ' || coalesce(mt.target_location_name, 'สาขาปลายทาง'),$old$;
  v_new_expense text := $new$'number', 'TR-' || left(mt.id::text, 8),
      'txDate', coalesce(mt.accounting_date, (mt.created_at at time zone 'Asia/Bangkok')::date),
      'title', 'โยกเงินไป ' || coalesce(mt.target_location_name, 'สาขาปลายทาง'),$new$;
begin
  if position(v_old_income in v_definition) = 0
    or position(v_old_expense in v_definition) = 0
    or (length(v_definition) - length(replace(v_definition, v_old_relation, ''))) / length(v_old_relation) <> 2
  then
    raise exception 'Unable to locate bounded branch transfer projection anchors';
  end if;

  v_definition := replace(v_definition, v_old_income, v_new_income);
  v_definition := replace(v_definition, v_old_expense, v_new_expense);
  v_definition := replace(v_definition, v_old_relation, v_new_relation);
  execute v_definition;
end
$migration$;

do $migration$
declare
  v_definition text := pg_get_functiondef(
    'public.get_income_expense_operational_feed(uuid,text,text,text)'::regprocedure
  );
  v_old_income text := $old$select 'branch_income', mt.id, null::date,
          (mt.created_at at time zone 'Asia/Bangkok')::date d, 'transfer-income:' || mt.id::text k$old$;
  v_new_income text := $new$select 'branch_income', mt.id, null::date,
          coalesce(mt.accounting_date, (mt.created_at at time zone 'Asia/Bangkok')::date) d,
          'transfer-income:' || mt.id::text k$new$;
  v_old_income_cursor text := $old$and (v_cursor_date is null or ((mt.created_at at time zone 'Asia/Bangkok')::date,
            'transfer-income:' || mt.id::text) < (v_cursor_date, v_cursor_key))$old$;
  v_new_income_cursor text := $new$and (v_cursor_date is null or (coalesce(mt.accounting_date,
            (mt.created_at at time zone 'Asia/Bangkok')::date),
            'transfer-income:' || mt.id::text) < (v_cursor_date, v_cursor_key))$new$;
  v_old_expense text := $old$select 'branch_expense', mt.id, null::date,
          (mt.created_at at time zone 'Asia/Bangkok')::date d, 'transfer-expense:' || mt.id::text k$old$;
  v_new_expense text := $new$select 'branch_expense', mt.id, null::date,
          coalesce(mt.accounting_date, (mt.created_at at time zone 'Asia/Bangkok')::date) d,
          'transfer-expense:' || mt.id::text k$new$;
  v_old_expense_cursor text := $old$and (v_cursor_date is null or ((mt.created_at at time zone 'Asia/Bangkok')::date,
            'transfer-expense:' || mt.id::text) < (v_cursor_date, v_cursor_key))$old$;
  v_new_expense_cursor text := $new$and (v_cursor_date is null or (coalesce(mt.accounting_date,
            (mt.created_at at time zone 'Asia/Bangkok')::date),
            'transfer-expense:' || mt.id::text) < (v_cursor_date, v_cursor_key))$new$;
begin
  if position(v_old_income in v_definition) = 0
    or position(v_old_income_cursor in v_definition) = 0
    or position(v_old_expense in v_definition) = 0
    or position(v_old_expense_cursor in v_definition) = 0
  then
    raise exception 'Unable to locate bounded branch transfer feed anchors';
  end if;

  v_definition := replace(v_definition, v_old_income, v_new_income);
  v_definition := replace(v_definition, v_old_income_cursor, v_new_income_cursor);
  v_definition := replace(v_definition, v_old_expense, v_new_expense);
  v_definition := replace(v_definition, v_old_expense_cursor, v_new_expense_cursor);
  execute v_definition;
end
$migration$;

do $migration$
declare
  v_definition text := pg_get_functiondef(
    'public.get_income_expense_operational_feed_on_demand(uuid,text,text,text)'::regprocedure
  );
  v_old_income text := $old$select
        (mt.created_at at time zone 'Asia/Bangkok')::date,
        'transfer-income:' || mt.id,
        lower(regexp_replace(concat_ws(' ', 'TR-' || left(mt.id::text, 8),
          (mt.created_at at time zone 'Asia/Bangkok')::date::text,
          'รับโอนจาก', source_location.name, 'รายรับ', mt.created_by_name, mt.created_by_phone
        ), '\s+', ' ', 'g')),$old$;
  v_new_income text := $new$select
        coalesce(mt.accounting_date, (mt.created_at at time zone 'Asia/Bangkok')::date),
        'transfer-income:' || mt.id,
        lower(regexp_replace(concat_ws(' ', 'TR-' || left(mt.id::text, 8),
          coalesce(mt.accounting_date, (mt.created_at at time zone 'Asia/Bangkok')::date)::text,
          case when mt.location_id = mt.target_location_id then 'โอนให้สาขา' else 'รับโอนจาก' end,
          source_location.name, 'รายรับ', mt.created_by_name, mt.created_by_phone
        ), '\s+', ' ', 'g')),$new$;
  v_old_income_row text := $old$'txDate', (mt.created_at at time zone 'Asia/Bangkok')::date,
          'title', 'รับโอนจาก ' || coalesce(source_location.name, 'สาขาต้นทาง'),$old$;
  v_new_income_row text := $new$'txDate', coalesce(mt.accounting_date, (mt.created_at at time zone 'Asia/Bangkok')::date),
          'title', case when mt.location_id = mt.target_location_id then 'โอนให้สาขา'
            else 'รับโอนจาก ' || coalesce(source_location.name, 'สาขาต้นทาง') end,$new$;
  v_old_relation text := $old$'relationSourceId', mt.id, 'relationSourceLocationId', mt.location_id,
          'relationLabel', 'โอนเงินสาขา',
          'relationLockReason', 'รายการนี้มาจากการโอนเงินสาขา ต้องแก้ไขหรือลบที่โมดูลโอนเงินต้นทาง',$old$;
  v_new_relation text := $new$'relationSourceId', mt.id, 'relationSourceLocationId', mt.location_id,
          'relationLabel', case when mt.location_id = mt.target_location_id then 'โอนให้สาขา' else 'โอนเงินสาขา' end,
          'relationLockReason', case when mt.location_id = mt.target_location_id
            then 'รายการนี้มาจากโอนให้สาขา ต้องแก้ไขหรือลบที่โมดูลโอนเงิน'
            else 'รายการนี้มาจากการโอนเงินสาขา ต้องแก้ไขหรือลบที่โมดูลโอนเงินต้นทาง' end,$new$;
  v_old_expense text := $old$select
        (mt.created_at at time zone 'Asia/Bangkok')::date,
        'transfer-expense:' || mt.id,
        lower(regexp_replace(concat_ws(' ', 'TR-' || left(mt.id::text, 8),
          (mt.created_at at time zone 'Asia/Bangkok')::date::text,$old$;
  v_new_expense text := $new$select
        coalesce(mt.accounting_date, (mt.created_at at time zone 'Asia/Bangkok')::date),
        'transfer-expense:' || mt.id,
        lower(regexp_replace(concat_ws(' ', 'TR-' || left(mt.id::text, 8),
          coalesce(mt.accounting_date, (mt.created_at at time zone 'Asia/Bangkok')::date)::text,$new$;
  v_old_expense_row text := $old$'txDate', (mt.created_at at time zone 'Asia/Bangkok')::date,
          'title', 'โยกเงินไป ' || coalesce(mt.target_location_name, 'สาขาปลายทาง'),$old$;
  v_new_expense_row text := $new$'txDate', coalesce(mt.accounting_date, (mt.created_at at time zone 'Asia/Bangkok')::date),
          'title', 'โยกเงินไป ' || coalesce(mt.target_location_name, 'สาขาปลายทาง'),$new$;
begin
  if position(v_old_income in v_definition) = 0
    or position(v_old_income_row in v_definition) = 0
    or position(v_old_expense in v_definition) = 0
    or position(v_old_expense_row in v_definition) = 0
    or (length(v_definition) - length(replace(v_definition, v_old_relation, ''))) / length(v_old_relation) <> 2
  then
    raise exception 'Unable to locate on-demand branch transfer anchors';
  end if;

  v_definition := replace(v_definition, v_old_income, v_new_income);
  v_definition := replace(v_definition, v_old_income_row, v_new_income_row);
  v_definition := replace(v_definition, v_old_expense, v_new_expense);
  v_definition := replace(v_definition, v_old_expense_row, v_new_expense_row);
  v_definition := replace(v_definition, v_old_relation, v_new_relation);
  execute v_definition;
end
$migration$;

do $migration$
declare
  v_definition text := pg_get_functiondef(
    'private.reportable_items(uuid,timestamptz)'::regprocedure
  );
  v_old_source text := $old$where m.location_id = p_location_id
      and m.transfer_method = 'bank'$old$;
  v_new_source text := $new$where m.location_id = p_location_id
      and (m.transfer_type <> 'branch' or m.location_id <> m.target_location_id)
      and m.transfer_method = 'bank'$new$;
  v_old_target text := $old$where m.target_location_id = p_location_id
      and m.location_id <> p_location_id
      and m.transfer_type = 'branch'$old$;
  v_new_target text := $new$where m.target_location_id = p_location_id
      and m.transfer_type = 'branch'$new$;
begin
  if position(v_old_source in v_definition) = 0 or position(v_old_target in v_definition) = 0 then
    raise exception 'Unable to locate reportable branch transfer anchors';
  end if;
  v_definition := replace(v_definition, v_old_source, v_new_source);
  v_definition := replace(v_definition, v_old_target, v_new_target);
  execute v_definition;
end
$migration$;

do $migration$
declare
  v_definition text := pg_get_functiondef(
    'private.report_income_expense_period_rows(uuid)'::regprocedure
  );
  v_old_source text := $old$select
    (coalesce(m.server_received_at, m.updated_at, m.created_at) at time zone 'Asia/Bangkok')::date,
    'TR-' || left(m.id::text, 8),
    'expense',
    'โยกเงินไป ' || coalesce(m.target_location_name, 'สาขาปลายทาง'),$old$;
  v_new_source text := $new$select
    coalesce(m.accounting_date,
      (coalesce(m.server_received_at, m.updated_at, m.created_at) at time zone 'Asia/Bangkok')::date),
    'TR-' || left(m.id::text, 8),
    'expense',
    'โยกเงินไป ' || coalesce(m.target_location_name, 'สาขาปลายทาง'),$new$;
  v_old_target text := $old$select
    (coalesce(m.server_received_at, m.updated_at, m.created_at) at time zone 'Asia/Bangkok')::date,
    'TR-' || left(m.id::text, 8),
    'income',
    'รับโอนจากสาขาต้นทาง',$old$;
  v_new_target text := $new$select
    coalesce(m.accounting_date,
      (coalesce(m.server_received_at, m.updated_at, m.created_at) at time zone 'Asia/Bangkok')::date),
    'TR-' || left(m.id::text, 8),
    'income',
    case when m.location_id = m.target_location_id then 'โอนให้สาขา' else 'รับโอนจากสาขาต้นทาง' end,$new$;
begin
  if position(v_old_source in v_definition) = 0 or position(v_old_target in v_definition) = 0 then
    raise exception 'Unable to locate report branch transfer row anchors';
  end if;
  v_definition := replace(v_definition, v_old_source, v_new_source);
  v_definition := replace(v_definition, v_old_target, v_new_target);
  execute v_definition;
end
$migration$;

do $migration$
declare
  v_definition text := pg_get_functiondef(
    'private.calculate_dashboard_summary(uuid)'::regprocedure
  );
  v_old_income text := $old$select 'income', mt.net_amount_to_pay, true, false,
      (mt.created_at at time zone 'Asia/Bangkok')::date
    from public.money_transfers mt
    where mt.transfer_type = 'branch'$old$;
  v_new_income text := $new$select 'income', mt.net_amount_to_pay, true, false,
      coalesce(mt.accounting_date, (mt.created_at at time zone 'Asia/Bangkok')::date)
    from public.money_transfers mt
    where mt.transfer_type = 'branch'$new$;
  v_old_expense text := $old$select 'expense', mt.net_amount_to_pay, true, false,
      (mt.created_at at time zone 'Asia/Bangkok')::date
    from public.money_transfers mt
    where mt.transfer_type = 'branch'$old$;
  v_new_expense text := $new$select 'expense', mt.net_amount_to_pay, true, false,
      coalesce(mt.accounting_date, (mt.created_at at time zone 'Asia/Bangkok')::date)
    from public.money_transfers mt
    where mt.transfer_type = 'branch'$new$;
begin
  if position(v_old_income in v_definition) = 0 or position(v_old_expense in v_definition) = 0 then
    raise exception 'Unable to locate dashboard branch transfer summary anchors';
  end if;
  v_definition := replace(v_definition, v_old_income, v_new_income);
  v_definition := replace(v_definition, v_old_expense, v_new_expense);
  execute v_definition;
end
$migration$;

do $migration$
declare
  v_definition text := pg_get_functiondef(
    'private.dashboard_money_source_entries(text,uuid)'::regprocedure
  );
  v_old_income text := $old$select private.dashboard_money_event_entry(
        'branch-transfer-in:' || mt.id::text,
        mt.target_location_id,
        'transfer_in',
        'TR-' || left(mt.id::text, 8),
        'รับโอนเงินเข้าสาขา',
        'income',
        mt.net_amount_to_pay,
        jsonb_build_object(
          'transferType', mt.transfer_type,
          'transferMethod', mt.transfer_method,
          'transferStatus', mt.transfer_status,
          'amount', mt.net_amount_to_pay,
          'sourceLocationId', mt.location_id,
          'targetLocationId', mt.target_location_id,
          'targetLocationName', mt.target_location_name
        ),$old$;
  v_new_income text := $new$select private.dashboard_money_event_entry(
        'branch-transfer-in:' || mt.id::text,
        mt.target_location_id,
        'transfer_in',
        'TR-' || left(mt.id::text, 8),
        case when mt.location_id = mt.target_location_id then 'โอนให้สาขา' else 'รับโอนเงินเข้าสาขา' end,
        'income',
        mt.net_amount_to_pay,
        jsonb_build_object(
          'transferType', mt.transfer_type,
          'transferMethod', mt.transfer_method,
          'transferStatus', mt.transfer_status,
          'amount', mt.net_amount_to_pay,
          'sourceLocationId', mt.location_id,
          'targetLocationId', mt.target_location_id,
          'targetLocationName', mt.target_location_name,
          'accountingDate', mt.accounting_date
        ),$new$;
  v_old_expense text := $old$select private.dashboard_money_event_entry(
        'branch-transfer-out:' || mt.id::text,
        mt.location_id,
        'transfer_out',
        'TR-' || left(mt.id::text, 8),
        'โยกเงินไป ' || coalesce(mt.target_location_name, 'สาขาปลายทาง'),
        'expense',
        mt.net_amount_to_pay,
        jsonb_build_object(
          'transferType', mt.transfer_type,
          'transferMethod', mt.transfer_method,
          'transferStatus', mt.transfer_status,
          'amount', mt.net_amount_to_pay,
          'sourceLocationId', mt.location_id,
          'targetLocationId', mt.target_location_id,
          'targetLocationName', mt.target_location_name
        ),$old$;
  v_new_expense text := $new$select private.dashboard_money_event_entry(
        'branch-transfer-out:' || mt.id::text,
        mt.location_id,
        'transfer_out',
        'TR-' || left(mt.id::text, 8),
        'โยกเงินไป ' || coalesce(mt.target_location_name, 'สาขาปลายทาง'),
        'expense',
        mt.net_amount_to_pay,
        jsonb_build_object(
          'transferType', mt.transfer_type,
          'transferMethod', mt.transfer_method,
          'transferStatus', mt.transfer_status,
          'amount', mt.net_amount_to_pay,
          'sourceLocationId', mt.location_id,
          'targetLocationId', mt.target_location_id,
          'targetLocationName', mt.target_location_name,
          'accountingDate', mt.accounting_date
        ),$new$;
begin
  if position(v_old_income in v_definition) = 0 or position(v_old_expense in v_definition) = 0 then
    raise exception 'Unable to locate dashboard money history branch anchors';
  end if;
  v_definition := replace(v_definition, v_old_income, v_new_income);
  v_definition := replace(v_definition, v_old_expense, v_new_expense);
  execute v_definition;
end
$migration$;

do $migration$
declare
  v_definition text := pg_get_functiondef(
    'private.dashboard_money_event_entry(text,uuid,text,text,text,text,numeric,jsonb,uuid,text)'::regprocedure
  );
  v_old text := $old$'amount', greatest(coalesce(p_amount, 0), 0),
    'fingerprint', md5(coalesce(p_fingerprint, '{}'::jsonb)::text),$old$;
  v_new text := $new$'amount', greatest(coalesce(p_amount, 0), 0),
    'eventDate', case when coalesce(p_fingerprint->>'accountingDate', '') ~ '^\d{4}-\d{2}-\d{2}$'
      then p_fingerprint->>'accountingDate' end,
    'fingerprint', md5(coalesce(p_fingerprint, '{}'::jsonb)::text),$new$;
begin
  if position(v_old in v_definition) = 0 then
    raise exception 'Unable to locate dashboard money event payload anchor';
  end if;
  execute replace(v_definition, v_old, v_new);
end
$migration$;

do $migration$
declare
  v_definition text := pg_get_functiondef(
    'private.append_dashboard_money_event(text,uuid,text,jsonb,uuid,text)'::regprocedure
  );
  v_old text := $old$(v_occurred_at at time zone 'Asia/Bangkok')::date$old$;
  v_new text := $new$case when coalesce(p_payload->>'eventDate', '') ~ '^\d{4}-\d{2}-\d{2}$'
      then (p_payload->>'eventDate')::date
      else (v_occurred_at at time zone 'Asia/Bangkok')::date end$new$;
begin
  if position(v_old in v_definition) = 0 then
    raise exception 'Unable to locate dashboard money event date anchor';
  end if;
  execute replace(v_definition, v_old, v_new);
end
$migration$;

notify pgrst, 'reload schema';
