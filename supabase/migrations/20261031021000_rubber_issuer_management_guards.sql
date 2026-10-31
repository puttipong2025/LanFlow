-- Complete status filtering and reject unbound metadata even on privileged direct writes.
do $$ declare body text; changed text; begin
  body:=pg_get_functiondef('public.list_rubber_bill_issuers(uuid,text,integer,integer)'::regprocedure);
  changed:=replace(body,'p_limit integer DEFAULT 20)', 'p_limit integer DEFAULT 20, p_status text DEFAULT ''all''::text)');
  changed:=replace(changed,'if p_offset<0 or', 'if p_status not in (''all'',''active'',''retired'') or p_offset<0 or');
  changed:=replace(changed,'where (p_location_id is null or i.location_id=p_location_id)',
    'where (p_location_id is null or i.location_id=p_location_id) and (p_status=''all'' or (p_status=''active'' and i.retired_at is null) or (p_status=''retired'' and i.retired_at is not null))');
  if changed=body then raise exception 'issuer status boundary not found'; end if;
  execute changed;
  drop function public.list_rubber_bill_issuers(uuid,text,integer,integer);
  body:=pg_get_functiondef('private.preserve_rubber_bill_number()'::regprocedure);
  changed:=replace(body,'    if b.client_temp_id is not null then',
    '    if b.client_temp_id is null and new.numbering_metadata is not null then raise exception ''UNBOUND_BILL_NUMBER''; end if;'||chr(10)||'    if b.client_temp_id is not null then');
  if changed=body then raise exception 'number binding boundary not found'; end if;
  execute changed;
end $$;
revoke all on function public.list_rubber_bill_issuers(uuid,text,integer,integer,text) from public,anon;
grant execute on function public.list_rubber_bill_issuers(uuid,text,integer,integer,text) to authenticated;
