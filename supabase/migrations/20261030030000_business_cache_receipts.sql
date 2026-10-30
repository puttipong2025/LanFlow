-- Bounded, authorized read of the exact locally cached identities, including
-- positive soft-deletion proof. Never infer deletion from a paged feed.
create function public.get_rubber_bill_cache_rows(p_location_id uuid, p_bill_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if not private.can_access_business_modules() or not private.sms_access_allowed()
     or p_location_id is null or not private.can_access_location(p_location_id) then
    raise exception 'FORBIDDEN: location access denied' using errcode = '42501';
  end if;
  if p_bill_ids is null or cardinality(p_bill_ids) > 100
     or array_position(p_bill_ids, null) is not null
     or cardinality(p_bill_ids) <> (select count(distinct id) from unnest(p_bill_ids) id) then
    raise exception 'Invalid receipt identity batch' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(
    (to_jsonb(b) - 'ocr_source_id' - 'ocr_image_sha256') || jsonb_build_object(
      'has_ocr_source_image', b.ocr_source_id is not null,
      'items', coalesce((select jsonb_agg(to_jsonb(i) order by i.sequence_no, i.id)
        from public.rubber_bill_items i where i.bill_id = b.id), '[]'::jsonb),
      'report_lock_no', public.report_lock_no(b),
      'transfer_lock_id', (select i.transfer_id from public.money_transfer_items i
        join public.money_transfers t on t.id = i.transfer_id
        where i.source_type = 'rubber_bill' and i.source_id = b.id and t.record_status <> 'deleted' limit 1),
      'approval_pending', req.id is not null,
      'approval_request_id', req.id, 'approval_operation', req.operation,
      'approval_reasons', req.matched_reasons, 'approval_requested_by_name', req.requested_by_name,
      'approval_proposed_summary', case when req.operation = 'update' then jsonb_build_object(
        'customerName', req.proposed_payload->>'customerName', 'billDate', req.proposed_payload->>'billDate',
        'billType', req.proposed_payload->>'billType', 'netWeight', req.proposed_payload->'netWeight',
        'averagePrice', req.proposed_payload->'averagePrice', 'netRubberValue', req.proposed_payload->'netRubberValue',
        'deductionTotal', req.proposed_payload->'deductionTotal', 'netTotal', req.proposed_payload->'netTotal'
      ) else null end
    ) order by b.id), '[]'::jsonb) into result
  from public.rubber_bills b
  left join lateral (select r.* from public.rubber_bill_approval_requests r
    where r.location_id = p_location_id and r.bill_id = b.id and r.request_status = 'pending'
    order by r.requested_at, r.id limit 1) req on true
  where b.location_id = p_location_id and b.id = any(p_bill_ids);
  return result;
end $$;
revoke all on function public.get_rubber_bill_cache_rows(uuid, uuid[]) from public, anon;
grant execute on function public.get_rubber_bill_cache_rows(uuid, uuid[]) to authenticated;
notify pgrst, 'reload schema';
