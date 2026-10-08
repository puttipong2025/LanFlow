create or replace function public.sync_income_expense(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_approval jsonb;
  v_stock_result jsonb;
  v_result jsonb;
  v_operation text := coalesce(payload ->> 'operation', '');
  v_title text := btrim(coalesce(payload ->> 'title', ''));
  v_client_temp_id text := nullif(btrim(payload ->> 'clientTempId'), '');
  v_idempotency_key text := nullif(btrim(payload ->> 'idempotencyKey'), '');
  v_fingerprint text := private.income_expense_submission_fingerprint(payload);
  v_existing_request record;
  v_existing_row record;
begin
  if v_operation = 'create'
     and (
       v_title like 'รับโอนจาก%'
       or v_title like 'โยกเงินไป%'
       or v_title like 'สาขาจ่ายส่วนต่างให้%'
       or lower(v_title) = 'branch transfer'
     ) then
    return jsonb_build_object(
      'status', 'conflict',
      'errorMessage', 'ไม่สามารถซิงก์รายการโยกเงินโดยตรงได้ ต้องทำผ่านระบบโยกเงินเท่านั้น'
    );
  end if;

  if v_idempotency_key is not null then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('income-expense-submission:' || v_idempotency_key, 0)
    );

    select client_temp_id, last_submission_fingerprint
      into v_existing_row
    from public.income_expense
    where idempotency_key = v_idempotency_key;

    if v_existing_row.client_temp_id is not null then
      if v_existing_row.client_temp_id is distinct from v_client_temp_id
         or (
           v_existing_row.last_submission_fingerprint is not null
           and v_existing_row.last_submission_fingerprint is distinct from v_fingerprint
         ) then
        return jsonb_build_object(
          'status', 'conflict',
          'errorMessage', 'ข้อมูลคำขอไม่ตรงกับรายการที่บันทึกไว้ก่อนหน้า'
        );
      end if;
    else
      select request_idempotency_key, requested_payload
        into v_existing_request
      from public.income_expense_approval_requests
      where request_idempotency_key = v_idempotency_key;

      if v_existing_request.request_idempotency_key is not null
         and private.income_expense_submission_fingerprint(v_existing_request.requested_payload)
           is distinct from v_fingerprint then
        return jsonb_build_object(
          'status', 'conflict',
          'errorMessage', 'ข้อมูลคำขอไม่ตรงกับรายการที่ส่งไว้ก่อนหน้า'
        );
      end if;
    end if;
  end if;

  if coalesce(current_setting('app.bypass_income_expense_approval', true), 'false') = 'true' then
    v_result := private.sync_income_expense_dispatch_20260805020000(payload);
  elsif payload ->> 'billOption' = 'บิลขาย'
     and v_operation in ('create', 'update') then
    v_approval := public.create_income_expense_approval_request(payload);
    if v_approval ->> 'status' = 'pending' then
      v_result := jsonb_build_object(
        'status', 'pending_approval',
        'requestId', v_approval ->> 'requestId',
        'matchedReasons', coalesce(v_approval -> 'matchedReasons', '[]'::jsonb),
        'errorMessage', 'รายการนี้ต้องรออนุมัติ'
      );
    elsif v_approval ->> 'status' <> 'no_approval' then
      v_result := v_approval;
    else
      v_stock_result := private.preflight_income_sale_stock(payload);
      if v_stock_result ->> 'status' <> 'ok' then
        v_result := v_stock_result;
      else
        perform set_config('app.bypass_income_expense_approval', 'true', true);
        v_result := private.sync_income_expense_dispatch_20260805020000(payload);
      end if;
    end if;
  else
    v_approval := public.create_income_expense_approval_request(payload);
    if v_approval ->> 'status' = 'no_approval' then
      v_result := private.sync_income_expense_dispatch_20260805020000(payload);
    elsif v_approval ->> 'status' = 'pending' then
      v_result := jsonb_build_object(
        'status', 'pending_approval',
        'requestId', v_approval ->> 'requestId',
        'matchedReasons', coalesce(v_approval -> 'matchedReasons', '[]'::jsonb),
        'errorMessage', 'รายการนี้ต้องรออนุมัติ'
      );
    else
      v_result := v_approval;
    end if;
  end if;

  if v_result ->> 'status' = 'synced' then
    update public.income_expense
    set last_submission_fingerprint = v_fingerprint
    where id = (v_result ->> 'id')::uuid
      and idempotency_key = v_idempotency_key;
  end if;

  return v_result;
end;
$$;

revoke all on function public.sync_income_expense(jsonb) from public, anon;
grant execute on function public.sync_income_expense(jsonb) to authenticated;

comment on function public.sync_income_expense(jsonb) is
  'Synchronizes Income/Expense writes. Saved-row fingerprints are authoritative for approved replay, while pending approval payload changes are rejected.';
