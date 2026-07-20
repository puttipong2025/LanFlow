-- Unified system-manager access controlled only by the real super_admin.
-- This grants near-super_admin feature access without changing profiles.role.

alter table public.profiles
  add column if not exists can_access_super_admin_features boolean not null default false;

update public.profiles
set can_access_super_admin_features = true,
    can_access_money_transfer = true
where role = 'super_admin';

-- Existing money-transfer-only grants become the new unified system-manager grant.
update public.profiles
set can_access_super_admin_features = true
where role in ('user', 'admin')
  and can_access_money_transfer = true;

update public.profiles
set can_access_money_transfer = true
where can_access_super_admin_features = true;

grant select (can_access_super_admin_features), update (can_access_super_admin_features)
  on public.profiles to authenticated;

create or replace function private.can_access_super_admin_features()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_super_admin()
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.is_active = true
        and p.role in ('user', 'admin')
        and p.can_access_super_admin_features = true
    )
$$;

create or replace function public.can_access_super_admin_features()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_access_super_admin_features()
$$;

revoke all on function private.can_access_super_admin_features() from public, anon;
revoke all on function public.can_access_super_admin_features() from public, anon;
grant execute on function private.can_access_super_admin_features() to authenticated;
grant execute on function public.can_access_super_admin_features() to authenticated;

