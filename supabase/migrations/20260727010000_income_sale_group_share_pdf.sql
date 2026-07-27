-- Group sale lines from one Income/Expense form without changing the existing
-- stock/accounting row model. The wrapper keeps the proven stock RPC intact.

alter table public.income_expense
  add column if not exists sale_group_id uuid,
  add column if not exists sale_line_order integer,
  add column if not exists sale_expected_lines integer;

alter table public.income_expense
  add constraint income_expense_sale_group_shape_check
  check (
    (
      sale_group_id is null
      and sale_line_order is null
      and sale_expected_lines is null
    )
    or
    (
      sale_group_id is not null
      and sale_line_order >= 1
      and sale_expected_lines >= 1
      and bill_option = 'บิลขาย'
    )
  );

create unique index if not exists income_expense_active_sale_group_line_uidx
  on public.income_expense (location_id, sale_group_id, sale_line_order)
  where record_status = 'active' and sale_group_id is not null;

alter function public.sync_income_expense(jsonb)
  rename to sync_income_expense_core;

revoke all on function public.sync_income_expense_core(jsonb) from public, anon, authenticated;

create function public.sync_income_expense(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_operation text := payload->>'operation';
  v_bill_option text := payload->>'billOption';
  v_client_temp_id text := payload->>'clientTempId';
  v_location_id uuid := nullif(payload->>'locationId', '')::uuid;
  v_idempotency_key text := payload->>'idempotencyKey';
  v_previous_location_id uuid;
  v_sale_group_id uuid;
  v_previous_sale_group_id uuid;
  v_previous_sale_line_order integer;
  v_previous_sale_expected_lines integer;
  v_sale_line_order integer;
  v_sale_expected_lines integer;
  v_remaining_lines integer;
begin
  if v_operation in ('update', 'delete') then
    perform pg_advisory_xact_lock(hashtext('income_expense:' || v_client_temp_id));
    select location_id, sale_group_id, sale_line_order, sale_expected_lines
      into v_previous_location_id, v_previous_sale_group_id,
           v_previous_sale_line_order, v_previous_sale_expected_lines
    from public.income_expense
    where client_temp_id = v_client_temp_id;

    if v_previous_location_id is not null
       and v_previous_location_id is distinct from v_location_id then
      return jsonb_build_object(
        'status', 'failed',
        'errorMessage', 'ไม่สามารถย้ายรายการรับ-จ่ายข้ามสาขาได้'
      );
    end if;
  end if;

  if v_operation in ('create', 'update') and v_bill_option = 'บิลขาย' then
    v_sale_group_id := nullif(payload->>'saleGroupId', '')::uuid;
    v_sale_line_order := nullif(payload->>'saleLineOrder', '')::integer;
    v_sale_expected_lines := nullif(payload->>'saleExpectedLines', '')::integer;

    if v_sale_group_id is null
       or v_sale_line_order is null
       or v_sale_expected_lines is null
       or v_sale_line_order < 1
       or v_sale_expected_lines < 1 then
      return jsonb_build_object(
        'status', 'failed',
        'errorMessage', 'ข้อมูลกลุ่มบิลขายไม่ถูกต้อง'
      );
    end if;
    if v_operation = 'update'
       and v_previous_sale_group_id is not null
       and v_sale_group_id is distinct from v_previous_sale_group_id then
      return jsonb_build_object(
        'status', 'failed',
        'errorMessage', 'ไม่สามารถย้ายรายการไปกลุ่มบิลขายอื่นได้'
      );
    end if;
  elsif v_operation = 'delete' then
    v_sale_group_id := v_previous_sale_group_id;
  end if;

  if v_previous_sale_group_id is not null then
    perform pg_advisory_xact_lock(
      hashtext('income-sale-group:' || v_previous_location_id::text || ':' || v_previous_sale_group_id::text)
    );
  end if;
  if v_sale_group_id is not null
     and v_sale_group_id is distinct from v_previous_sale_group_id then
    perform pg_advisory_xact_lock(
      hashtext('income-sale-group:' || v_location_id::text || ':' || v_sale_group_id::text)
    );
  end if;

  if v_operation = 'update'
     and v_previous_sale_group_id is not null
     and v_bill_option <> 'บิลขาย' then
    update public.income_expense
    set sale_group_id = null,
        sale_line_order = null,
        sale_expected_lines = null
    where client_temp_id = v_client_temp_id
      and location_id = v_previous_location_id;
  end if;

  v_result := public.sync_income_expense_core(payload);
  if coalesce(v_result->>'status', '') <> 'synced' then
    if v_operation = 'update'
       and v_previous_sale_group_id is not null
       and v_bill_option <> 'บิลขาย' then
      update public.income_expense
      set sale_group_id = v_previous_sale_group_id,
          sale_line_order = v_previous_sale_line_order,
          sale_expected_lines = v_previous_sale_expected_lines
      where client_temp_id = v_client_temp_id
        and location_id = v_previous_location_id;
    end if;
    return v_result;
  end if;

  if v_operation in ('create', 'update') then
    update public.income_expense
    set sale_group_id = case when v_bill_option = 'บิลขาย' then v_sale_group_id else null end,
        sale_line_order = case when v_bill_option = 'บิลขาย' then v_sale_line_order else null end,
        sale_expected_lines = case when v_bill_option = 'บิลขาย' then v_sale_expected_lines else null end
    where client_temp_id = v_client_temp_id
      and location_id = v_location_id
      and idempotency_key = v_idempotency_key;

    if v_operation = 'update'
       and v_previous_sale_group_id is not null
       and v_previous_sale_group_id is distinct from v_sale_group_id then
      select count(*)::integer
        into v_remaining_lines
      from public.income_expense
      where location_id = v_previous_location_id
        and sale_group_id = v_previous_sale_group_id
        and record_status = 'active';

      update public.income_expense
      set sale_expected_lines = v_remaining_lines
      where location_id = v_previous_location_id
        and sale_group_id = v_previous_sale_group_id
        and record_status = 'active';
    end if;
  elsif v_operation = 'delete' and v_previous_sale_group_id is not null then
    select count(*)::integer
      into v_remaining_lines
    from public.income_expense
    where location_id = v_previous_location_id
      and sale_group_id = v_previous_sale_group_id
      and record_status = 'active';

    update public.income_expense
    set sale_expected_lines = v_remaining_lines
    where location_id = v_previous_location_id
      and sale_group_id = v_previous_sale_group_id
      and record_status = 'active';
  end if;

  return v_result;
exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;

revoke all on function public.sync_income_expense(jsonb) from public, anon;
grant execute on function public.sync_income_expense(jsonb) to authenticated;
