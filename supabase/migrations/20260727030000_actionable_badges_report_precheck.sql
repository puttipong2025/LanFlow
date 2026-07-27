create or replace function private.rubber_bill_report_blockers(
  p_location_id uuid,
  p_cutoff_at timestamptz
)
returns table (
  blocker_type text,
  blocker_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select 'zero_price'::text, b.id
  from public.rubber_bills b
  where b.location_id = p_location_id
    and b.record_status = 'active'
    and b.created_at <= p_cutoff_at
    and not private.rubber_bill_has_pending_approval(b.id)
    and exists (
      select 1
      from public.rubber_bill_items i
      where i.bill_id = b.id
        and i.item_type = 'weigh'
        and coalesce(i.price, 0) <= 0
    )

  union all

  select
    case when r.operation = 'create' then 'pending_create' else 'pending_change' end,
    r.id
  from public.rubber_bill_approval_requests r
  where r.location_id = p_location_id
    and r.request_status = 'pending'
    and r.requested_at <= p_cutoff_at
$$;

revoke all on function private.rubber_bill_report_blockers(uuid, timestamptz)
  from public, anon, authenticated;

create or replace function public.get_actionable_badge_counts()
returns table (
  location_id uuid,
  module_id text,
  item_count bigint
)
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
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select
    p.role,
    p.role = 'super_admin' or p.can_access_super_admin_features = true,
    p.role = 'super_admin'
      or p.can_access_super_admin_features = true
      or p.can_access_money_transfer = true
  into v_role, v_can_manage_system, v_can_use_money_transfer
  from public.profiles p
  where p.id = v_user_id
    and p.is_active = true;

  if v_role is null then
    raise exception 'Inactive profile';
  end if;

  return query
  with accessible_locations as (
    select ul.location_id
    from public.user_locations ul
    join public.locations l on l.id = ul.location_id and l.is_active = true
    where ul.user_id = v_user_id
  ),
  counts as (
    select
      al.location_id,
      'rubber'::text module_id,
      count(*)::bigint item_count
    from accessible_locations al
    cross join lateral private.rubber_bill_report_blockers(al.location_id, now()) b
    where v_can_manage_system or b.blocker_type = 'zero_price'
    group by al.location_id

    union all

    select
      t.target_location_id,
      'cash',
      count(*)::bigint
    from public.money_transfer_cash_details d
    join public.money_transfers t on t.id = d.transfer_id
    join accessible_locations al on al.location_id = t.target_location_id
    where d.cash_status = 'pending_receipt'
      and t.record_status <> 'deleted'
    group by t.target_location_id

    union all

    select r.location_id, 'cash', count(*)::bigint
    from public.income_expense_approval_requests r
    join accessible_locations al on al.location_id = r.location_id
    where v_can_manage_system
      and r.request_status = 'pending'
    group by r.location_id

    union all

    select r.source_location_id, 'cash', count(*)::bigint
    from public.cash_transfer_delete_requests r
    join accessible_locations al on al.location_id = r.source_location_id
    where v_can_manage_system
      and r.request_status = 'pending'
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
    where v_can_manage_system
      and r.request_status = 'pending'
    group by r.location_id

    union all

    select al.location_id, 'acid-stock', count(r.id)::bigint
    from accessible_locations al
    cross join public.stock_product_approval_requests r
    where v_can_manage_system
      and r.request_status = 'pending'
    group by al.location_id

    union all

    select al.location_id, 'time-tracking', count(requests.id)::bigint
    from accessible_locations al
    cross join (
      select ft.id
      from public.financial_transactions ft
      join public.profiles p on p.id = ft.profile_id
      where ft.status = 'PENDING'
        and (
          v_role = 'super_admin'
          or (
            v_role = 'admin'
            and ft.type = 'WITHDRAWAL'
            and p.role = 'user'
            and p.is_active
          )
        )
      union all
      select lr.id
      from public.leave_requests lr
      join public.profiles p on p.id = lr.profile_id
      where lr.status = 'PENDING'
        and (
          v_role = 'super_admin'
          or (v_role = 'admin' and p.role = 'user' and p.is_active)
        )
      union all
      select ps.id
      from public.payroll_slips ps
      join public.profiles p on p.id = ps.profile_id
      where ps.status = 'PENDING'
        and (
          v_role = 'super_admin'
          or (
            v_role = 'admin'
            and p.role = 'user'
            and p.is_active
            and ps.created_by is distinct from v_user_id
          )
        )
    ) requests
    group by al.location_id

    union all

    select e.location_id, 'rubber-export', count(*)::bigint
    from public.rubber_exports e
    join accessible_locations al on al.location_id = e.location_id
    where (v_can_manage_system or v_role = 'admin')
      and e.status = 'draft'
    group by e.location_id
  )
  select c.location_id, c.module_id, sum(c.item_count)::bigint
  from counts c
  where c.item_count > 0
  group by c.location_id, c.module_id
  order by c.location_id, c.module_id;
end;
$$;

revoke all on function public.get_actionable_badge_counts()
  from public, anon;
grant execute on function public.get_actionable_badge_counts()
  to authenticated;

do $$
declare
  v_definition text;
  v_anchor text :=
    'perform pg_advisory_xact_lock(hashtextextended(p_location_id::text, 0));';
begin
  select pg_get_functiondef(
    'public.create_report_batch(uuid)'::regprocedure
  ) into v_definition;

  if strpos(v_definition, v_anchor) = 0 then
    raise exception 'Unable to locate Report Batch location lock';
  end if;

  v_definition := replace(
    v_definition,
    v_anchor,
    v_anchor || E'\n\n  if exists (\n    select 1\n    from private.rubber_bill_report_blockers(p_location_id, v_cutoff_at)\n  ) then\n    raise exception ''RUBBER_BILL_PENDING: ยังมีงานบิลยางที่ต้องจัดการก่อนสร้างรายงาน'';\n  end if;'
  );
  execute v_definition;
end;
$$;

do $$
declare
  v_definition text;
  v_anchor text :=
    'v_result := public.sync_rubber_bill_core_20260725010000(v_request.proposed_payload);';
begin
  select pg_get_functiondef(
    'public.approve_rubber_bill_approval_request(uuid)'::regprocedure
  ) into v_definition;

  if strpos(v_definition, v_anchor) = 0 then
    raise exception 'Unable to locate Rubber Bill approval sync';
  end if;

  v_definition := replace(
    v_definition,
    v_anchor,
    E'perform pg_advisory_xact_lock(hashtextextended(v_request.location_id::text, 0));\n\n  ' || v_anchor
  );
  execute v_definition;
end;
$$;

do $$
declare
  v_definition text;
  v_old text :=
    'and m.transfer_status in (''paid'', ''overpaid'', ''branch_and_transfer'', ''advance_payment'')';
  v_new text :=
    'and m.transfer_status in (''paid'', ''overpaid'', ''branch_and_transfer'')';
begin
  select pg_get_functiondef(
    'private.reportable_items(uuid,timestamptz)'::regprocedure
  ) into v_definition;

  if strpos(v_definition, v_old) = 0 then
    raise exception 'Unable to locate advance-payment Report predicates';
  end if;

  v_definition := replace(v_definition, v_old, v_new);
  execute v_definition;
end;
$$;

do $$
declare
  v_definition text;
  v_anchor text :=
    'select name, phone
    into v_actor_name, v_actor_phone
  from public.profiles
  where id = auth.uid();';
begin
  select pg_get_functiondef(
    'public.sync_rubber_bill(jsonb)'::regprocedure
  ) into v_definition;

  if strpos(v_definition, v_anchor) = 0 then
    raise exception 'Unable to locate Rubber Bill sync actor lookup';
  end if;

  v_definition := replace(
    v_definition,
    v_anchor,
    E'perform pg_advisory_xact_lock(hashtextextended(v_location_id::text, 0));\n\n  ' || v_anchor
  );
  execute v_definition;
end;
$$;
