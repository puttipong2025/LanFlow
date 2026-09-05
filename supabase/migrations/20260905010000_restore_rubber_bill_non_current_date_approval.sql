-- Preserve the global non-current-date approval gate when composing the
-- public sync entry point with the OCR reservation transaction.
create or replace function public.sync_rubber_bill(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_operation text := payload->>'operation';
  v_business_date date;
  v_requires_approval boolean := false;
  v_reservation jsonb;
  v_result jsonb;
begin
  begin
    if v_operation = 'delete' then
      select bill_date into v_business_date
      from public.rubber_bills
      where client_temp_id = payload->>'clientTempId';
    elsif v_operation in ('create', 'update') then
      v_business_date := (payload->>'billDate')::date;
    end if;
  exception when others then
    return jsonb_build_object(
      'status', 'failed',
      'errorMessage', 'วันที่บิลไม่ถูกต้อง'
    );
  end;

  select coalesce(non_current_date_requires_approval, false)
    into v_requires_approval
  from public.rubber_bill_approval_settings
  where id = true;

  if v_requires_approval
     and v_business_date is distinct from
       (clock_timestamp() at time zone 'Asia/Bangkok')::date then
    payload := payload || jsonb_build_object(
      'forceNonCurrentDateApproval', true
    );
  end if;

  begin
    v_reservation := private.reserve_rubber_bill_ocr_source(payload);
    if v_reservation->>'status' = 'conflict' then
      return v_reservation;
    end if;
    if v_reservation->>'status' <> 'ok' then
      v_result := v_reservation;
      raise exception using
        errcode = 'P0002',
        message = 'ROLLBACK_OCR_RESERVATION';
    end if;

    v_result := private.sync_rubber_bill_approval_20260823010000(payload);
    if v_result->>'status' in ('failed', 'conflict') then
      raise exception using
        errcode = 'P0002',
        message = 'ROLLBACK_OCR_RESERVATION';
    end if;
    return v_result;
  exception when sqlstate 'P0002' then
    return v_result;
  end;
end
$$;

alter function public.sync_rubber_bill(jsonb) owner to postgres;
revoke all on function public.sync_rubber_bill(jsonb) from public, anon;
grant execute on function public.sync_rubber_bill(jsonb) to authenticated;

notify pgrst, 'reload schema';
