-- Build one cached Dashboard card snapshot per worker run.
-- Claim and rebuild are separate cron jobs so the committed "running" state is
-- visible to the UI while calculation is in progress.

create or replace function private.calculate_dashboard_summary(p_location_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select
      (current_timestamp at time zone 'Asia/Bangkok')::date as today,
      (current_timestamp at time zone 'Asia/Bangkok')::date - 6 as from_date
  ),
  active_bills as (
    select b.*
    from public.rubber_bills b
    where b.location_id = p_location_id
      and b.record_status = 'active'
  ),
  payable_bills as (
    select b.*
    from active_bills b
    where private.rubber_bill_is_payable(b.id)
  ),
  purchase_stats as (
    select
      count(*) filter (where b.bill_date = d.today) as today_bill_count,
      coalesce(sum(b.net_weight) filter (where b.bill_date = d.today), 0) as today_net_weight,
      coalesce(sum(b.net_total) filter (
        where b.bill_date = d.today
          and private.rubber_bill_is_payable(b.id)
      ), 0) as today_paid_total,
      coalesce(sum(b.net_weight) filter (
        where b.bill_date between d.from_date and d.today
          and private.rubber_bill_is_payable(b.id)
      ), 0) as seven_day_net_weight,
      coalesce(sum(b.net_total) filter (
        where b.bill_date between d.from_date and d.today
          and private.rubber_bill_is_payable(b.id)
      ), 0) as seven_day_paid_total,
      coalesce(sum(b.net_weight), 0) as accumulated_net_weight
    from active_bills b
    cross join bounds d
  ),
  payable_total as (
    select coalesce(sum(b.net_total), 0) as accumulated_purchase
    from payable_bills b
  ),
  export_stats as (
    select
      coalesce(sum(e.original_weight_total) filter (where e.status = 'verified'), 0)
        as accumulated_original_weight,
      count(*) filter (
        where e.status = 'verified'
          and (e.verified_at at time zone 'Asia/Bangkok')::date
            between d.from_date and d.today
      ) as seven_day_export_count,
      coalesce(sum(e.original_weight_total - e.current_weight) filter (
        where e.status = 'verified'
          and (e.verified_at at time zone 'Asia/Bangkok')::date
            between d.from_date and d.today
      ), 0) as seven_day_loss_weight,
      coalesce(sum(e.original_weight_total) filter (
        where e.status = 'verified'
          and (e.verified_at at time zone 'Asia/Bangkok')::date
            between d.from_date and d.today
      ), 0) as seven_day_original_weight
    from public.rubber_exports e
    cross join bounds d
    where e.location_id = p_location_id
  ),
  stock_balances as (
    select
      p.id,
      p.name,
      p.unit,
      round(coalesce(sum(m.quantity_delta), 0), 2) as balance
    from public.stock_products p
    left join public.stock_movements m
      on m.product_id = p.id
     and m.location_id = p_location_id
    where p.is_active = true
    group by p.id, p.name, p.unit
  ),
  stock_summary as (
    select
      count(*) filter (where balance > 0) as in_stock_count,
      count(*) filter (where balance <= 0) as out_of_stock_count,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'productId', id,
            'name', name,
            'unit', unit,
            'balance', balance
          )
          order by (balance <= 0) desc, name, id
        ),
        '[]'::jsonb
      ) as items
    from stock_balances
  ),
  financial_amounts as (
    select
      ie.type::text as direction,
      ie.cost as amount,
      true as affects_balance,
      ie.type = 'expense' as operating_expense
    from public.income_expense ie
    where ie.location_id = p_location_id
      and ie.record_status = 'active'
      and ie.cost > 0

    union all

    select 'income', mt.net_amount_to_pay, true, false
    from public.money_transfers mt
    where mt.transfer_type = 'branch'
      and coalesce(mt.transfer_method, 'bank') <> 'cash'
      and mt.target_location_id = p_location_id
      and mt.record_status <> 'deleted'
      and mt.transfer_status in ('paid', 'overpaid', 'branch_and_transfer')
      and mt.net_amount_to_pay > 0

    union all

    select 'expense', mt.net_amount_to_pay, true, false
    from public.money_transfers mt
    where mt.transfer_type = 'branch'
      and coalesce(mt.transfer_method, 'bank') <> 'cash'
      and mt.location_id = p_location_id
      and mt.target_location_id <> mt.location_id
      and mt.record_status <> 'deleted'
      and mt.transfer_status in ('paid', 'overpaid', 'branch_and_transfer')
      and mt.net_amount_to_pay > 0

    union all

    select 'expense', mt.branch_paid_amount, true, false
    from public.money_transfers mt
    where mt.transfer_type = 'customer'
      and mt.transfer_status = 'branch_and_transfer'
      and mt.location_id = p_location_id
      and mt.record_status <> 'deleted'
      and mt.branch_paid_amount > 0

    union all

    select 'expense', d.sent_total, true, false
    from public.money_transfers mt
    join public.money_transfer_cash_details d on d.transfer_id = mt.id
    where mt.transfer_type = 'cash'
      and mt.transfer_method = 'cash'
      and mt.location_id = p_location_id
      and mt.record_status <> 'deleted'
      and d.sent_total > 0

    union all

    select 'income', d.received_total, true, false
    from public.money_transfers mt
    join public.money_transfer_cash_details d on d.transfer_id = mt.id
    where mt.transfer_type = 'cash'
      and mt.transfer_method = 'cash'
      and mt.target_location_id = p_location_id
      and mt.record_status <> 'deleted'
      and d.cash_status in ('received', 'mismatched', 'difference_accepted')
      and d.received_total > 0

    union all

    select 'expense', ft.amount, true, true
    from public.financial_transactions ft
    where ft.type = 'WITHDRAWAL'
      and ft.status = 'APPROVED'
      and ft.cancelled_at is null
      and ft.expense_location_id = p_location_id
      and ft.amount > 0

    union all

    select 'expense', ps.net_pay, true, true
    from public.payroll_slips ps
    where ps.status = 'APPROVED'
      and ps.cancelled_at is null
      and ps.expense_location_id = p_location_id
      and ps.net_pay > 0

    union all

    select
      'expense',
      b.net_total,
      not exists (
        select 1
        from public.money_transfer_items i
        where i.source_type = 'rubber_bill'
          and i.source_id = b.id
      ),
      false
    from payable_bills b

    union all

    select
      'expense',
      ot.total_amount,
      not exists (
        select 1
        from public.money_transfer_items i
        where i.source_type = 'ocr_ticket'
          and i.source_id = ot.id
      ),
      false
    from public.ocr_tickets ot
    where ot.location_id = p_location_id
      and ot.record_status = 'active'
      and ot.total_amount > 0

    union all

    select 'expense', e.work_total, true, true
    from public.rubber_exports e
    where e.location_id = p_location_id
      and e.status = 'verified'
      and e.expense_destination = 'branch'
      and e.work_total > 0
  ),
  financial_totals as (
    select
      coalesce(sum(
        case
          when not affects_balance then 0
          when direction = 'income' then amount
          else -amount
        end
      ), 0) as net_cash_flow,
      coalesce(sum(amount) filter (where operating_expense), 0)
        as operating_expense
    from financial_amounts
  )
  select jsonb_build_object(
    'purchaseToday', jsonb_build_object(
      'billCount', ps.today_bill_count,
      'netWeight', round(ps.today_net_weight, 2),
      'paidTotal', round(ps.today_paid_total, 2)
    ),
    'purchase7Days', jsonb_build_object(
      'paidTotal', round(ps.seven_day_paid_total, 2),
      'dailyAverage', round(ps.seven_day_paid_total / 7, 2),
      'netWeight', round(ps.seven_day_net_weight, 2),
      'averageCostPerKg', case
        when ps.seven_day_net_weight > 0
          then round(ps.seven_day_paid_total / ps.seven_day_net_weight, 2)
        else null
      end
    ),
    'netCashFlow', round(ft.net_cash_flow, 2),
    'operatingExpenseAccumulated', round(ft.operating_expense, 2),
    'payablePurchaseAccumulated', round(pt.accumulated_purchase, 2),
    'operatingBurdenPercent', case
      when pt.accumulated_purchase > 0
        then round(ft.operating_expense / pt.accumulated_purchase * 100, 2)
      else null
    end,
    'rubberInventoryWeight', round(
      ps.accumulated_net_weight - es.accumulated_original_weight,
      2
    ),
    'waterLoss7Days', jsonb_build_object(
      'exportCount', es.seven_day_export_count,
      'weight', round(es.seven_day_loss_weight, 2),
      'percent', case
        when es.seven_day_original_weight > 0
          then round(es.seven_day_loss_weight / es.seven_day_original_weight * 100, 2)
        else null
      end
    ),
    'stock', jsonb_build_object(
      'inStockCount', ss.in_stock_count,
      'outOfStockCount', ss.out_of_stock_count,
      'items', ss.items
    )
  )
  from purchase_stats ps
  cross join payable_total pt
  cross join export_stats es
  cross join stock_summary ss
  cross join financial_totals ft
