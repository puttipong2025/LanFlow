-- A delete command need only identify the bill/revision. Its pending card must
-- display authoritative bill values instead of requiring edit-only proposal data.
do $$ declare body text; pair text[]; begin
  body:=pg_get_functiondef('public.get_rubber_bill_operational_feed_v2(uuid,text,text,text,timestamptz,text,integer)'::regprocedure);
  foreach pair slice 1 in array array[
    ['customerName','b.customer_name'],['billDate','b.bill_date::text'],['billType','b.bill_type']
  ] loop
    body:=replace(body,'req.proposed_payload->>'''||pair[1]||'''',
      'case when req.operation=''delete'' then '||pair[2]||' else req.proposed_payload->>'''||pair[1]||''' end');
  end loop;
  foreach pair slice 1 in array array[
    ['netWeight','b.net_weight'],['averagePrice','b.average_price'],['netRubberValue','b.net_rubber_value'],
    ['deductionTotal','b.deduction_total'],['netTotal','b.net_total']
  ] loop
    body:=replace(body,'req.proposed_payload->'''||pair[1]||'''',
      'case when req.operation=''delete'' then to_jsonb('||pair[2]||') else req.proposed_payload->'''||pair[1]||''' end');
  end loop;
  execute body;
end $$;
