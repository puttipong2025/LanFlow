-- Repeat the direct-replay fingerprint check after the per-bill transaction locks.

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'private.sync_rubber_bill_approval_20260823010000(jsonb)'::regprocedure
  ) into v_definition;

  v_updated := replace(
    v_definition,
    $old$      if v_bill.location_id is distinct from v_location_id
         or v_bill.idempotency_key is distinct from v_idempotency_key then
        return jsonb_build_object('status', 'conflict', 'errorMessage', 'Record already exists');
      end if;
      return jsonb_build_object($old$,
    $new$      if v_bill.location_id is distinct from v_location_id
         or v_bill.idempotency_key is distinct from v_idempotency_key then
        return jsonb_build_object('status', 'conflict', 'errorMessage', 'Record already exists');
      end if;
      if v_bill.last_submission_fingerprint is not null
         and v_bill.last_submission_fingerprint is distinct from
           private.rubber_bill_submission_fingerprint(payload) then
        return jsonb_build_object(
          'status', 'conflict',
          'errorMessage', 'ข้อมูลบิลไม่ตรงกับรายการที่บันทึกแล้ว'
        );
      end if;
      return jsonb_build_object($new$
  );
  if v_updated = v_definition then
    raise exception 'post-lock create replay branch not found';
  end if;
  v_definition := v_updated;

  v_updated := replace(
    v_definition,
    $old$    if v_bill.idempotency_key = v_idempotency_key then
      return jsonb_build_object($old$,
    $new$    if v_bill.idempotency_key = v_idempotency_key then
      if v_bill.last_submission_fingerprint is not null
         and v_bill.last_submission_fingerprint is distinct from
           private.rubber_bill_submission_fingerprint(payload) then
        return jsonb_build_object(
          'status', 'conflict',
          'errorMessage', 'ข้อมูลบิลไม่ตรงกับรายการที่บันทึกแล้ว'
        );
      end if;
      return jsonb_build_object($new$
  );
  if v_updated = v_definition then
    raise exception 'post-lock mutation replay branch not found';
  end if;

  execute v_updated;
end;
$migration$;