$$;

revoke all on function private.calculate_dashboard_summary(uuid)
  from public, anon, authenticated;

create or replace function private.dashboard_rollover_if_needed()
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  today date := (current_timestamp at time zone 'Asia/Bangkok')::date;
  changed boolean := false;
  next_version bigint := pg_catalog.txid_current();
begin
  update public.dashboard_refresh_settings
  set last_rollover_date = today,
      updated_at = now()
  where id = true
    and last_rollover_date < today
  returning true into changed;

  if not coalesce(changed, false) then
    return false;
  end if;

  insert into public.dashboard_branch_snapshots (
    location_id,
    status,
    source_version
  )
  select l.id, 'dirty', next_version
  from public.locations l
  where l.is_active = true
  on conflict (location_id) do update
  set status = case
        when dashboard_branch_snapshots.status in ('queued', 'running')
          then dashboard_branch_snapshots.status
        else 'dirty'
      end,
      source_version = greatest(
        dashboard_branch_snapshots.source_version + 1,
        excluded.source_version
      ),
      updated_at = now();

  return true;
end;
$$;

revoke all on function private.dashboard_rollover_if_needed()
  from public, anon, authenticated;

create or replace function private.claim_dashboard_branch()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  branch_id uuid;
  refresh_minutes integer;
begin
  perform private.dashboard_rollover_if_needed();

  update public.dashboard_branch_snapshots
  set status = 'failed',
      claimed_version = null,
      claimed_at = null,
      last_error = 'งานคำนวณก่อนหน้าไม่สิ้นสุด',
      updated_at = now()
  where status = 'running'
    and claimed_at < now() - interval '15 minutes';

  select s.interval_minutes
  into refresh_minutes
  from public.dashboard_refresh_settings s
  where s.id = true;

  select snapshot.location_id
  into branch_id
  from public.dashboard_branch_snapshots snapshot
  join public.locations l
    on l.id = snapshot.location_id
   and l.is_active = true
  where snapshot.status = 'queued'
     or (
       snapshot.status = 'dirty'
       and (
         snapshot.summary is null
         or snapshot.updated_at <= now() - make_interval(mins => refresh_minutes)
       )
     )
     or (
       snapshot.status = 'failed'
       and snapshot.updated_at <= now() - make_interval(mins => refresh_minutes)
     )
  order by
    (snapshot.status = 'queued') desc,
    (snapshot.summary is null) desc,
    snapshot.updated_at,
    snapshot.location_id
  for update of snapshot skip locked
  limit 1;

  if branch_id is null then
    return null;
  end if;

  update public.dashboard_branch_snapshots
  set status = 'running',
      claimed_version = source_version,
      claimed_at = now(),
      last_error = null,
      updated_at = now()
  where location_id = branch_id;

  return branch_id;
