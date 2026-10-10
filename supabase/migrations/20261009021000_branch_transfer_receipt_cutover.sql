-- Cut new bank branch transfers over to recipient confirmation.

alter function public.save_money_transfer(jsonb)
  rename to save_money_transfer_before_branch_receipt;

revoke all on function public.save_money_transfer_before_branch_receipt(jsonb)
  from public, anon, authenticated;

create or replace function public.save_money_transfer(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := nullif(p_payload->>'id', '')::uuid;
  v_operation text := coalesce(p_payload->>'operation', 'create');
  v_transfer_type text := coalesce(p_payload->>'transferType', 'customer');
  v_contract_version integer := nullif(p_payload->>'receiptContractVersion', '')::integer;
  v_requested_target_id uuid := nullif(p_payload->>'targetLocationId', '')::uuid;
  v_existing public.money_transfers;
  v_locked_location_id uuid;
  v_target_name text;
  v_delegate_payload jsonb := p_payload;
  v_result jsonb;
begin
  if v_transfer_type <> 'branch' then
    return public.save_money_transfer_before_branch_receipt(p_payload);
  end if;
  if v_contract_version is distinct from 1 then
    raise exception 'MT_CLIENT_REFRESH_REQUIRED: กรุณารีเฟรชหน้าจอก่อนสร้างหรือแก้ไขรายการโอนให้สาขา';
  end if;
  if v_id is null or v_requested_target_id is null then
    raise exception 'MT_INVALID_PAYLOAD: ข้อมูลรายการโอนไม่ครบ';
  end if;
  if not private.is_active_user() or not private.can_access_money_transfer_module() then
    raise exception 'MT_ACCESS_DENIED: ไม่มีสิทธิ์ใช้งานรายการโอนเงิน';
  end if;
  if not private.can_access_location(v_requested_target_id) then
    raise exception 'MT_TARGET_LOCATION_DENIED: ไม่มีสิทธิ์โอนให้สาขานี้';
  end if;

  select location.name into v_target_name
  from public.locations location
  where location.id = v_requested_target_id
    and location.is_active = true;
  if v_target_name is null then
    raise exception 'MT_TARGET_LOCATION_INACTIVE: สาขาผู้รับไม่เปิดใช้งาน';
  end if;

  if v_operation = 'update' then
    select * into v_existing
    from public.money_transfers transfer
    where transfer.id = v_id;

    if v_existing.id is null or v_existing.record_status = 'deleted'
      or v_existing.transfer_type <> 'branch' then
      raise exception 'MT_NOT_FOUND: ไม่พบรายการโอนเงิน';
    end if;
    if v_existing.branch_receipt_contract_version <> 1 then
      raise exception 'MT_LEGACY_BRANCH_READ_ONLY: รายการรุ่นเดิมดูได้อย่างเดียว';
    end if;
    if v_existing.branch_receipt_status <> 'pending_receipt' then
      raise exception 'MT_BRANCH_RECEIVED_IMMUTABLE: รายการที่ยืนยันรับแล้วแก้ไขไม่ได้';
    end if;
    if not private.can_access_location(v_existing.location_id) then
      raise exception 'MT_LOCATION_DENIED: ไม่มีสิทธิ์เข้าถึงสาขาเดิม';
    end if;
    v_locked_location_id := v_existing.location_id;
    perform private.lock_report_locations(array[v_locked_location_id, v_requested_target_id]);

    select * into v_existing
    from public.money_transfers transfer
    where transfer.id = v_id
    for update;

    if v_existing.id is null or v_existing.record_status = 'deleted'
      or v_existing.transfer_type <> 'branch' then
      raise exception 'MT_NOT_FOUND: ไม่พบรายการโอนเงิน';
    end if;
    if v_existing.location_id is distinct from v_locked_location_id then
      raise exception 'MT_REVISION_CONFLICT: ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดใหม่';
    end if;
    if v_existing.branch_receipt_contract_version <> 1 then
      raise exception 'MT_LEGACY_BRANCH_READ_ONLY: รายการรุ่นเดิมดูได้อย่างเดียว';
    end if;
    if v_existing.branch_receipt_status <> 'pending_receipt' then
      raise exception 'MT_BRANCH_RECEIVED_IMMUTABLE: รายการที่ยืนยันรับแล้วแก้ไขไม่ได้';
    end if;
    if not private.can_access_location(v_existing.location_id) then
      raise exception 'MT_LOCATION_DENIED: ไม่มีสิทธิ์เข้าถึงสาขาเดิม';
    end if;

    -- The legacy writer owns slip/source validation. Keep its same-location
    -- invariant intact, then move the still-pending branch row atomically.
    v_delegate_payload := jsonb_set(v_delegate_payload, '{locationId}', to_jsonb(v_existing.location_id::text), true);
    v_delegate_payload := jsonb_set(v_delegate_payload, '{targetLocationId}', to_jsonb(v_existing.location_id::text), true);

    update public.money_transfers transfer set
      branch_receipt_contract_version = null,
      branch_receipt_status = null,
      branch_received_by_user_id = null,
      branch_received_by_name = null,
      branch_received_at = null
    where transfer.id = v_existing.id;
  else
    perform private.lock_report_locations(array[v_requested_target_id]);
  end if;

  v_result := public.save_money_transfer_before_branch_receipt(v_delegate_payload);

  if v_operation = 'create' and coalesce((v_result->>'idempotentReplay')::boolean, false) then
    return public.get_money_transfer_detail(v_id)
      || jsonb_build_object('idempotentReplay', true, 'changedSources', '[]'::jsonb);
  end if;

  update public.money_transfers transfer set
    location_id = v_requested_target_id,
    target_location_id = v_requested_target_id,
    target_location_name = v_target_name,
    branch_receipt_contract_version = 1,
    branch_receipt_status = 'pending_receipt',
    branch_received_by_user_id = null,
    branch_received_by_name = null,
    branch_received_at = null,
    accounting_date = null,
    updated_at = statement_timestamp()
  where transfer.id = v_id;

  return public.get_money_transfer_detail(v_id)
    || jsonb_build_object(
      'idempotentReplay', false,
      'changedSources', coalesce(v_result->'changedSources', '[]'::jsonb),
      'virtualStatus', 'branch_pending_receipt'
    );
end;
$$;

revoke all on function public.save_money_transfer(jsonb) from public, anon;
grant execute on function public.save_money_transfer(jsonb) to authenticated;

alter function public.delete_money_transfer(uuid, integer)
  rename to delete_money_transfer_before_branch_receipt;

revoke all on function public.delete_money_transfer_before_branch_receipt(uuid, integer)
  from public, anon, authenticated;

create or replace function public.delete_money_transfer(
  p_transfer_id uuid,
  p_expected_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_transfer public.money_transfers;
  v_locked_location_id uuid;
begin
  if not private.is_active_user() or not private.can_access_money_transfer_module() then
    raise exception 'MONEY_TRANSFER_DELETE_FORBIDDEN';
  end if;
  if p_transfer_id is null or p_expected_revision is null then
    raise exception 'MT_INVALID_PAYLOAD: ข้อมูลลบรายการโอนไม่ครบ';
  end if;

  select transfer.location_id into v_locked_location_id
  from public.money_transfers transfer
  where transfer.id = p_transfer_id;

  if found then
    if not private.can_access_location(v_locked_location_id) then
      raise exception 'MONEY_TRANSFER_DELETE_FORBIDDEN';
    end if;
    perform private.lock_report_locations(array[v_locked_location_id]);

    select * into v_transfer
    from public.money_transfers transfer
    where transfer.id = p_transfer_id
    for update;

    if v_transfer.location_id is distinct from v_locked_location_id then
      raise exception 'MT_REVISION_CONFLICT: ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดใหม่';
    end if;

    if v_transfer.id is not null
      and v_transfer.record_status <> 'deleted'
      and v_transfer.transfer_type = 'branch'
      and v_transfer.branch_receipt_contract_version = 1
      and v_transfer.branch_receipt_status = 'pending_receipt'
      and v_transfer.created_by_user_id is distinct from auth.uid() then
      raise exception 'MT_DELETE_CREATOR_ONLY: เฉพาะผู้สร้างรายการเท่านั้นที่ลบได้';
    end if;

    if v_transfer.id is not null
      and v_transfer.record_status <> 'deleted'
      and v_transfer.transfer_type = 'branch'
      and not (
        v_transfer.branch_receipt_contract_version = 1
        and v_transfer.branch_receipt_status = 'pending_receipt'
      ) then
      raise exception 'MT_BRANCH_DELETE_REQUEST_REQUIRED: รายการที่รับเงินแล้วต้องส่งคำขอลบให้ผู้จัดการระบบ';
    end if;
  end if;

  return public.delete_money_transfer_before_branch_receipt(p_transfer_id, p_expected_revision);
end;
$$;

revoke all on function public.delete_money_transfer(uuid, integer) from public, anon;
grant execute on function public.delete_money_transfer(uuid, integer) to authenticated;

create or replace function public.get_money_transfer_list(
  p_location_id uuid,
  p_status text default 'all',
  p_search text default '',
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_page_size integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_search text := lower(trim(coalesce(p_search, '')));
begin
  if not private.is_active_user() or not private.can_access_money_transfer_module() then
    raise exception 'Money transfer module access denied';
  end if;
  if not private.can_access_location(p_location_id) then
    raise exception 'Location access denied';
  end if;
  if p_page_size < 1 or p_page_size > 100 then raise exception 'Invalid page size'; end if;
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then raise exception 'Invalid transfer cursor'; end if;
  if p_status not in (
    'all', 'pending', 'partial', 'advance_payment', 'paid', 'overpaid',
    'branch_and_transfer', 'cancelled', 'branch_pending_receipt', 'branch_received'
  ) then raise exception 'Invalid transfer status'; end if;

  with base as (
    select t.*, e.export_no as rubber_export_no,
      public.report_lock_no(t) report_lock_no,
      coalesce((select sum(s.amount) from public.money_transfer_slips s where s.transfer_id = t.id), 0) paid_amount,
      coalesce((select count(*) from public.money_transfer_slips s where s.transfer_id = t.id), 0) slip_count,
      coalesce((select count(*) from public.money_transfer_items i where i.transfer_id = t.id), 0) source_count,
      case
        when t.transfer_type = 'branch'
          and t.branch_receipt_contract_version = 1
          and t.branch_receipt_status = 'pending_receipt'
          then 'branch_pending_receipt'
        when t.transfer_type = 'branch' then 'branch_received'
        else t.transfer_status
      end as virtual_status
    from public.money_transfers t
    left join public.rubber_exports e on e.id = t.rubber_export_id
    where t.location_id = p_location_id
      and t.record_status <> 'deleted'
      and t.transfer_type <> 'cash'
  ), candidates as (
    select * from base t
    where (p_status = 'all' or t.virtual_status = p_status)
      and (v_search = '' or position(v_search in lower(concat_ws(' ',
        t.customer_name, t.account_number, t.account_name, t.bank_name,
        t.transport_staff_name, t.target_location_name, t.rubber_export_no,
        t.time_payroll_employee_name, t.time_payroll_source_label, t.id::text
      ))) > 0)
      and (p_cursor_created_at is null or (t.created_at, t.id) < (p_cursor_created_at, p_cursor_id))
    order by t.created_at desc, t.id desc
    limit p_page_size + 1
  ), visible as (
    select * from candidates order by created_at desc, id desc limit p_page_size
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(v) order by v.created_at desc, v.id desc) from visible v), '[]'::jsonb),
    'statusCounts', (select jsonb_build_object(
      'all', count(*),
      'pending', count(*) filter (where t.virtual_status = 'pending'),
      'partial', count(*) filter (where t.virtual_status = 'partial'),
      'advance_payment', count(*) filter (where t.virtual_status = 'advance_payment'),
      'paid', count(*) filter (where t.virtual_status = 'paid'),
      'overpaid', count(*) filter (where t.virtual_status = 'overpaid'),
      'branch_and_transfer', count(*) filter (where t.virtual_status = 'branch_and_transfer'),
      'cancelled', count(*) filter (where t.virtual_status = 'cancelled'),
      'branch_pending_receipt', count(*) filter (where t.virtual_status = 'branch_pending_receipt'),
      'branch_received', count(*) filter (where t.virtual_status = 'branch_received')
    ) from base t),
    'hasMore', (select count(*) > p_page_size from candidates),
    'nextCreatedAt', (select v.created_at from visible v order by v.created_at, v.id limit 1),
    'nextId', (select v.id from visible v order by v.created_at, v.id limit 1)
  ) into v_result;
  return v_result;
