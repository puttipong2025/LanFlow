-- Cash branch transfers are owned by the Income/Expense module. Keep the
-- shared source rows available to its feed, but omit them from Money Transfer.
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
  if p_page_size < 1 or p_page_size > 100 then
    raise exception 'Invalid page size';
  end if;
  if (p_cursor_created_at is null) <> (p_cursor_id is null) then
    raise exception 'Invalid transfer cursor';
  end if;

  with candidates as (
    select t.*,
      public.report_lock_no(t) report_lock_no,
      coalesce((select sum(s.amount) from public.money_transfer_slips s where s.transfer_id = t.id), 0) paid_amount,
      coalesce((select count(*) from public.money_transfer_items i where i.transfer_id = t.id), 0) source_count
    from public.money_transfers t
    where t.location_id = p_location_id
      and t.record_status <> 'deleted'
      and t.transfer_type <> 'cash'
      and (p_status = 'all' or t.transfer_status = p_status)
      and (v_search = '' or position(v_search in lower(concat_ws(' ', t.customer_name, t.account_number,
        t.account_name, t.bank_name, t.transport_staff_name, t.target_location_name, t.id::text))) > 0)
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
      'pending', count(*) filter (where t.transfer_status = 'pending'),
      'partial', count(*) filter (where t.transfer_status = 'partial'),
      'advance_payment', count(*) filter (where t.transfer_status = 'advance_payment'),
      'paid', count(*) filter (where t.transfer_status = 'paid'),
      'overpaid', count(*) filter (where t.transfer_status = 'overpaid'),
      'branch_and_transfer', count(*) filter (where t.transfer_status = 'branch_and_transfer'),
      'cancelled', count(*) filter (where t.transfer_status = 'cancelled')
    ) from public.money_transfers t
      where t.location_id = p_location_id
        and t.record_status <> 'deleted'
        and t.transfer_type <> 'cash'),
    'hasMore', (select count(*) > p_page_size from candidates),
    'nextCreatedAt', (select v.created_at from visible v order by v.created_at, v.id limit 1),
    'nextId', (select v.id from visible v order by v.created_at, v.id limit 1)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.get_money_transfer_list(uuid, text, text, timestamptz, uuid, integer) from public, anon;
grant execute on function public.get_money_transfer_list(uuid, text, text, timestamptz, uuid, integer) to authenticated;
