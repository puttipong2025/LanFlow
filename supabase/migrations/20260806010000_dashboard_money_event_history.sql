-- Recent-money action history is a short-lived projection. Business source rows
-- remain authoritative and keep their existing retention/relation contracts.

create table public.dashboard_money_events (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations(id) on delete cascade,
  source_type text not null check (source_type in (
    'income_expense', 'money_transfer', 'cash_transfer', 'withdrawal',
    'payroll_slip', 'rubber_bill', 'ocr_ticket', 'rubber_export'
  )),
  source_id uuid not null,
  event_key text not null,
  action text not null check (action in ('create', 'update', 'delete')),
  kind text not null,
  number text not null,
  title text not null,
  direction text not null check (direction in ('income', 'expense')),
  amount numeric not null check (amount >= 0),
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_name text not null,
  occurred_at timestamptz not null default clock_timestamp(),
  event_date date not null
);

create index dashboard_money_events_location_date_cursor_idx
  on public.dashboard_money_events (location_id, event_date, occurred_at desc, id desc);

create index dashboard_money_events_location_date_action_cursor_idx
  on public.dashboard_money_events (
    location_id, event_date, action, occurred_at desc, id desc
  );

alter table public.dashboard_money_events enable row level security;

create policy dashboard_money_events_select_scope
  on public.dashboard_money_events for select to authenticated
  using (public.can_access_location(location_id));

revoke all on table public.dashboard_money_events from public, anon, authenticated;
grant select on table public.dashboard_money_events to authenticated;
grant all on table public.dashboard_money_events to service_role;

create table private.dashboard_money_event_projection (
  source_type text not null,
  source_id uuid not null,
  event_key text not null,
  payload jsonb not null,
  primary key (source_type, source_id, event_key)
);

create or replace function private.dashboard_money_event_entry(
  p_event_key text,
  p_location_id uuid,
  p_kind text,
  p_number text,
  p_title text,
  p_direction text,
  p_amount numeric,
  p_fingerprint jsonb,
  p_actor_user_id uuid default null,
  p_actor_name text default null
)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'eventKey', p_event_key,
    'locationId', p_location_id,
    'kind', p_kind,
    'number', coalesce(nullif(p_number, ''), '—'),
    'title', coalesce(nullif(p_title, ''), 'ไม่ระบุรายละเอียด'),
    'direction', p_direction,
    'amount', greatest(coalesce(p_amount, 0), 0),
    'fingerprint', md5(coalesce(p_fingerprint, '{}'::jsonb)::text),
    'actorUserId', p_actor_user_id,
    'actorName', p_actor_name
  );
$$;

