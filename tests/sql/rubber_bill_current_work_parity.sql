\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000001', true);

do $parity$
declare
  v_location uuid := '00000000-0000-4000-8000-000000000102';
  v_counts jsonb;
  v_unpriced bigint;
  v_pending bigint;
  v_menu bigint;
  v_expected_menu bigint;
  v_report_blockers bigint;
begin
  select public.get_rubber_bill_work_counts(v_location) into v_counts;
  select
    count(distinct w.work_identity) filter (where w.work_kind = 'unpriced'),
    count(distinct w.work_identity) filter (where w.work_kind = 'pending_approval')
  into v_unpriced, v_pending
  from private.rubber_bill_current_work_items(v_location) w;
  if (v_counts->>'unpriced')::bigint <> coalesce(v_unpriced, 0) then
    raise exception 'unpriced badge is not current-work parity';
  end if;
  if (v_counts->>'pendingApproval')::bigint <> coalesce(v_pending, 0) then
    raise exception 'approval badge is not current-work parity';
  end if;

  select count(distinct w.work_identity) into v_expected_menu
  from private.rubber_bill_current_work_items(v_location) w
  where w.work_kind in ('unpriced', 'pending_approval');
  select coalesce(sum(b.item_count), 0) into v_menu
  from public.get_actionable_badge_counts() b
  where b.location_id = v_location and b.module_id = 'rubber';
  if v_menu <> coalesce(v_expected_menu, 0) then
    raise exception 'menu badge is not a distinct current-work union';
  end if;

  -- The report/cash-count contract remains independently callable with cutoff semantics.
  select count(*) into v_report_blockers
  from private.rubber_bill_report_blockers(v_location, now());
  if v_report_blockers < 0 then raise exception 'invalid report blocker count'; end if;
end
$parity$;

rollback;
select 'rubber-current-work-parity-ok' as result;
