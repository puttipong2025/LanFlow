-- Authorize sale create/update before returning any stock preflight details.
create or replace function public.sync_income_expense(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_approval jsonb;
  v_stock_result jsonb;
begin
  if coalesce(current_setting('app.bypass_income_expense_approval', true), 'false') = 'true' then
    return private.sync_income_expense_dispatch_20260805020000(payload);
  end if;

  if payload->>'billOption' = 'บิลขาย'
     and payload->>'operation' in ('create', 'update') then
    v_approval := public.create_income_expense_approval_request(payload);
    if v_approval->>'status' <> 'no_approval' then
      return v_approval;
    end if;

    v_stock_result := private.preflight_income_sale_stock(payload);
    if v_stock_result->>'status' <> 'ok' then
      return v_stock_result;
    end if;
    perform set_config('app.bypass_income_expense_approval', 'true', true);
    return private.sync_income_expense_dispatch_20260805020000(payload);
  end if;

  v_approval := public.create_income_expense_approval_request(payload);
  if v_approval->>'status' = 'no_approval' then
    return private.sync_income_expense_dispatch_20260805020000(payload);
  end if;
  if v_approval->>'status' = 'pending' then
    return jsonb_build_object(
      'status', 'pending_approval',
      'requestId', v_approval->>'requestId',
      'matchedReasons', coalesce(v_approval->'matchedReasons', '[]'::jsonb),
      'errorMessage', 'รายการนี้ต้องรออนุมัติ'
    );
  end if;
  return v_approval;
end;
$$;

revoke all on function public.sync_income_expense(jsonb) from public, anon;
grant execute on function public.sync_income_expense(jsonb) to authenticated;
