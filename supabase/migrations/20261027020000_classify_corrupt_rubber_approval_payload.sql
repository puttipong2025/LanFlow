-- An approval action has no client payload to correct. A malformed persisted
-- proposal is an internal failure, while existing business rejections stay P0001.
do $migration$
declare
  definition text;
  updated text;
  anchor constant text := '  v_result := public.sync_rubber_bill_core_20260725010000(v_request.proposed_payload);';
begin
  select pg_get_functiondef('public.approve_rubber_bill_approval_request(uuid)'::regprocedure)
  into definition;

  updated := replace(definition, anchor, $replacement$  begin
    perform private.normalize_rubber_bill_calculation_payload(v_request.proposed_payload);
  exception when others then
    raise exception using errcode = 'RB500', message = 'ข้อมูลคำขออนุมัติบิลยางที่บันทึกไว้ไม่ถูกต้อง';
  end;

  v_result := public.sync_rubber_bill_core_20260725010000(v_request.proposed_payload);$replacement$);
  if updated = definition then
    raise exception 'rubber approval sync anchor not found';
  end if;
  execute updated;
end;
$migration$;