create or replace function private.dashboard_money_source_entries(
  p_source_type text,
  p_source_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_entries jsonb := '[]'::jsonb;
  v_row record;
  v_children jsonb := '[]'::jsonb;
begin
  if p_source_type = 'income_expense' then
    select * into v_row
    from public.income_expense
    where id = p_source_id;

    if not found or v_row.record_status <> 'active' or v_row.cost <= 0 then
      return v_entries;
    end if;

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', line.id,
        'incomeSaleItemId', line.income_sale_item_id,
        'stockProductId', line.stock_product_id,
        'title', line.title,
        'quantity', line.quantity,
        'unitPrice', line.unit_price,
        'lineTotal', line.line_total,
        'sequenceNo', line.sequence_no
      ) order by line.sequence_no, line.id
    ), '[]'::jsonb)
    into v_children
    from public.income_expense_sale_lines line
    where line.income_expense_id = p_source_id;

    return jsonb_build_array(private.dashboard_money_event_entry(
      'income-expense:' || v_row.id::text,
      v_row.location_id,
      v_row.type::text,
      coalesce(v_row.number, v_row.server_bill_no, v_row.local_bill_no, left(v_row.id::text, 8)),
      v_row.title,
      v_row.type::text,
      v_row.cost,
      jsonb_build_object(
        'type', v_row.type,
        'number', v_row.number,
        'serverBillNo', v_row.server_bill_no,
        'localBillNo', v_row.local_bill_no,
        'txDate', v_row.tx_date,
        'title', v_row.title,
        'cost', v_row.cost,
        'billOption', v_row.bill_option,
        'unit', v_row.unit,
        'price', v_row.price,
        'saleLines', v_children
      ),
      v_row.created_by_user_id,
      v_row.created_by_name
    ));
  elsif p_source_type = 'rubber_bill' then
    select * into v_row
    from public.rubber_bills
    where id = p_source_id;

    if not found or not private.rubber_bill_is_payable(p_source_id) then
      return v_entries;
    end if;

    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id', item.id,
        'type', item.item_type,
        'description', item.description,
        'weightIn', item.weight_in,
        'weightOut', item.weight_out,
        'netWeight', item.net_weight,
        'quantity', item.quantity,
        'unit', item.unit,
        'price', item.price,
        'total', item.total,
        'stockProductId', item.stock_product_id,
        'sequenceNo', item.sequence_no
      ) order by item.sequence_no, item.id
    ), '[]'::jsonb)
    into v_children
    from public.rubber_bill_items item
    where item.bill_id = p_source_id;

    return jsonb_build_array(private.dashboard_money_event_entry(
      'rubber-bill:' || v_row.id::text,
      v_row.location_id,
      'rubber_bill',
      coalesce(v_row.server_bill_no, nullif(v_row.local_bill_no, ''), nullif(v_row.bill_no, ''), left(v_row.id::text, 8)),
      'รับซื้อยาง — ' || coalesce(nullif(v_row.customer_name, ''), 'ไม่ระบุลูกค้า'),
      'expense',
      v_row.net_total,
      jsonb_build_object(
        'serverBillNo', v_row.server_bill_no,
        'localBillNo', v_row.local_bill_no,
        'billNo', v_row.bill_no,
        'billDate', v_row.bill_date,
        'customerId', v_row.customer_id,
        'customerName', v_row.customer_name,
        'billType', v_row.bill_type,
        'deductWeight', v_row.deduct_weight,
        'weight', v_row.weight,
        'netWeight', v_row.net_weight,
        'averagePrice', v_row.average_price,
        'deductionTotal', v_row.deduction_total,
        'netTotal', v_row.net_total,
        'items', v_children
      ),
      v_row.created_by_user_id,
      v_row.created_by_name
    ));
  elsif p_source_type = 'money_transfer' then
    select coalesce(jsonb_agg(entry order by entry->>'eventKey'), '[]'::jsonb)
    into v_entries
    from (
      select private.dashboard_money_event_entry(
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
        ),
        mt.created_by_user_id,
        mt.created_by_name
      ) as entry
      from public.money_transfers mt
      where mt.id = p_source_id
        and mt.transfer_type = 'branch'
        and coalesce(mt.transfer_method, 'bank') <> 'cash'
        and mt.record_status <> 'deleted'
        and mt.transfer_status in ('paid', 'overpaid', 'branch_and_transfer')
        and mt.net_amount_to_pay > 0

      union all

      select private.dashboard_money_event_entry(
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
        ),
        mt.created_by_user_id,
        mt.created_by_name
      ) as entry
      from public.money_transfers mt
      where mt.id = p_source_id
        and mt.transfer_type = 'branch'
        and coalesce(mt.transfer_method, 'bank') <> 'cash'
        and mt.location_id <> mt.target_location_id
        and mt.record_status <> 'deleted'
        and mt.transfer_status in ('paid', 'overpaid', 'branch_and_transfer')
        and mt.net_amount_to_pay > 0

      union all

      select private.dashboard_money_event_entry(
        'customer-branch-paid:' || mt.id::text,
        mt.location_id,
        'transfer_out',
        'CT-' || left(mt.id::text, 8),
        'สาขาจ่ายส่วนต่างให้ ' || coalesce(mt.customer_name, 'ลูกค้า'),
        'expense',
        mt.branch_paid_amount,
        jsonb_build_object(
          'transferType', mt.transfer_type,
          'transferMethod', mt.transfer_method,
          'transferStatus', mt.transfer_status,
          'branchPaidAmount', mt.branch_paid_amount,
          'customerId', mt.customer_id,
          'customerName', mt.customer_name,
          'locationId', mt.location_id
        ),
        mt.created_by_user_id,
        mt.created_by_name
      ) as entry
      from public.money_transfers mt
      where mt.id = p_source_id
        and mt.transfer_type = 'customer'
        and mt.transfer_status = 'branch_and_transfer'
        and mt.record_status <> 'deleted'
        and mt.branch_paid_amount > 0
    ) candidates;

    return v_entries;
  elsif p_source_type = 'cash_transfer' then
    select coalesce(jsonb_agg(entry order by entry->>'eventKey'), '[]'::jsonb)
    into v_entries
    from (
      select private.dashboard_money_event_entry(
        'cash-transfer-out:' || mt.id::text,
        mt.location_id,
        'transfer_out',
        'CASH-' || left(mt.id::text, 8),
        'โยกเงินสดไป ' || coalesce(mt.target_location_name, 'สาขาปลายทาง'),
        'expense',
        d.sent_total,
        jsonb_build_object(
          'parent', to_jsonb(mt) - array[
            'sync_status', 'revision_no', 'client_recorded_at', 'server_received_at',
            'created_at', 'updated_at', 'deleted_at', 'deleted_by_name', 'deleted_by_phone'
          ],
          'cash', to_jsonb(d) - array['created_at', 'updated_at']
        ),
        mt.created_by_user_id,
        mt.created_by_name
      ) as entry
      from public.money_transfers mt
      join public.money_transfer_cash_details d on d.transfer_id = mt.id
      where mt.id = p_source_id
        and mt.transfer_type = 'cash'
        and mt.transfer_method = 'cash'
        and mt.record_status <> 'deleted'
        and d.sent_total > 0

      union all

      select private.dashboard_money_event_entry(
        'cash-transfer-in:' || mt.id::text,
        mt.target_location_id,
        'transfer_in',
        'CASH-' || left(mt.id::text, 8),
        'รับโอนเงินสดเข้าสาขา',
        'income',
        d.received_total,
        jsonb_build_object(
          'parent', to_jsonb(mt) - array[
            'sync_status', 'revision_no', 'client_recorded_at', 'server_received_at',
            'created_at', 'updated_at', 'deleted_at', 'deleted_by_name', 'deleted_by_phone'
          ],
          'cash', to_jsonb(d) - array['created_at', 'updated_at']
        ),
        coalesce(d.received_by_user_id, mt.created_by_user_id),
        coalesce(d.received_by_name, mt.created_by_name)
      ) as entry
      from public.money_transfers mt
      join public.money_transfer_cash_details d on d.transfer_id = mt.id
      where mt.id = p_source_id
        and mt.transfer_type = 'cash'
        and mt.transfer_method = 'cash'
        and mt.record_status <> 'deleted'
        and d.cash_status in ('received', 'mismatched', 'difference_accepted')
        and d.received_total > 0
    ) candidates;

    return v_entries;
  elsif p_source_type = 'withdrawal' then
    select ft.*, profile.name as profile_name,
      approver.name as approver_name
    into v_row
    from public.financial_transactions ft
    join public.profiles profile on profile.id = ft.profile_id
    left join public.profiles approver on approver.id = ft.approved_by
    where ft.id = p_source_id;

    if not found
      or v_row.type::text <> 'WITHDRAWAL'
      or v_row.status::text <> 'APPROVED'
      or v_row.cancelled_at is not null
      or v_row.expense_location_id is null
      or v_row.amount <= 0
    then
      return v_entries;
    end if;

    return jsonb_build_array(private.dashboard_money_event_entry(
      'withdrawal:' || v_row.id::text,
      v_row.expense_location_id,
      'expense',
      'TW-' || left(v_row.id::text, 8),
      'เบิกเงิน — ' || coalesce(v_row.profile_name, 'พนักงาน')
        || coalesce(': ' || nullif(v_row.description, ''), ''),
      'expense',
      v_row.amount,
      jsonb_build_object(
        'profileId', v_row.profile_id,
        'amount', v_row.amount,
        'description', v_row.description,
        'effectiveDate', v_row.effective_date,
        'expenseLocationId', v_row.expense_location_id,
        'status', v_row.status
      ),
      v_row.approved_by,
      v_row.approver_name
    ));
  elsif p_source_type = 'payroll_slip' then
    select slip.*, profile.name as profile_name,
      approver.name as approver_name
    into v_row
    from public.payroll_slips slip
    join public.profiles profile on profile.id = slip.profile_id
    left join public.profiles approver on approver.id = slip.approved_by
    where slip.id = p_source_id;

    if not found
      or v_row.status::text <> 'APPROVED'
      or v_row.cancelled_at is not null
      or v_row.expense_location_id is null
      or v_row.net_pay <= 0
    then
      return v_entries;
    end if;

    return jsonb_build_array(private.dashboard_money_event_entry(
      'payroll:' || v_row.id::text,
      v_row.expense_location_id,
      'expense',
      'PS-' || left(v_row.id::text, 8),
      'เงินเดือน — ' || coalesce(v_row.profile_name, 'พนักงาน') || ' — ' || v_row.month,
      'expense',
      v_row.net_pay,
      jsonb_build_object(
        'profileId', v_row.profile_id,
        'month', v_row.month,
        'grossPay', v_row.gross_pay,
        'totalDeductions', v_row.total_deductions,
        'netPay', v_row.net_pay,
        'totalDays', v_row.total_days,
        'dailyWage', v_row.daily_wage,
        'expenseLocationId', v_row.expense_location_id,
        'status', v_row.status,
        'slipData', v_row.slip_data
      ),
      v_row.approved_by,
      v_row.approver_name
    ));
  elsif p_source_type = 'ocr_ticket' then
    select * into v_row
    from public.ocr_tickets
    where id = p_source_id;

    if not found or v_row.record_status <> 'active' or v_row.total_amount <= 0 then
      return v_entries;
    end if;

    return jsonb_build_array(private.dashboard_money_event_entry(
      'ocr-ticket:' || v_row.id::text,
      v_row.location_id,
      'rubber_bill',
      coalesce(nullif(v_row.ticket_id, ''), left(v_row.id::text, 8)),
      'รับซื้อยางจากใบชั่ง — '
        || coalesce(nullif(v_row.customer_name, ''), 'ไม่ระบุลูกค้า'),
      'expense',
      v_row.total_amount,
      to_jsonb(v_row) - array[
        'sync_status', 'revision_no', 'client_recorded_at', 'server_received_at',
        'created_at', 'updated_at', 'deleted_at', 'deleted_by_name', 'deleted_by_phone',
        'drive_file_id', 'drive_url'
      ],
      v_row.created_by_user_id,
      v_row.created_by_name
    ));
  elsif p_source_type = 'rubber_export' then
    select * into v_row
    from public.rubber_exports
    where id = p_source_id;

    if not found
      or v_row.status <> 'verified'
      or v_row.expense_destination <> 'branch'
      or v_row.work_total <= 0
    then
      return v_entries;
    end if;

    return jsonb_build_array(private.dashboard_money_event_entry(
      'rubber-export:' || v_row.id::text,
      v_row.location_id,
      'rubber_export',
      v_row.export_no,
      'ค่าทำงานส่งออกยาง — ' || v_row.export_no,
      'expense',
      v_row.work_total,
      jsonb_build_object(
        'exportNo', v_row.export_no,
        'exportDate', v_row.export_date,
        'status', v_row.status,
        'originalWeightTotal', v_row.original_weight_total,
        'paidTotal', v_row.paid_total,
        'averagePrice', v_row.average_price,
        'currentWeight', v_row.current_weight,
        'weightLossPercent', v_row.weight_loss_percent,
        'workRate', v_row.work_rate,
        'otherOperatingCost', v_row.other_operating_cost,
        'workTotal', v_row.work_total,
        'expenseDestination', v_row.expense_destination
      ),
      coalesce(v_row.verified_by_user_id, v_row.created_by_user_id),
      coalesce(v_row.verified_by_name, v_row.created_by_name)
    ));
  end if;

  return v_entries;