end;
$$;

-- All money projections use the same predicate. Patch only the established
-- financial read models; the transfer management list intentionally keeps pending rows.
do $migration$
declare
  v_target regprocedure;
  v_definition text;
  v_patched text;
begin
  foreach v_target in array array[
    'private.calculate_dashboard_summary(uuid)'::regprocedure,
    'private.dashboard_money_source_entries_before_time_payroll_payment(text,uuid)'::regprocedure,
    'public.get_dashboard_overview(uuid,timestamptz,text,integer)'::regprocedure,
    'private.report_income_expense_period_rows_before_withdrawal_adjustments(uuid)'::regprocedure,
    'private.reportable_items_before_time_payroll_payment(uuid,timestamptz)'::regprocedure,
    'public.get_income_expense_feed_before_withdrawal_adjustments(uuid,date,date,date,text,integer)'::regprocedure,
    'public.get_income_expense_operational_feed_20260907010000_base(uuid,text,text,text)'::regprocedure,
    'public.get_income_expense_operational_feed_on_demand(uuid,text,text,text)'::regprocedure
  ] loop
    v_definition := pg_get_functiondef(v_target);
    v_patched := replace(
      replace(
        v_definition,
        'mt.transfer_type = ''branch''',
        '(mt.transfer_type = ''branch'' and private.money_transfer_is_financially_effective(mt))'
      ),
      'm.transfer_type = ''branch''',
      '(m.transfer_type = ''branch'' and private.money_transfer_is_financially_effective(m))'
    );
    if v_patched = v_definition then
      raise exception 'BRANCH_RECEIPT_PROJECTION_PATCH_BLOCKED: %', v_target::text;
    end if;
    execute v_patched;
  end loop;
