-- Remove obsolete registrations from Admin while retaining only immutable bill references.
begin;
lock table private.rubber_bill_issuers,private.rubber_bill_issuer_heads in access exclusive mode;
create table private.legacy_bill_issuer_refs(
  id uuid primary key, location_id uuid not null, code text not null
);
revoke all on private.legacy_bill_issuer_refs from public,anon,authenticated;
insert into private.legacy_bill_issuer_refs(id,location_id,code)
select id,location_id,code from private.rubber_bill_issuers where device_id is null;

-- Both validators must resolve an old frozen issuer after its registration is gone.
do $$ declare signature text; body text; changed text; begin
  foreach signature in array array['private.assert_rubber_bill_numbering(jsonb)','private.assert_income_expense_numbering(jsonb)'] loop
    body:=pg_get_functiondef(signature::regprocedure);
    changed:=replace(body,'i private.rubber_bill_issuers','i record');
    changed:=replace(changed,
      'select * into i from private.rubber_bill_issuers where id=(m->>''issuerId'')::uuid;',
      'select id,location_id,code into i from ('||chr(10)||
      'select id,location_id,code from private.rubber_bill_issuers union all '||chr(10)||
      'select id,location_id,code from private.legacy_bill_issuer_refs) refs where id=(m->>''issuerId'')::uuid;');
    if changed=body or position('from private.legacy_bill_issuer_refs' in changed)=0 then
      raise exception 'Legacy issuer validation boundary missing: %',signature;
    end if;
    execute changed;
  end loop;
end $$;
delete from private.rubber_bill_issuer_heads h using private.rubber_bill_issuers i
where h.issuer_id=i.id and i.device_id is null;
delete from private.rubber_bill_issuers where device_id is null;
notify pgrst,'reload schema';
commit;
