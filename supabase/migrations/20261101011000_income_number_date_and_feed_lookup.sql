-- The number date is frozen at local acceptance, not the subsequently edited business date.
do $$ declare body text; changed text; begin
  body:=pg_get_functiondef('private.assert_income_expense_numbering(jsonb)'::regprocedure);
  changed:=replace(body,
    '    or (b.client_temp_id is null and payload->>''operation''=''create'' and m->>''date'' is distinct from payload->>''txDate'')', '');
  if body=changed then raise exception 'Income number date boundary missing'; end if;
  execute changed;
end $$;

-- Bounded pages must not repeatedly scan every legacy approval payload for metadata.
create index income_expense_numbered_approval_client_idx
  on public.income_expense_approval_requests((requested_payload->>'clientTempId'),created_at desc)
  where requested_payload ? 'billNumbering';
do $$ declare body text; changed text; begin
  body:=pg_get_functiondef('public.get_income_expense_operational_feed(uuid,text,text,text)'::regprocedure);
  changed:=replace(body,
    'where requested_payload->>''clientTempId''=item.value->>''clientTempId'' and location_id=p_location_id',
    'where requested_payload ? ''billNumbering'' and requested_payload->>''clientTempId''=item.value->>''clientTempId'' and location_id=p_location_id');
  if body=changed then raise exception 'Income metadata lookup boundary missing'; end if;
  execute changed;
end $$;
