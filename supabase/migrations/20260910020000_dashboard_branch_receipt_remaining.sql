-- Include unexported branch-receipt bills in the Dashboard remaining-rubber
-- inventory while keeping purchase, payable, and cash metrics customer-only.

do $migration$
declare
  v_definition text := pg_get_functiondef(
    'private.calculate_dashboard_summary(uuid)'::regprocedure
  );
  v_old_remaining text := $old$
  remaining_rubber as (
    select
      count(*) as bill_count,
      coalesce(sum(b.net_weight), 0) as net_weight,
      coalesce(sum(b.net_weight) filter (
        where b.has_price and b.net_weight > 0
      ), 0) as priced_net_weight,
      coalesce(sum(b.rubber_value) filter (where b.has_price), 0) as rubber_value,
      coalesce(sum(b.deduction_total), 0) as deduction_total,
      count(*) filter (where not b.has_price) as unpriced_bill_count,
      count(*) filter (where b.has_pending_approval) as pending_approval_count
    from customer_bill_facts b
    where not b.has_verified_export
  ),
$old$;
  v_new_remaining text := $new$
  branch_receipt_facts as (
    select
      b.net_weight,
      b.rubber_value,
      (
        exists (
          select 1
          from public.rubber_bill_items i
          where i.bill_id = b.id
            and i.item_type = 'weigh'
        )
        and not exists (
          select 1
          from public.rubber_bill_items i
          where i.bill_id = b.id
            and i.item_type = 'weigh'
            and coalesce(i.price, 0) <= 0
        )
      ) as has_price,
      case
        when source.location_id = b.location_id then 'same_branch'
        else 'cross_branch'
      end as receipt_kind,
      exists (
        select 1
        from public.rubber_export_items i
        join public.rubber_exports e on e.id = i.export_id
        where i.source_bill_id = b.id
          and e.status = 'verified'
      ) as has_verified_export
    from active_bills b
    join public.rubber_exports source on source.id = b.source_rubber_export_id
    where b.source_rubber_export_id is not null
  ),
  remaining_rubber_facts as (
    select
      b.net_weight,
      b.rubber_value,
      b.deduction_total,
      b.has_price,
      b.has_pending_approval,
      'customer'::text as receipt_kind,
      b.has_verified_export
    from customer_bill_facts b

    union all

    select
      b.net_weight,
      b.rubber_value,
      0::numeric as deduction_total,
      b.has_price,
      false as has_pending_approval,
      b.receipt_kind,
      b.has_verified_export
    from branch_receipt_facts b
  ),
  remaining_rubber as (
    select
      count(*) as bill_count,
      coalesce(sum(b.net_weight), 0) as net_weight,
      coalesce(sum(b.net_weight) filter (
        where b.has_price and b.net_weight > 0
      ), 0) as priced_net_weight,
      coalesce(sum(b.rubber_value) filter (where b.has_price), 0) as rubber_value,
      coalesce(sum(b.deduction_total), 0) as deduction_total,
      count(*) filter (
        where b.receipt_kind = 'customer' and not b.has_price
      ) as unpriced_bill_count,
      count(*) filter (
        where b.receipt_kind = 'customer' and b.has_pending_approval
      ) as pending_approval_count,
      count(*) filter (where b.receipt_kind = 'cross_branch')
        as cross_branch_bill_count,
      coalesce(sum(b.net_weight) filter (
        where b.receipt_kind = 'cross_branch'
      ), 0) as cross_branch_net_weight,
      coalesce(sum(b.rubber_value) filter (
        where b.receipt_kind = 'cross_branch' and b.has_price
      ), 0) as cross_branch_rubber_value,
      count(*) filter (where b.receipt_kind = 'same_branch')
        as same_branch_bill_count,
      coalesce(sum(b.net_weight) filter (
        where b.receipt_kind = 'same_branch'
      ), 0) as same_branch_net_weight,
      coalesce(sum(b.rubber_value) filter (
        where b.receipt_kind = 'same_branch' and b.has_price
      ), 0) as same_branch_rubber_value
    from remaining_rubber_facts b
    where not b.has_verified_export
  ),
$new$;
  v_old_json text := $old$
      'pendingApprovalCount', rr.pending_approval_count
    ),
    'purchase7Days', jsonb_build_object(
$old$;
  v_new_json text := $new$
      'pendingApprovalCount', rr.pending_approval_count,
      'branchReceipts', jsonb_build_object(
        'crossBranch', jsonb_build_object(
          'billCount', rr.cross_branch_bill_count,
          'netWeight', round(rr.cross_branch_net_weight, 2),
          'rubberValue', round(rr.cross_branch_rubber_value, 2)
        ),
        'sameBranch', jsonb_build_object(
          'billCount', rr.same_branch_bill_count,
          'netWeight', round(rr.same_branch_net_weight, 2),
          'rubberValue', round(rr.same_branch_rubber_value, 2)
        )
      )
    ),
    'purchase7Days', jsonb_build_object(
$new$;
begin
  if position(v_old_remaining in v_definition) = 0 then
    raise exception 'calculate_dashboard_summary remaining-rubber anchor not found';
  end if;

  if position(v_old_json in v_definition) = 0 then
    raise exception 'calculate_dashboard_summary JSON anchor not found';
  end if;

  v_definition := replace(v_definition, v_old_remaining, v_new_remaining);
  v_definition := replace(v_definition, v_old_json, v_new_json);
  execute v_definition;
end
$migration$;

revoke all on function private.calculate_dashboard_summary(uuid)
  from public, anon, authenticated;

-- Existing snapshots do not contain the new breakdown key. Queue every active
-- branch for a forward rebuild while preserving queued or running work.
update public.dashboard_branch_snapshots snapshot
set status = case
      when snapshot.status in ('queued', 'running') then snapshot.status
      else 'dirty'
    end,
    source_version = greatest(
      snapshot.source_version + 1,
      pg_catalog.txid_current()
    ),
    updated_at = now()
from public.locations location
where location.id = snapshot.location_id
  and location.is_active = true;