end;
$$;

create or replace function private.append_dashboard_money_event(
  p_source_type text,
  p_source_id uuid,
  p_action text,
  p_payload jsonb,
  p_actor_user_id uuid default null,
  p_actor_name text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := coalesce(auth.uid(), p_actor_user_id, nullif(p_payload->>'actorUserId', '')::uuid);
  v_actor_name text;
  v_occurred_at timestamptz := clock_timestamp();
begin
  if v_actor_id is not null then
    select name into v_actor_name
    from public.profiles
    where id = v_actor_id;
  end if;

  v_actor_name := coalesce(
    nullif(v_actor_name, ''),
    nullif(p_actor_name, ''),
    nullif(p_payload->>'actorName', ''),
    'ระบบ'
  );

  insert into public.dashboard_money_events (
    location_id, source_type, source_id, event_key, action, kind, number,
    title, direction, amount, actor_user_id, actor_name, occurred_at, event_date
  ) values (
    (p_payload->>'locationId')::uuid,
    p_source_type,
    p_source_id,
    p_payload->>'eventKey',
    p_action,
    p_payload->>'kind',
    p_payload->>'number',
    p_payload->>'title',
    p_payload->>'direction',
    (p_payload->>'amount')::numeric,
    v_actor_id,
    v_actor_name,
    v_occurred_at,
    (v_occurred_at at time zone 'Asia/Bangkok')::date
  );
end;
$$;

create or replace function private.reconcile_dashboard_money_source(
  p_source_type text,
  p_source_id uuid,
  p_actor_user_id uuid default null,
  p_actor_name text default null,
  p_emit_events boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_entries jsonb;
  v_new_entries jsonb := private.dashboard_money_source_entries(p_source_type, p_source_id);
  v_old jsonb;
  v_new jsonb;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('dashboard-money-history:' || p_source_type || ':' || p_source_id::text, 0)
  );

  select coalesce(jsonb_agg(payload order by event_key), '[]'::jsonb)
  into v_old_entries
  from private.dashboard_money_event_projection
  where source_type = p_source_type
    and source_id = p_source_id;

  if p_emit_events then
    for v_old in select value from jsonb_array_elements(v_old_entries)
    loop
      select value into v_new
      from jsonb_array_elements(v_new_entries)
      where value->>'eventKey' = v_old->>'eventKey'
      limit 1;

      if v_new is null then
        perform private.append_dashboard_money_event(
          p_source_type, p_source_id, 'delete', v_old,
          p_actor_user_id, p_actor_name
        );
      elsif v_new->>'fingerprint' is distinct from v_old->>'fingerprint' then
        perform private.append_dashboard_money_event(
          p_source_type, p_source_id, 'update', v_new,
          p_actor_user_id, p_actor_name
        );
      end if;
      v_new := null;
    end loop;

    for v_new in select value from jsonb_array_elements(v_new_entries)
    loop
      if not exists (
        select 1
        from jsonb_array_elements(v_old_entries) old_entry
        where old_entry->>'eventKey' = v_new->>'eventKey'
      ) then
        perform private.append_dashboard_money_event(
          p_source_type, p_source_id, 'create', v_new,
          p_actor_user_id, p_actor_name
        );
      end if;
    end loop;
  end if;

  delete from private.dashboard_money_event_projection
  where source_type = p_source_type
    and source_id = p_source_id;

  insert into private.dashboard_money_event_projection (
    source_type, source_id, event_key, payload
  )
  select p_source_type, p_source_id, value->>'eventKey', value
  from jsonb_array_elements(v_new_entries);
end;
$$;

create or replace function private.capture_dashboard_money_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_type text;
  v_source_id uuid;
  v_actor_user_id uuid;
  v_actor_name text;
  v_new jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  v_old jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
begin
  if tg_table_name = 'income_expense' then
    v_source_type := 'income_expense';
    v_source_id := coalesce(v_new->>'id', v_old->>'id')::uuid;
    if tg_op = 'UPDATE' and v_new->>'record_status' = 'deleted' then
      v_actor_name := v_new->>'deleted_by_name';
    else
      v_actor_user_id := coalesce(
        nullif(v_new->>'created_by_user_id', '')::uuid,
        nullif(v_old->>'created_by_user_id', '')::uuid
      );
      v_actor_name := coalesce(v_new->>'created_by_name', v_old->>'created_by_name');
    end if;
  elsif tg_table_name = 'income_expense_sale_lines' then
    v_source_type := 'income_expense';
    v_source_id := coalesce(
      v_new->>'income_expense_id', v_old->>'income_expense_id'
    )::uuid;
  elsif tg_table_name = 'rubber_bills' then
    v_source_type := 'rubber_bill';
    v_source_id := coalesce(v_new->>'id', v_old->>'id')::uuid;
    if tg_op = 'UPDATE' and v_new->>'record_status' = 'deleted' then
      v_actor_name := v_new->>'deleted_by_name';
    else
      v_actor_user_id := coalesce(
        nullif(v_new->>'created_by_user_id', '')::uuid,
        nullif(v_old->>'created_by_user_id', '')::uuid
      );
      v_actor_name := coalesce(v_new->>'created_by_name', v_old->>'created_by_name');
    end if;
  elsif tg_table_name = 'rubber_bill_items' then
    v_source_type := 'rubber_bill';
    v_source_id := coalesce(v_new->>'bill_id', v_old->>'bill_id')::uuid;
  elsif tg_table_name = 'money_transfers' then
    v_source_id := coalesce(v_new->>'id', v_old->>'id')::uuid;
    v_actor_user_id := coalesce(
      nullif(v_new->>'created_by_user_id', '')::uuid,
      nullif(v_old->>'created_by_user_id', '')::uuid
    );
    v_actor_name := case
      when tg_op = 'UPDATE' and v_new->>'record_status' = 'deleted'
        then v_new->>'deleted_by_name'
      else coalesce(v_new->>'created_by_name', v_old->>'created_by_name')
    end;
    perform private.reconcile_dashboard_money_source(
      'money_transfer', v_source_id, v_actor_user_id, v_actor_name
    );
    perform private.reconcile_dashboard_money_source(
      'cash_transfer', v_source_id, v_actor_user_id, v_actor_name
    );
    if tg_op = 'DELETE' then return old; end if;
    return new;
  elsif tg_table_name = 'money_transfer_cash_details' then
    v_source_type := 'cash_transfer';
    v_source_id := coalesce(v_new->>'transfer_id', v_old->>'transfer_id')::uuid;
    v_actor_user_id := coalesce(
      nullif(v_new->>'received_by_user_id', '')::uuid,
      nullif(v_old->>'received_by_user_id', '')::uuid
    );
    v_actor_name := coalesce(v_new->>'received_by_name', v_old->>'received_by_name');
  elsif tg_table_name = 'financial_transactions' then
    v_source_type := 'withdrawal';
    v_source_id := coalesce(v_new->>'id', v_old->>'id')::uuid;
    v_actor_user_id := case
      when tg_op = 'UPDATE' and v_new->>'cancelled_at' is not null
        then nullif(v_new->>'cancelled_by', '')::uuid
      else coalesce(
        nullif(v_new->>'approved_by', '')::uuid,
        nullif(v_old->>'approved_by', '')::uuid
      )
    end;
  elsif tg_table_name = 'payroll_slips' then
    v_source_type := 'payroll_slip';
    v_source_id := coalesce(v_new->>'id', v_old->>'id')::uuid;
    v_actor_user_id := case
      when tg_op = 'UPDATE' and v_new->>'cancelled_at' is not null
        then nullif(v_new->>'cancelled_by', '')::uuid
      else coalesce(
        nullif(v_new->>'approved_by', '')::uuid,
        nullif(v_old->>'approved_by', '')::uuid,
        nullif(v_new->>'created_by', '')::uuid,
        nullif(v_old->>'created_by', '')::uuid
      )
    end;
  elsif tg_table_name = 'ocr_tickets' then
    v_source_type := 'ocr_ticket';
    v_source_id := coalesce(v_new->>'id', v_old->>'id')::uuid;
    if tg_op = 'UPDATE' and v_new->>'record_status' = 'deleted' then
      v_actor_name := v_new->>'deleted_by_name';
    else
      v_actor_user_id := coalesce(
        nullif(v_new->>'created_by_user_id', '')::uuid,
        nullif(v_old->>'created_by_user_id', '')::uuid
      );
      v_actor_name := coalesce(v_new->>'created_by_name', v_old->>'created_by_name');
    end if;
  elsif tg_table_name = 'rubber_exports' then
    v_source_type := 'rubber_export';
    v_source_id := coalesce(v_new->>'id', v_old->>'id')::uuid;
    if (tg_op = 'DELETE') or (tg_op = 'UPDATE' and v_new->>'deleted_at' is not null) then
      v_actor_user_id := coalesce(
        nullif(v_new->>'deleted_by_user_id', '')::uuid,
        nullif(v_old->>'deleted_by_user_id', '')::uuid
      );
      v_actor_name := coalesce(v_new->>'deleted_by_name', v_old->>'deleted_by_name');
    else
      v_actor_user_id := coalesce(
        nullif(v_new->>'verified_by_user_id', '')::uuid,
        nullif(v_old->>'verified_by_user_id', '')::uuid,
        nullif(v_new->>'created_by_user_id', '')::uuid,
        nullif(v_old->>'created_by_user_id', '')::uuid
      );
      v_actor_name := coalesce(
        v_new->>'verified_by_name', v_old->>'verified_by_name',
        v_new->>'created_by_name', v_old->>'created_by_name'
      );
    end if;
  else
    raise exception 'Unsupported money event source table: %', tg_table_name;
  end if;

  perform private.reconcile_dashboard_money_source(
    v_source_type, v_source_id, v_actor_user_id, v_actor_name
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Seed only the current projection state. This deliberately creates no history.
do $$
declare
  source_row record;
begin
  for source_row in
    select 'income_expense'::text as source_type, id as source_id from public.income_expense
    union all select 'rubber_bill', id from public.rubber_bills
    union all select 'money_transfer', id from public.money_transfers
    union all select 'cash_transfer', id from public.money_transfers
    union all select 'withdrawal', id from public.financial_transactions
    union all select 'payroll_slip', id from public.payroll_slips
    union all select 'ocr_ticket', id from public.ocr_tickets
    union all select 'rubber_export', id from public.rubber_exports
  loop
    perform private.reconcile_dashboard_money_source(
      source_row.source_type, source_row.source_id, null, null, false
    );
  end loop;
end;
$$;

create constraint trigger dashboard_money_event_income_expense
  after insert or update or delete on public.income_expense
  deferrable initially deferred
  for each row execute function private.capture_dashboard_money_source();

create constraint trigger dashboard_money_event_income_sale_lines
  after insert or update or delete on public.income_expense_sale_lines
  deferrable initially deferred
  for each row execute function private.capture_dashboard_money_source();

create constraint trigger dashboard_money_event_rubber_bills
  after insert or update or delete on public.rubber_bills
  deferrable initially deferred
  for each row execute function private.capture_dashboard_money_source();

create constraint trigger dashboard_money_event_rubber_bill_items
  after insert or update or delete on public.rubber_bill_items
  deferrable initially deferred
  for each row execute function private.capture_dashboard_money_source();

create constraint trigger dashboard_money_event_money_transfers
  after insert or update or delete on public.money_transfers
  deferrable initially deferred
  for each row execute function private.capture_dashboard_money_source();

create constraint trigger dashboard_money_event_cash_details
  after insert or update or delete on public.money_transfer_cash_details
  deferrable initially deferred
  for each row execute function private.capture_dashboard_money_source();

create constraint trigger dashboard_money_event_withdrawal_insert
  after insert on public.financial_transactions
  deferrable initially deferred
  for each row
  when (new.type::text = 'WITHDRAWAL')
  execute function private.capture_dashboard_money_source();

create constraint trigger dashboard_money_event_withdrawal_update
  after update on public.financial_transactions
  deferrable initially deferred
  for each row
  when (old.type::text = 'WITHDRAWAL' or new.type::text = 'WITHDRAWAL')
  execute function private.capture_dashboard_money_source();

create constraint trigger dashboard_money_event_withdrawal_delete
  after delete on public.financial_transactions
  deferrable initially deferred
  for each row
  when (old.type::text = 'WITHDRAWAL')
  execute function private.capture_dashboard_money_source();

create constraint trigger dashboard_money_event_payroll
  after insert or update or delete on public.payroll_slips
  deferrable initially deferred
  for each row execute function private.capture_dashboard_money_source();

create constraint trigger dashboard_money_event_ocr_tickets
  after insert or update or delete on public.ocr_tickets
  deferrable initially deferred
  for each row execute function private.capture_dashboard_money_source();

create constraint trigger dashboard_money_event_rubber_exports
  after insert or update or delete on public.rubber_exports
  deferrable initially deferred
  for each row execute function private.capture_dashboard_money_source();

create or replace function private.prune_dashboard_money_events()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count bigint;
begin
  delete from public.dashboard_money_events
  where event_date < (current_timestamp at time zone 'Asia/Bangkok')::date - 14;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

do $$
declare
  existing_job_id bigint;
begin
  for existing_job_id in
    select jobid from cron.job where jobname = 'lanflow-dashboard-money-history-retention'
  loop
    perform cron.unschedule(existing_job_id);
  end loop;

  perform cron.schedule(
    'lanflow-dashboard-money-history-retention',
    '10 17 * * *',
    'select private.prune_dashboard_money_events()'
  );
end;
$$;

create or replace function public.get_dashboard_money_history(
  p_location_id uuid,
  p_event_date date default null,
  p_action text default null,
  p_cursor_at timestamptz default null,
  p_cursor_id uuid default null,
  p_page_size integer default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  page_size integer := least(greatest(coalesce(p_page_size, 10), 1), 50);
  today_bangkok date := (current_timestamp at time zone 'Asia/Bangkok')::date;
  from_date date := (current_timestamp at time zone 'Asia/Bangkok')::date - 14;
  selected_date date;
  normalized_action text := nullif(p_action, 'all');
begin
  if not private.is_active_user()
    or not public.can_access_location(p_location_id)
  then
    raise exception 'Location access denied';
  end if;

  if normalized_action is not null
    and normalized_action not in ('create', 'update', 'delete')
  then
    raise exception 'Invalid money history action';
  end if;

  if (p_cursor_at is null) <> (p_cursor_id is null) then
    raise exception 'Invalid money history cursor';
  end if;

  if p_event_date is not null
    and (p_event_date < from_date or p_event_date > today_bangkok)
  then
    raise exception 'Money history date is outside retention window';
  end if;

  selected_date := p_event_date;
  if selected_date is null then
    select max(event_date)
    into selected_date
    from public.dashboard_money_events
    where location_id = p_location_id
      and event_date between from_date and today_bangkok;
    selected_date := coalesce(selected_date, today_bangkok);
  end if;

  return (
    with filtered as (
      select event.*
      from public.dashboard_money_events event
      where event.location_id = p_location_id
        and event.event_date = selected_date
        and (normalized_action is null or event.action = normalized_action)
        and (
          p_cursor_at is null
          or (event.occurred_at, event.id) < (p_cursor_at, p_cursor_id)
        )
      order by event.occurred_at desc, event.id desc
      limit page_size + 1
    ),
    visible as (
      select *
      from filtered
      order by occurred_at desc, id desc
      limit page_size
    ),
    counts as (
      select
        count(*) as total,
        count(*) filter (where action = 'create') as created,
        count(*) filter (where action = 'update') as updated,
        count(*) filter (where action = 'delete') as deleted,
        max(occurred_at) as latest_at
      from public.dashboard_money_events
      where location_id = p_location_id
        and event_date = selected_date
    )
    select jsonb_build_object(
      'selectedDate', selected_date,
      'availableFrom', from_date,
      'availableTo', today_bangkok,
      'counts', jsonb_build_object(
        'all', counts.total,
        'create', counts.created,
        'update', counts.updated,
        'delete', counts.deleted
      ),
      'latestAt', counts.latest_at,
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', id,
          'action', action,
          'kind', kind,
          'number', number,
          'title', title,
          'direction', direction,
          'amount', round(amount, 2),
          'actorName', actor_name,
          'occurredAt', occurred_at
        ) order by occurred_at desc, id desc)
        from visible
      ), '[]'::jsonb),
      'nextCursor', case
        when (select count(*) from filtered) > page_size then (
          select jsonb_build_object('at', occurred_at, 'id', id)
          from visible
          order by occurred_at desc, id desc
          offset page_size - 1
          limit 1
        )
        else null
      end
    )
    from counts
  );
end;
$$;

revoke all on function public.get_dashboard_money_history(
  uuid, date, text, timestamptz, uuid, integer
) from public, anon;
grant execute on function public.get_dashboard_money_history(
  uuid, date, text, timestamptz, uuid, integer
) to authenticated, service_role;

-- The Dashboard route now reads the action-history RPC. The former standalone
-- live-feed RPC has no remaining application or database caller.
drop function if exists public.get_dashboard_money_feed(
  uuid, timestamptz, text, integer
);

revoke all on function private.dashboard_money_event_entry(
  text, uuid, text, text, text, text, numeric, jsonb, uuid, text
) from public, anon, authenticated;
revoke all on function private.dashboard_money_source_entries(text, uuid)
  from public, anon, authenticated;
revoke all on function private.append_dashboard_money_event(
  text, uuid, text, jsonb, uuid, text
) from public, anon, authenticated;
revoke all on function private.reconcile_dashboard_money_source(
  text, uuid, uuid, text, boolean
) from public, anon, authenticated;
revoke all on function private.capture_dashboard_money_source()
  from public, anon, authenticated;
revoke all on function private.prune_dashboard_money_events()
  from public, anon, authenticated;

grant execute on function private.prune_dashboard_money_events() to service_role;
