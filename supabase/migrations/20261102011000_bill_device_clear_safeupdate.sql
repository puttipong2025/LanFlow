-- PostgREST connections load safeupdate; authorized whole-registry deletes must
-- have an explicit predicate, even inside a guarded SECURITY DEFINER function.
begin;
do $migration$
declare body text; changed text; registry_table text;
begin
  body := pg_get_functiondef('public.reset_all_bill_devices(uuid,text,text)'::regprocedure);
  foreach registry_table in array array[
    'rubber_bill_issuer_heads', 'rubber_bill_issuers', 'bill_issuer_device_heads',
    'bill_issuer_devices', 'legacy_bill_issuer_refs', 'rubber_bill_issuer_counters'
  ] loop
    changed := replace(body, format('delete from private.%I;', registry_table),
      format('delete from private.%I where true;', registry_table));
    if changed = body then raise exception 'Registry clear predicate boundary missing: %', registry_table; end if;
    body := changed;
  end loop;
  execute body;
end $migration$;
notify pgrst, 'reload schema';
commit;
