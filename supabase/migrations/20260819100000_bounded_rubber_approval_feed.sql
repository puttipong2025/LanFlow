-- Put pending Rubber Bill creates and bill-backed approval work in one bounded feed.

create or replace function public.get_rubber_bill_operational_feed_v2(
  p_location_id uuid,
  p_mode text default 'latest',
  p_document_status text default 'any',
  p_search text default '',
  p_cursor_sort_at timestamptz default null,
  p_cursor_work_identity text default null,
  p_page_size integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_can_manage boolean;
  v_ascending boolean := p_mode in ('unpriced', 'pending_approval');
  v_search text := lower(trim(coalesce(p_search, '')));
  v_result jsonb;
begin
  if not private.is_active_user() then raise exception 'Unauthorized or inactive user'; end if;
  if p_location_id is null or not private.can_access_location(p_location_id) then
    raise exception 'Location access denied';
  end if;
  if p_mode not in ('latest', 'unpriced', 'pending_approval') then
    raise exception 'Unsupported Rubber Bill mode';
  end if;
  if p_document_status not in ('any', 'editable', 'report_locked', 'in_transfer') then
    raise exception 'Unsupported Rubber Bill document status';
  end if;
  if p_page_size < 1 or p_page_size > 150 then
    raise exception 'Rubber Bill page size must be between 1 and 150';
  end if;
  if (p_cursor_sort_at is null) <> (p_cursor_work_identity is null) then
    raise exception 'Rubber Bill cursor is incomplete';
  end if;

  select p.role = 'super_admin' or p.can_access_super_admin_features = true
  into v_can_manage
  from public.profiles p
  where p.id = auth.uid() and p.is_active = true;
  if p_mode = 'pending_approval' and not coalesce(v_can_manage, false) then
    raise exception 'Rubber Bill approval access denied';
  end if;

  with bill_candidates as (
    select
      'bill'::text row_kind,
      'bill:' || b.id::text work_identity,
      b.id,
      case when p_mode = 'pending_approval'
        then coalesce(req.requested_at, coalesce(b.client_created_at, b.created_at))
        else coalesce(b.client_created_at, b.created_at)
      end feed_sort_at,
      to_jsonb(b) || jsonb_build_object(
        'row_kind', 'bill',
        'work_identity', 'bill:' || b.id::text,
        'items', coalesce((
          select jsonb_agg(to_jsonb(i) order by i.sequence_no, i.id)
          from public.rubber_bill_items i where i.bill_id = b.id
        ), '[]'::jsonb),
        'report_lock_no', public.report_lock_no(b),
        'transfer_lock_id', (
          select i.transfer_id
          from public.money_transfer_items i
          join public.money_transfers t on t.id = i.transfer_id
          where i.source_type = 'rubber_bill' and i.source_id = b.id
            and t.record_status <> 'deleted'
          limit 1
        ),
        'approval_pending', req.id is not null,
        'approval_request_id', req.id,
        'approval_operation', req.operation,
        'approval_reasons', req.matched_reasons,
        'approval_requested_at', req.requested_at,
        'approval_requested_by_name', req.requested_by_name,
        'approval_original_summary', case when req.id is null then null else jsonb_build_object(
          'customerName', req.original_payload->>'customerName',
          'billDate', req.original_payload->>'billDate',
          'netTotal', req.original_payload->'netTotal'
        ) end,
        'approval_proposed_summary', case when req.id is null then null else jsonb_build_object(
          'customerName', req.proposed_payload->>'customerName',
          'billDate', req.proposed_payload->>'billDate',
          'netTotal', req.proposed_payload->'netTotal'
        ) end
      ) row_json
    from public.rubber_bills b
    left join lateral (
      select r.id, r.operation, r.matched_reasons, r.requested_at,
        r.requested_by_name, r.original_payload, r.proposed_payload
      from public.rubber_bill_approval_requests r
      where r.bill_id = b.id and r.location_id = p_location_id
        and r.request_status = 'pending'
      order by r.requested_at, r.id
      limit 1
    ) req on true
    where b.location_id = p_location_id and b.record_status = 'active'
      and (p_mode = 'latest' or exists (
        select 1 from private.rubber_bill_current_work_items(p_location_id) w
        where w.bill_id = b.id and w.work_kind = p_mode
      ))
      and (
        p_document_status = 'any'
        or (p_document_status = 'report_locked' and public.report_lock_no(b) is not null)
        or (p_document_status = 'in_transfer' and exists (
          select 1 from public.money_transfer_items i
          join public.money_transfers t on t.id = i.transfer_id
          where i.source_type = 'rubber_bill' and i.source_id = b.id
            and t.record_status <> 'deleted'
        ))
        or (p_document_status = 'editable' and public.report_lock_no(b) is null
          and req.id is null and not exists (
            select 1 from public.money_transfer_items i
            join public.money_transfers t on t.id = i.transfer_id
            where i.source_type = 'rubber_bill' and i.source_id = b.id
              and t.record_status <> 'deleted'
          ))
      )
      and (v_search = '' or position(v_search in lower(concat_ws(' ',
        b.bill_no, b.local_bill_no, b.server_bill_no, b.bill_date::text,
        b.customer_name, b.bill_type, b.created_by_name, b.created_by_phone
      ))) > 0)
  ), create_candidates as (
    select
      'approval_create'::text row_kind,
      'approval:' || r.id::text work_identity,
      r.id,
      r.requested_at feed_sort_at,
      jsonb_build_object(
        'row_kind', 'approval_create',
        'work_identity', 'approval:' || r.id::text,
        'id', r.id,
        'client_temp_id', r.client_temp_id,
        'local_bill_no', coalesce(r.proposed_payload->>'localBillNo', 'รอเลขบิล'),
        'server_bill_no', null,
        'idempotency_key', coalesce(r.proposed_payload->>'idempotencyKey', r.id::text),
        'location_id', r.location_id,
        'bill_no', 'รออนุมัติ',
        'bill_date', r.proposed_payload->>'billDate',
        'customer_id', nullif(r.proposed_payload->>'customerId', '')::uuid,
        'customer_name', coalesce(r.proposed_payload->>'customerName', ''),
        'bill_type', coalesce(r.proposed_payload->>'billType', 'บิลเครื่องชั่งเล็ก'),
        'deduct_weight', coalesce((r.proposed_payload->>'deductWeight')::numeric, 0),
        'weight', coalesce((r.proposed_payload->>'weight')::numeric, 0),
        'net_weight', coalesce((r.proposed_payload->>'netWeight')::numeric, 0),
        'rubber_value', coalesce((r.proposed_payload->>'rubberValue')::numeric, 0),
        'net_rubber_value', coalesce((r.proposed_payload->>'netRubberValue')::numeric, 0),
        'average_price', coalesce((r.proposed_payload->>'averagePrice')::numeric, 0),
        'deduction_total', coalesce((r.proposed_payload->>'deductionTotal')::numeric, 0),
        'payable_before_rounding', coalesce((r.proposed_payload->>'payableBeforeRounding')::numeric, 0),
        'net_total', coalesce((r.proposed_payload->>'netTotal')::numeric, 0),
        'acid_pack_count', coalesce((r.proposed_payload->>'acidPackCount')::numeric, 0),
        'configured_price_snapshot', r.configured_price_snapshot,
        'created_by_user_id', r.requested_by_user_id,
        'created_by_name', r.requested_by_name,
        'created_by_phone', r.requested_by_phone,
        'client_created_at', coalesce((r.proposed_payload->>'clientCreatedAt')::timestamptz, r.requested_at),
        'client_recorded_at', coalesce((r.proposed_payload->>'clientRecordedAt')::timestamptz, r.requested_at),
        'created_at', r.requested_at,
        'revision_no', 0,
        'record_status', 'active',
        'approval_pending', true,
        'approval_request_id', r.id,
        'approval_operation', 'create',
        'approval_reasons', r.matched_reasons,
        'approval_requested_at', r.requested_at,
        'approval_requested_by_name', r.requested_by_name,
        'approval_original_summary', null,
        'approval_proposed_summary', jsonb_build_object(
          'customerName', r.proposed_payload->>'customerName',
          'billDate', r.proposed_payload->>'billDate',
          'netTotal', r.proposed_payload->'netTotal'
        ),
        'items', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', concat(r.id::text, ':', coalesce(item->>'sequenceNo', ordinal::text)),
            'item_type', case when item->>'itemType' = 'acid' then 'acid' else item->>'itemType' end,
            'description', item->>'title',
            'weight_in', item->'inWeight', 'weight_out', item->'outWeight',
            'net_weight', item->'netWeight', 'price', item->'unitPrice',
            'total', coalesce(item->'totalAmount', item->'total'),
            'quantity', item->'quantity', 'unit', item->>'unit',
            'stock_product_id', item->>'stockProductId',
            'sequence_no', coalesce((item->>'sequenceNo')::integer, ordinal)
          ) order by ordinal)
          from jsonb_array_elements(coalesce(r.proposed_payload->'items', '[]'::jsonb))
            with ordinality as x(item, ordinal)
        ), '[]'::jsonb)
      ) row_json
    from public.rubber_bill_approval_requests r
    where r.location_id = p_location_id and r.request_status = 'pending'
      and r.operation = 'create' and r.bill_id is null
      and p_mode in ('latest', 'pending_approval')
      and p_document_status in ('any', 'editable')
      and (v_search = '' or position(v_search in lower(concat_ws(' ',
        r.proposed_payload->>'localBillNo', r.proposed_payload->>'billDate',
        r.proposed_payload->>'customerName', r.proposed_payload->>'billType',
        r.requested_by_name, r.requested_by_phone
      ))) > 0)
  ), candidates as (
    select * from bill_candidates
    union all
    select * from create_candidates
  ), scoped as (
    select c.*
    from candidates c
    where p_cursor_sort_at is null
      or (v_ascending and (c.feed_sort_at, c.work_identity) > (p_cursor_sort_at, p_cursor_work_identity))
      or (not v_ascending and (c.feed_sort_at, c.work_identity) < (p_cursor_sort_at, p_cursor_work_identity))
    order by
      case when v_ascending then c.feed_sort_at end asc,
      case when not v_ascending then c.feed_sort_at end desc,
      case when v_ascending then c.work_identity end asc,
      case when not v_ascending then c.work_identity end desc
    limit p_page_size + 1
  ), visible as (
    select * from scoped
    order by
      case when v_ascending then feed_sort_at end asc,
      case when not v_ascending then feed_sort_at end desc,
      case when v_ascending then work_identity end asc,
      case when not v_ascending then work_identity end desc
    limit p_page_size
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(
      row_json || jsonb_build_object('operational_sort_at', feed_sort_at)
      order by
        case when v_ascending then feed_sort_at end asc,
        case when not v_ascending then feed_sort_at end desc,
        case when v_ascending then work_identity end asc,
        case when not v_ascending then work_identity end desc
    ) from visible), '[]'::jsonb),
    'hasMore', (select count(*) > p_page_size from scoped),
    'nextSortAt', (select feed_sort_at from visible order by
      case when v_ascending then feed_sort_at end desc,
      case when not v_ascending then feed_sort_at end asc,
      case when v_ascending then work_identity end desc,
      case when not v_ascending then work_identity end asc limit 1),
    'nextWorkIdentity', (select work_identity from visible order by
      case when v_ascending then feed_sort_at end desc,
      case when not v_ascending then feed_sort_at end asc,
      case when v_ascending then work_identity end desc,
      case when not v_ascending then work_identity end asc limit 1)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.get_rubber_bill_operational_feed_v2(
  uuid, text, text, text, timestamptz, text, integer
) from public, anon;
grant execute on function public.get_rubber_bill_operational_feed_v2(
  uuid, text, text, text, timestamptz, text, integer
) to authenticated;

notify pgrst, 'reload schema';
