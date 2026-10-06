-- Preserve idempotency semantics for direct mutations that do not create approval rows.

create function private.rubber_bill_submission_fingerprint(p_payload jsonb)
returns text
language sql
set search_path = 'pg_catalog', 'public', 'private', 'extensions'
as $$
  select encode(
    extensions.digest(
      convert_to((
        private.normalize_rubber_bill_calculation_payload(p_payload)
          - 'configuredPriceSnapshot' - 'forceNonCurrentDateApproval' - 'submissionMode'
      )::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  )
$$;

revoke all on function private.rubber_bill_submission_fingerprint(jsonb)
from public, anon, authenticated;

alter table public.rubber_bills
  add column last_submission_fingerprint text,
  add constraint rubber_bills_last_submission_fingerprint_check check (
    last_submission_fingerprint is null
    or last_submission_fingerprint ~ '^[0-9a-f]{64}$'
  );

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef('public.sync_rubber_bill(jsonb)'::regprocedure)
    into v_definition;

  v_updated := replace(
    v_definition,
    $old$        'errorMessage', 'ข้อมูลคำขออนุมัติไม่ตรงกับรายการที่อนุมัติแล้ว'
      );
    end if;
    return jsonb_build_object($old$,
    $new$        'errorMessage', 'ข้อมูลคำขออนุมัติไม่ตรงกับรายการที่อนุมัติแล้ว'
      );
    end if;
    if v_existing_request.id is null
       and v_existing_bill.last_submission_fingerprint is not null
       and v_existing_bill.last_submission_fingerprint is distinct from
         private.rubber_bill_submission_fingerprint(payload) then
      return jsonb_build_object(
        'status', 'conflict',
        'errorMessage', 'ข้อมูลบิลไม่ตรงกับรายการที่บันทึกแล้ว'
      );
    end if;
    return jsonb_build_object($new$
  );
  if v_updated = v_definition then
    raise exception 'direct replay comparison point not found';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    $old$    if v_result->>'status' = 'synced' then
      v_bill_id := (v_result->>'id')::uuid;
      if v_operation = 'create' or coalesce((v_decision->>'priceChanged')::boolean, false) then$old$,
    $new$    if v_result->>'status' = 'synced' then
      v_bill_id := (v_result->>'id')::uuid;
      update public.rubber_bills
      set last_submission_fingerprint = private.rubber_bill_submission_fingerprint(payload)
      where id = v_bill_id;
      if v_operation = 'create' or coalesce((v_decision->>'priceChanged')::boolean, false) then$new$
  );
  if v_updated = v_definition then
    raise exception 'direct submission fingerprint write point not found';
  end if;

  execute v_updated;
end;
$migration$;
