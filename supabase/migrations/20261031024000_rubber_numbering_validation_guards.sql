-- Permanent malformed numbering inputs must not become transient queue outages.
create or replace function private.assert_rubber_bill_numbering(payload jsonb) returns void
language plpgsql set search_path='' as $$
declare m jsonb:=payload->'billNumbering'; i private.rubber_bill_issuers; d date; seq bigint;
  existing public.rubber_bills; date_part text; sequence_part text;
begin
  select * into existing from public.rubber_bills where client_temp_id=payload->>'clientTempId';
  if existing.numbering_metadata is not null and
    (m is distinct from existing.numbering_metadata or payload->>'localBillNo' is distinct from existing.local_bill_no) then
    raise exception 'BILL_NUMBER_CHANGED'; end if;
  if m is null then return; end if;
  if jsonb_typeof(m)<>'object' or m->>'version' is distinct from '1'
    or jsonb_typeof(m->'sequence') is distinct from 'number'
    or (m->>'date') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'INVALID_BILL_NUMBER'; end if;
  d:=(m->>'date')::date; seq:=(m->>'sequence')::bigint;
  date_part:=to_char(d,'YYMMDD'); sequence_part:=lpad(seq::text,greatest(4,length(seq::text)),'0');
  select * into i from private.rubber_bill_issuers where id=(m->>'issuerId')::uuid;
  if i.id is null or i.location_id is distinct from (payload->>'locationId')::uuid or seq<1
    or (m->>'sequence')::numeric<>seq or seq>9007199254740991 or d::text is distinct from m->>'date'
    or (payload->>'localBillNo' is distinct from date_part||sequence_part||'-'||i.code
      and payload->>'localBillNo' is distinct from sequence_part||'-'||date_part||'-'||i.code)
    or coalesce(payload->>'billType','') not in ('weighing','บิลเครื่องชั่งเล็ก') then raise exception 'INVALID_BILL_NUMBER'; end if;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then
  raise exception 'INVALID_BILL_NUMBER';
end $$;
revoke all on function private.assert_rubber_bill_numbering(jsonb) from public,anon,authenticated;

do $$ declare body text; changed text; begin
  body:=pg_get_functiondef('public.list_rubber_bill_issuers(uuid,text,integer,integer,text)'::regprocedure);
  changed:=replace(body,'if p_status not in',
    'if p_limit is null or p_offset is null or p_status is null or p_search is null or p_status not in');
  if changed=body then raise exception 'issuer page validation boundary not found'; end if;
  execute changed;
end $$;
