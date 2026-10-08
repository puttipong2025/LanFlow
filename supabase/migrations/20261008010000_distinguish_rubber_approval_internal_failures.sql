-- Keep expected approval rejections on P0001 while exposing core sync failures as
-- an internal SQLSTATE so the HTTP boundary does not misclassify them as bad input.

do $migration$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'public.approve_rubber_bill_approval_request(uuid)'::regprocedure
  ) into v_definition;

  v_updated := replace(
    v_definition,
    $old$    raise exception '%', coalesce(v_result->>'errorMessage', 'อนุมัติคำขอไม่สำเร็จ');$old$,
    $new$    raise exception using
      errcode = 'RB500',
      message = coalesce(v_result->>'errorMessage', 'อนุมัติคำขอไม่สำเร็จ');$new$
  );

  if v_updated = v_definition then
    raise exception 'rubber approval internal-failure branch not found';
  end if;

  execute v_updated;
end;
$migration$;
