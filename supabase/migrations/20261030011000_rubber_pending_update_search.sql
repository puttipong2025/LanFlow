-- Search the same compact pending-update fields shown by the existing branch feed.
do $migration$
declare body text; changed text;
begin
  select pg_get_functiondef('public.get_rubber_bill_operational_feed_v2(uuid,text,text,text,timestamptz,text,integer)'::regprocedure) into body;
  changed := replace(body,
    'b.customer_name, b.bill_type, b.created_by_name, b.created_by_phone',
    'b.customer_name, b.bill_type, b.created_by_name, b.created_by_phone,
        case when req.operation = ''update'' then req.proposed_payload->>''customerName'' end,
        case when req.operation = ''update'' then req.proposed_payload->>''billDate'' end,
        case when req.operation = ''update'' then req.proposed_payload->>''billType'' end');
  if changed = body then raise exception 'Expected bill search definition missing'; end if;
  execute changed;
end;
$migration$;
