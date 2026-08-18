-- Split Rubber Bill pricing work from Rubber Evidence review work.
create or replace function public.get_actionable_badge_counts()
returns table(location_id uuid, module_id text, item_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_role text;
  v_can_manage_system boolean;
  v_can_use_money_transfer boolean;
  v_can_manage_time_payroll boolean;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select
    p.role,
    p.role = 'super_admin' or p.can_access_super_admin_features = true,
    p.role = 'super_admin' or p.can_access_super_admin_features = true or p.can_access_money_transfer = true,
    p.role = 'super_admin' or p.can_access_super_admin_features = true or p.can_manage_time_payroll = true
  into v_role, v_can_manage_system, v_can_use_money_transfer, v_can_manage_time_payroll
  from public.profiles p
  where p.id = v_user_id and p.is_active = true;
  if v_role is null then raise exception 'Inactive profile'; end if;

  return query
  with accessible_locations as (
    select ul.location_id
    from public.user_locations ul
    join public.locations l on l.id = ul.location_id and l.is_active = true
    where ul.user_id = v_user_id
  ),
  scoped_time_requests as (
    select ft.id, ft.profile_id from public.financial_transactions ft where ft.status = 'PENDING'
    union all
    select ps.id, ps.profile_id from public.payroll_slips ps where ps.status = 'PENDING'
  ),
  counts as (
    select al.location_id, 'rubber'::text module_id, count(distinct b.blocker_id)::bigint item_count
    from accessible_locations al
    cross join lateral private.rubber_bill_report_blockers(al.location_id, now()) b
    where b.blocker_type = 'zero_price'
    group by al.location_id

    union all
    select al.location_id, 'rubber-evidence'::text, count(distinct s.bill_id)::bigint
    from accessible_locations al
    cross join lateral private.rubber_bill_evidence_review_states(al.location_id) s
    where s.review_status = 'pending'
    group by al.location_id

    union all
    select al.location_id, 'rubber', count(*)::bigint
    from accessible_locations al
    cross join lateral private.rubber_bill_report_blockers(al.location_id, now()) b
    where v_can_manage_system and b.blocker_type <> 'zero_price'
    group by al.location_id

    union all
    select t.target_location_id, 'cash', count(*)::bigint
    from public.money_transfer_cash_details d
    join public.money_transfers t on t.id = d.transfer_id
    join accessible_locations al on al.location_id = t.target_location_id
    where d.cash_status = 'pending_receipt' and t.record_status <> 'deleted'
    group by t.target_location_id

    union all
    select r.location_id, 'cash', count(*)::bigint
    from public.income_expense_approval_requests r
    join accessible_locations al on al.location_id = r.location_id
    where v_can_manage_system and r.request_status = 'pending'
    group by r.location_id

    union all
    select r.source_location_id, 'cash', count(*)::bigint
    from public.cash_transfer_delete_requests r
    join accessible_locations al on al.location_id = r.source_location_id
    where v_can_manage_system and r.request_status = 'pending'
    group by r.source_location_id

    union all
    select t.location_id, 'money-transfer', count(*)::bigint
    from public.money_transfers t
    join accessible_locations al on al.location_id = t.location_id
    where v_can_use_money_transfer
      and t.transfer_method = 'bank'
      and t.transfer_status in ('pending', 'partial', 'advance_payment')
      and t.record_status <> 'deleted'
    group by t.location_id

    union all
    select r.location_id, 'acid-stock', count(*)::bigint
    from public.stock_entry_approval_requests r
    join accessible_locations al on al.location_id = r.location_id
    where v_can_manage_system and r.request_status = 'pending'
    group by r.location_id

    union all
    select al.location_id, 'acid-stock', count(r.id)::bigint
    from accessible_locations al cross join public.stock_product_approval_requests r
    where v_can_manage_system and r.request_status = 'pending'
    group by al.location_id

    union all
    select al.location_id, 'time-tracking', count(requests.id)::bigint
    from accessible_locations al cross join scoped_time_requests requests
    where v_can_manage_system
    group by al.location_id

    union all
    select target_primary.location_id, 'time-tracking', count(requests.id)::bigint
    from scoped_time_requests requests
    join public.user_locations target_primary
      on target_primary.user_id = requests.profile_id and target_primary.is_primary = true
    join accessible_locations al on al.location_id = target_primary.location_id
    where not v_can_manage_system
      and v_can_manage_time_payroll
      and private.can_manage_time_payroll_profile(requests.profile_id)
    group by target_primary.location_id

    union all
    select e.location_id, 'rubber-export', count(*)::bigint
    from public.rubber_exports e
    join accessible_locations al on al.location_id = e.location_id
    where (v_can_manage_system or v_role = 'admin') and e.status = 'draft'
    group by e.location_id
  )
  select c.location_id, c.module_id, sum(c.item_count)::bigint
  from counts c
  where c.item_count > 0
  group by c.location_id, c.module_id
  order by c.location_id, c.module_id;
end;
$$;

revoke all on function public.get_actionable_badge_counts() from public, anon;
grant execute on function public.get_actionable_badge_counts() to authenticated;

notify pgrst, 'reload schema';
