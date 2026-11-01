-- Business conflicts must not use serialization_failure: PostgREST 14 retries it.
begin;
do $migration$
declare body text; changed text;
begin
  body := pg_get_functiondef('public.reset_all_bill_devices(uuid,text,text)'::regprocedure);
  changed := replace(body, 'errcode = ''40001''', 'errcode = ''PT409''');
  if changed = body then raise exception 'Bill device reset conflict boundary missing'; end if;
  execute changed;
end $migration$;
notify pgrst, 'reload schema';
commit;