end;
$$;

revoke all on function private.claim_dashboard_branch()
  from public, anon, authenticated;

create or replace function private.rebuild_dashboard_branch()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  branch_id uuid;
  claim_version bigint;
  next_summary jsonb;
begin
  select snapshot.location_id, snapshot.claimed_version
  into branch_id, claim_version
  from public.dashboard_branch_snapshots snapshot
  join public.locations l
    on l.id = snapshot.location_id
   and l.is_active = true
  where snapshot.status = 'running'
  order by snapshot.claimed_at, snapshot.location_id
  for update of snapshot skip locked
  limit 1;

  if branch_id is null then
    return null;
  end if;

  begin
    next_summary := private.calculate_dashboard_summary(branch_id);

    update public.dashboard_branch_snapshots
    set summary = next_summary,
        calculated_at = now(),
        snapshot_version = claim_version,
        status = case
          when source_version = claim_version then 'ready'
          else 'dirty'
        end,
        claimed_version = null,
        claimed_at = null,
        manual_requested_at = null,
        last_error = null,
        updated_at = now()
    where location_id = branch_id;
  exception when others then
    update public.dashboard_branch_snapshots
    set status = 'failed',
        claimed_version = null,
        claimed_at = null,
        last_error = 'คำนวณ Dashboard ไม่สำเร็จ',
        updated_at = now()
    where location_id = branch_id;
  end;

  return branch_id;
end;
$$;

revoke all on function private.rebuild_dashboard_branch()
  from public, anon, authenticated;

do $$
declare
  existing_job bigint;
begin
  for existing_job in
    select jobid
    from cron.job
    where jobname in ('dashboard-read-model-claim', 'dashboard-read-model-rebuild')
  loop
    perform cron.unschedule(existing_job);
  end loop;

  perform cron.schedule(
    'dashboard-read-model-claim',
    '* * * * *',
    'select private.claim_dashboard_branch()'
  );

  perform cron.schedule(
    'dashboard-read-model-rebuild',
    '* * * * *',
    'select private.rebuild_dashboard_branch()'
  );
end;
$$;