create or replace function private.can_access_location(target_location uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_access_super_admin_features()
    or (
      private.is_active_user()
      and target_location is not null
      and exists (
        select 1
        from public.user_locations ul
        where ul.user_id = auth.uid()
          and ul.location_id = target_location
      )
    )
$$;

create or replace function private.can_access_optional_location(target_location uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_access_super_admin_features()
    or (
      target_location is not null
      and private.can_access_location(target_location)
    )
$$;

create or replace function private.can_view_profile(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_active_user()
    and (
      target_user = auth.uid()
      or private.can_access_super_admin_features()
      or (
        private.current_user_role() = 'admin'
        and exists (
          select 1
          from public.user_locations mine
          join public.user_locations theirs
            on theirs.location_id = mine.location_id
          where mine.user_id = auth.uid()
            and theirs.user_id = target_user
        )
      )
    )
$$;

create or replace function private.can_manage_location(target_location uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_access_super_admin_features()
    or (
      private.current_user_role() = 'admin'
      and private.can_access_location(target_location)
    )
$$;

create or replace function private.can_manage_profile(target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (
      private.can_access_super_admin_features()
      and exists (
        select 1
        from public.profiles target
        where target.id = target_user
          and target.role <> 'super_admin'
          and target.is_active = true
      )
    )
    or (
      private.current_user_role() = 'admin'
      and exists (
        select 1
        from public.profiles target
        where target.id = target_user
          and target.role = 'user'
          and target.is_active = true
      )
      and exists (
        select 1
        from public.user_locations mine
        join public.user_locations theirs
          on theirs.location_id = mine.location_id
        where mine.user_id = auth.uid()
          and theirs.user_id = target_user
      )
    )
$$;

grant execute on function private.can_access_location(uuid) to authenticated;
grant execute on function private.can_access_optional_location(uuid) to authenticated;
grant execute on function private.can_view_profile(uuid) to authenticated;
grant execute on function private.can_manage_location(uuid) to authenticated;
grant execute on function private.can_manage_profile(uuid) to authenticated;

create or replace function private.can_access_money_transfer_module()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_access_super_admin_features()
$$;

revoke all on function private.can_access_money_transfer_module() from public, anon;
grant execute on function private.can_access_money_transfer_module() to authenticated;

drop policy if exists "Allow super_admin to read all items" on public.income_sale_items;
drop policy if exists "Allow super_admin to insert" on public.income_sale_items;
drop policy if exists "Allow super_admin to update" on public.income_sale_items;
drop policy if exists "Allow system managers to read all items" on public.income_sale_items;
drop policy if exists "Allow system managers to insert" on public.income_sale_items;
drop policy if exists "Allow system managers to update" on public.income_sale_items;

create policy "Allow system managers to read all items"
  on public.income_sale_items for select to authenticated
  using (public.can_access_super_admin_features());

create policy "Allow system managers to insert"
  on public.income_sale_items for insert to authenticated
  with check (public.can_access_super_admin_features());

create policy "Allow system managers to update"
  on public.income_sale_items for update to authenticated
  using (public.can_access_super_admin_features())
  with check (public.can_access_super_admin_features());

create or replace function public.delete_income_sale_item(item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item_name text;
  usage_count bigint;
begin
  if not public.can_access_super_admin_features() then
    raise exception 'Permission denied: only system managers can delete sale items';
  end if;

  select name into item_name
  from public.income_sale_items
  where id = item_id;

  if item_name is null then
    raise exception 'Item not found';
  end if;

  select count(*) into usage_count
  from public.income_expense
  where title = item_name
    and bill_option = 'บิลขาย'
    and record_status != 'deleted';

  if usage_count > 0 then
    raise exception 'ไม่สามารถลบได้ เพราะมีรายการรายรับที่ใช้ "%" อยู่ % รายการ', item_name, usage_count;
  end if;

  delete from public.income_sale_items where id = item_id;
end;
$$;

revoke all on function public.delete_income_sale_item(uuid) from public, anon;
grant execute on function public.delete_income_sale_item(uuid) to authenticated;

drop policy if exists "income_expense_approval_settings_super_admin_write" on public.income_expense_approval_settings;
drop policy if exists "income_expense_approval_keywords_super_admin_write" on public.income_expense_approval_keywords;
drop policy if exists "income_expense_approval_requests_read" on public.income_expense_approval_requests;
drop policy if exists "income_expense_approval_settings_system_manager_write" on public.income_expense_approval_settings;
drop policy if exists "income_expense_approval_keywords_system_manager_write" on public.income_expense_approval_keywords;

create policy "income_expense_approval_settings_system_manager_write"
  on public.income_expense_approval_settings for all to authenticated
  using (public.can_access_super_admin_features())
  with check (public.can_access_super_admin_features());

create policy "income_expense_approval_keywords_system_manager_write"
  on public.income_expense_approval_keywords for all to authenticated
  using (public.can_access_super_admin_features())
  with check (public.can_access_super_admin_features());

create policy "income_expense_approval_requests_read"
  on public.income_expense_approval_requests for select to authenticated
  using (
    public.can_access_super_admin_features()
    or requested_by_user_id = auth.uid()
    or public.can_access_location(location_id)
  );

create or replace function public.decide_income_expense_approval_request(p_request_id uuid, p_decision text, p_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request record;
  v_decider_id uuid;
  v_decider_name text;
  v_decider_phone text;
  v_payload jsonb;
  v_operation text;
  v_location_id uuid;
  v_type text;
  v_bill_option text;
  v_cost numeric;
  v_client_temp_id text;
  v_idempotency_key text;
  v_existing_id uuid;
  v_existing_idempotency text;
  v_server_bill_no text;
  v_date text;
  v_next_seq integer;
  v_row_id uuid;
  v_revision integer;
  v_sync_result jsonb;
begin
  if not public.can_access_super_admin_features() then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'เฉพาะผู้จัดการระบบเท่านั้นที่อนุมัติหรือปฏิเสธได้');
  end if;

  if p_decision not in ('approved', 'rejected') then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'Invalid decision');
  end if;

  select *
    into v_request
  from public.income_expense_approval_requests
  where id = p_request_id
  for update;

  if v_request.id is null then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'ไม่พบคำขออนุมัติ');
  end if;

  if v_request.request_status != 'pending' then
    return jsonb_build_object('status', 'failed', 'errorMessage', 'คำขอนี้ถูกดำเนินการไปแล้ว');
  end if;

  v_decider_id := auth.uid();
  select name, phone into v_decider_name, v_decider_phone
  from public.profiles
  where id = v_decider_id;

  if p_decision = 'rejected' then
    update public.income_expense_approval_requests
    set request_status = 'rejected',
        decided_by_user_id = v_decider_id,
        decided_by_name = coalesce(v_decider_name, ''),
        decided_by_phone = coalesce(v_decider_phone, ''),
        decided_at = now(),
        decision_comment = p_comment,
        updated_at = now()
    where id = v_request.id;

    return jsonb_build_object('status', 'rejected', 'requestId', v_request.id);
  end if;

  v_payload := v_request.requested_payload;
  v_operation := v_payload->>'operation';

  if v_operation = 'create' then
    v_location_id := (v_payload->>'locationId')::uuid;
    v_type := v_payload->>'type';
    v_bill_option := v_payload->>'billOption';
    v_cost := (v_payload->>'cost')::numeric;
    v_client_temp_id := v_payload->>'clientTempId';
    v_idempotency_key := v_payload->>'idempotencyKey';

    select id, idempotency_key, server_bill_no, revision_no
      into v_existing_id, v_existing_idempotency, v_server_bill_no, v_revision
    from public.income_expense
    where client_temp_id = v_client_temp_id
    for update;

    if v_existing_id is not null and v_existing_idempotency = v_idempotency_key then
      v_row_id := v_existing_id;
    elsif v_existing_id is not null then
      return jsonb_build_object('status', 'failed', 'errorMessage', 'รายการนี้ถูกสร้างไปแล้ว');
    else
      v_date := to_char((v_payload->>'txDate')::date, 'YYMMDD');
      perform pg_advisory_xact_lock(hashtext(v_location_id::text || v_date));

      select count(*) + 1 into v_next_seq
      from public.income_expense
      where location_id = v_location_id
        and tx_date = (v_payload->>'txDate')::date
        and server_bill_no is not null;

      v_server_bill_no := v_date || lpad(v_next_seq::text, 4, '0');

      insert into public.income_expense (
        client_temp_id, idempotency_key, revision_no, sync_status, record_status,
        location_id, type, number, local_bill_no, server_bill_no,
        tx_date, title, cost, unit, price, bill_option,
        client_recorded_at, client_created_at, server_received_at,
        created_by_user_id, created_by_name, created_by_phone
      ) values (
        v_client_temp_id,
        v_idempotency_key,
        1,
        'synced',
        'active',
        v_location_id,
        v_type::transaction_type,
        v_server_bill_no,
        v_payload->>'localBillNo',
        v_server_bill_no,
        (v_payload->>'txDate')::date,
        v_payload->>'title',
        v_cost,
        case when v_bill_option = 'บิลขาย' then v_payload->>'unit' else null end,
        case when v_bill_option = 'บิลขาย' then (v_payload->>'price')::numeric else null end,
        v_bill_option,
        (v_payload->>'clientRecordedAt')::timestamptz,
        (v_payload->>'clientCreatedAt')::timestamptz,
        now(),
        v_request.requested_by_user_id,
        v_request.requested_by_name,
        v_request.requested_by_phone
      )
      returning id, revision_no into v_row_id, v_revision;
    end if;
  else
    perform set_config('app.bypass_income_expense_approval', 'true', true);
    v_sync_result := public.sync_income_expense(v_payload);
    
    if coalesce(v_sync_result->>'status', 'failed') != 'synced' then
      return v_sync_result;
    end if;

    v_row_id := (v_sync_result->>'id')::uuid;
  end if;

  update public.income_expense_approval_requests
  set request_status = 'approved',
      approved_income_expense_id = v_row_id,
      decided_by_user_id = v_decider_id,
      decided_by_name = coalesce(v_decider_name, ''),
      decided_by_phone = coalesce(v_decider_phone, ''),
      decided_at = now(),
      decision_comment = p_comment,
      updated_at = now()
  where id = v_request.id;

  return jsonb_build_object(
    'status', 'approved',
    'requestId', v_request.id,
    'incomeExpenseId', v_row_id
  );
exception when others then
  return jsonb_build_object('status', 'failed', 'errorMessage', sqlerrm);
end;
$$;

revoke all on function public.decide_income_expense_approval_request(uuid, text, text) from public, anon;
grant execute on function public.decide_income_expense_approval_request(uuid, text, text) to authenticated;