end
$migration$;

create or replace function private.report_creation_blockers(
  p_location_id uuid,
  p_cutoff_at timestamptz
)
returns table(blocker_key text, item_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with blocker_rows as (
    select 'rubber_bill_pending'::text as blocker_key, blocker_id
    from private.rubber_bill_report_blockers(p_location_id, p_cutoff_at)
    union all
    select 'income_expense_approval_pending', request.id
    from public.income_expense_approval_requests request
    where request.location_id = p_location_id
      and request.request_status = 'pending'
      and request.created_at <= p_cutoff_at
    union all
    select 'cash_transfer_delete_pending', request.id
    from public.cash_transfer_delete_requests request
    where request.request_status = 'pending'
      and request.created_at <= p_cutoff_at
      and p_location_id in (request.source_location_id, request.target_location_id)
    union all
    select 'stock_entry_delete_pending', request.id
    from public.stock_entry_approval_requests request
    where request.request_status = 'pending'
      and request.created_at <= p_cutoff_at
      and p_location_id in (request.location_id, request.target_location_id)
    union all
    select 'branch_transfer_receipt_pending', transfer.id
    from public.money_transfers transfer
    where transfer.target_location_id = p_location_id
      and transfer.transfer_type = 'branch'
      and transfer.record_status <> 'deleted'
      and transfer.branch_receipt_contract_version = 1
      and transfer.branch_receipt_status = 'pending_receipt'
      and transfer.created_at <= p_cutoff_at
    union all
    select 'branch_transfer_delete_pending', request.id
    from public.branch_transfer_delete_requests request
    where request.location_id = p_location_id
      and request.request_status = 'pending'
      and request.created_at <= p_cutoff_at
  )
  select blocker_rows.blocker_key, count(distinct blocker_rows.blocker_id)::bigint
  from blocker_rows
  group by blocker_rows.blocker_key
  order by case blocker_rows.blocker_key
    when 'rubber_bill_pending' then 1
    when 'income_expense_approval_pending' then 2
    when 'cash_transfer_delete_pending' then 3
    when 'stock_entry_delete_pending' then 4
    when 'branch_transfer_receipt_pending' then 5
    when 'branch_transfer_delete_pending' then 6
  end;
$$;

alter function public.get_actionable_badge_counts()
  rename to get_actionable_badge_counts_before_branch_receipt;

create or replace function public.get_actionable_badge_counts()
returns table(location_id uuid, module_id text, item_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  with combined as (
    select * from public.get_actionable_badge_counts_before_branch_receipt()
    union all
    select transfer.target_location_id, 'cash'::text, count(*)::bigint
    from public.money_transfers transfer
    where transfer.transfer_type = 'branch'
      and transfer.record_status <> 'deleted'
      and transfer.branch_receipt_contract_version = 1
      and transfer.branch_receipt_status = 'pending_receipt'
      and private.can_access_location(transfer.target_location_id)
    group by transfer.target_location_id
  )
  select combined.location_id, combined.module_id, sum(combined.item_count)::bigint
  from combined
  group by combined.location_id, combined.module_id
  order by combined.location_id, combined.module_id
$$;

revoke all on function public.get_actionable_badge_counts_before_branch_receipt()
  from public, anon, authenticated;
revoke all on function public.get_actionable_badge_counts() from public, anon;
grant execute on function public.get_actionable_badge_counts() to authenticated;

insert into public.telegram_badge_catalog (badge_key, module_name, status_label, sort_order)
values ('branch_transfer_pending_receipt', 'โอนเงินให้สาขา', 'รอยืนยันรับ', 35)
on conflict (badge_key) do update set
  module_name = excluded.module_name,
  status_label = excluded.status_label;

alter table public.telegram_badge_settings
  alter column enabled_badge_keys set default array[
    'rubber_bill_approval_pending',
    'income_expense_approval_pending',
    'cash_transfer_pending_receipt',
    'branch_transfer_pending_receipt',
    'stock_approval_pending',
    'money_transfer_pending',
    'money_transfer_partial',
    'money_transfer_advance',
    'time_tracking_approval_pending',
    'rubber_export_draft'
  ]::text[];

update public.telegram_badge_settings setting
set enabled_badge_keys = array_append(setting.enabled_badge_keys, 'branch_transfer_pending_receipt'),
    updated_at = statement_timestamp()
where setting.id = true
  and 'cash_transfer_pending_receipt' = any(setting.enabled_badge_keys)
  and not ('branch_transfer_pending_receipt' = any(setting.enabled_badge_keys));

alter function public.get_telegram_badge_counts()
  rename to get_telegram_badge_counts_before_branch_receipt;

create or replace function public.get_telegram_badge_counts()
returns table (
  badge_key text,
  location_id uuid,
  branch_name text,
  module_name text,
  status_label text,
  item_count bigint,
  sort_order integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with combined as (
    select * from public.get_telegram_badge_counts_before_branch_receipt()
    union all
    select
      catalog.badge_key,
      transfer.target_location_id,
      coalesce(location.name, 'ส่วนกลาง'),
      catalog.module_name,
      catalog.status_label,
      count(*)::bigint,
      catalog.sort_order
    from public.money_transfers transfer
    join public.telegram_badge_settings setting
      on setting.id = true
     and 'branch_transfer_pending_receipt' = any(setting.enabled_badge_keys)
    join public.telegram_badge_catalog catalog
      on catalog.badge_key = 'branch_transfer_pending_receipt'
    left join public.locations location on location.id = transfer.target_location_id
    where transfer.transfer_type = 'branch'
      and transfer.record_status <> 'deleted'
      and transfer.branch_receipt_contract_version = 1
      and transfer.branch_receipt_status = 'pending_receipt'
    group by catalog.badge_key, transfer.target_location_id, location.name,
      catalog.module_name, catalog.status_label, catalog.sort_order
  )
  select combined.badge_key, combined.location_id, combined.branch_name,
    combined.module_name, combined.status_label,
    sum(combined.item_count)::bigint, combined.sort_order
  from combined
  group by combined.badge_key, combined.location_id, combined.branch_name,
    combined.module_name, combined.status_label, combined.sort_order
  order by case when combined.branch_name = 'ส่วนกลาง' then 1 else 0 end,
    combined.branch_name, combined.sort_order
$$;

revoke all on function public.get_telegram_badge_counts_before_branch_receipt()
  from public, anon, authenticated;
revoke all on function public.get_telegram_badge_counts()
  from public, anon, authenticated;
grant execute on function public.get_telegram_badge_counts() to service_role;

create index if not exists branch_transfer_delete_retention_idx
  on public.branch_transfer_delete_requests ((coalesce(decided_at, updated_at)), id)
  where request_status <> 'pending';

do $migration$
declare
  v_definition text;
  v_anchor text;
  v_replacement text;
begin
  v_definition := pg_get_functiondef('private.history_retention_preview_rows(integer)'::regprocedure);
  v_anchor := $old$select 'cash_transfer_delete_requests', (coalesce(decided_at, updated_at) at time zone 'Asia/Bangkok')::date
    from public.cash_transfer_delete_requests, bounds
    where request_status <> 'pending'
      and coalesce(decided_at, updated_at) < cutoff_at$old$;
  v_replacement := v_anchor || $new$
    union all
    select 'branch_transfer_delete_requests', (coalesce(decided_at, updated_at) at time zone 'Asia/Bangkok')::date
    from public.branch_transfer_delete_requests, bounds
    where request_status <> 'pending'
      and coalesce(decided_at, updated_at) < cutoff_at$new$;
  if strpos(v_definition, v_anchor) = 0 then raise exception 'BRANCH_RETENTION_PREVIEW_PATCH_BLOCKED'; end if;
  v_definition := replace(v_definition, v_anchor, v_replacement);
  v_definition := replace(
    v_definition,
    '(''cash_transfer_delete_requests''), (''rubber_bill_approval_requests'')',
    '(''cash_transfer_delete_requests''), (''branch_transfer_delete_requests''), (''rubber_bill_approval_requests'')'
  );
  execute v_definition;

  v_definition := pg_get_functiondef('private.history_retention_has_work(integer)'::regprocedure);
  v_anchor := $old$exists (select 1 from public.cash_transfer_delete_requests, bounds where request_status <> 'pending' and coalesce(decided_at, updated_at) < cutoff_at)$old$;
  v_replacement := v_anchor || $new$
    or
    exists (select 1 from public.branch_transfer_delete_requests, bounds where request_status <> 'pending' and coalesce(decided_at, updated_at) < cutoff_at)$new$;
  if strpos(v_definition, v_anchor) = 0 then raise exception 'BRANCH_RETENTION_WORK_PATCH_BLOCKED'; end if;
  execute replace(v_definition, v_anchor, v_replacement);

  v_definition := pg_get_functiondef('private.cleanup_history_retention(integer)'::regprocedure);
  v_anchor := $old$with doomed as (
      select id from public.cash_transfer_delete_requests where request_status <> 'pending'
        and coalesce(decided_at, updated_at) < v_cutoff_at
      order by coalesce(decided_at, updated_at), id limit p_batch_size for update skip locked
    )
    delete from public.cash_transfer_delete_requests t using doomed d where t.id = d.id;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('cash_transfer_delete_requests', v_count);$old$;
  v_replacement := v_anchor || $new$

    with doomed as (
      select id from public.branch_transfer_delete_requests where request_status <> 'pending'
        and coalesce(decided_at, updated_at) < v_cutoff_at
      order by coalesce(decided_at, updated_at), id limit p_batch_size for update skip locked
    )
    delete from public.branch_transfer_delete_requests t using doomed d where t.id = d.id;
    get diagnostics v_count = row_count;
    v_counts := v_counts || jsonb_build_object('branch_transfer_delete_requests', v_count);$new$;
  if strpos(v_definition, v_anchor) = 0 then raise exception 'BRANCH_RETENTION_CLEANUP_PATCH_BLOCKED'; end if;
  execute replace(v_definition, v_anchor, v_replacement);
end
$migration$;

notify pgrst, 'reload schema';
